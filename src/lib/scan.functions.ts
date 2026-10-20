import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/start-server-core";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { collectionIdPattern } from "@/lib/collections";
import { normalizeCues, type Cue } from "@/lib/captions";
import { saveDiscoveredVideos } from "@/lib/video-discovery";

const BATCH = 9; // videos per call; 3 at a time x 2 player calls = 6 outbound (Worker cap)
const MAX_ATTEMPTS = 3;
const FREE_DAILY = 10; // registered users: 10 video transcripts per day

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

/** Resolve the caller from the request bearer token; null when not signed in. */
async function callerUserId(): Promise<string | null> {
  const header = getRequestHeader("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const key = process.env['SUPABASE_PUBLISHABLE_KEY']!;
  const client = createClient(process.env['SUPABASE_URL']!, key, { auth: { persistSession: false } });
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

type UserMeta = { email: string | null; display_name: string | null; avatar_url: string | null };
function metaFromClaims(claims: Record<string, unknown> | null | undefined): UserMeta {
  const meta = (claims?.["user_metadata"] ?? null) as Record<string, unknown> | null;
  const read = (k: string) => (meta && typeof meta[k] === "string" && meta[k] ? (meta[k] as string) : null);
  const email = claims && typeof claims["email"] === "string" ? (claims["email"] as string) : read("email");
  return { email, display_name: read("full_name") ?? read("name"), avatar_url: read("avatar_url") ?? read("picture") };
}

type Db = Awaited<ReturnType<typeof admin>>;
type Discovered = import("./youtube.server").DiscoveredVideo;
const VIEWS_STALE_MS = 24 * 3600 * 1000; // refresh view counts at most once a day

/** Stage 1: list the channel. Official Data API when a key is configured (exact numbers), keyless otherwise. */
async function discover(url: string, known: ReadonlySet<string> = new Set()) {
  const yt = await import("./youtube.server");
  const key = process.env['YOUTUBE_API_KEY'];
  if (key) {
    try { return { ...(await yt.discoverChannelViaApi(url, key, known)), exact: true, route: "youtube_data_api", fallbackFrom: null as string | null }; }
    catch (e) { return { ...(await yt.discoverChannel(url, 200, known)), exact: false, route: "keyless_videos_tab", fallbackFrom: (e as Error).message }; }
  }
  return { ...(await yt.discoverChannel(url, 200, known)), exact: false, route: "keyless_videos_tab", fallbackFrom: null as string | null };
}

type LogRow = { user_id?: string | null; channel_id?: string | null; video_id?: string | null; stage: string; route: string; outcome: string; detail?: string | null; duration_ms?: number };
/** Append pipeline events; logging must never break a crawl. */
async function writeLogs(db: Db, rows: LogRow[]) {
  if (!rows.length) return;
  try { await db.from("pipeline_logs").insert(rows.map((r) => ({ ...r, detail: r.detail?.slice(0, 500) ?? null }))); } catch { /* ignore */ }
}

/** Store a transcript once, globally. Existing transcripts are never replaced. */
async function saveTranscript(db: Db, id: string, transcript: string, lang: string | null, cues: Cue[] = []) {
  await db.from("video_transcripts").upsert(
    { video_id: id, transcript, caption_lang: lang, word_count: transcript.split(/\s+/).length },
    { onConflict: "video_id", ignoreDuplicates: true },
  );
  if (cues.length) {
    const { error } = await db.from("video_caption_cues").upsert({ video_id: id, cues }, { onConflict: "video_id", ignoreDuplicates: true });
    if (error) throw new Error("Unable to save timestamps.");
  }
}

async function unlock(db: Db, userId: string, ids: string[], source: string) {
  if (!ids.length) return;
  await db.from("user_video_unlocks").upsert(ids.map((video_id) => ({ user_id: userId, video_id, source })),
    { onConflict: "user_id,video_id", ignoreDuplicates: true });
}

/** Resolve input, discover videos and register them. Metadata always refreshes to the latest values. */
export const startScan = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ input: z.string().min(1).max(500), refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    const yt = await import("./youtube.server");
    const db = await admin();
    let parsed;
    try { parsed = yt.parseInput(data.input); } catch (e) { return { error: (e as Error).message } as const; }
    const userId = await callerUserId();

    if (parsed.kind === "video") {
      const { data: saved } = await db.from("videos").select("id,title,views,duration_seconds,publish_date,channel_id,position").eq("id", parsed.videoId).maybeSingle();
      const { data: cached } = await db.from("video_transcripts").select("transcript").eq("video_id", parsed.videoId).maybeSingle();
      let transcript = cached?.transcript ?? null;
      if (cached?.transcript) {
        if (userId) await unlock(db, userId, [parsed.videoId], "single_video");
        const timed = userId ? await db.from("user_caption_unlocks").select("video_id").eq("user_id", userId).eq("video_id", parsed.videoId).maybeSingle() : null;
        const cues = timed?.data ? (await db.from("video_caption_cues").select("cues").eq("video_id", parsed.videoId).maybeSingle()).data?.cues : null;
        return { kind: "video" as const, videoId: parsed.videoId, transcript, cues: normalizeCues(cues) };
      }
      let freshCues: Cue[] = [];
      const t0 = Date.now();
      try {
        const r = await yt.extractVideo(parsed.videoId, saved?.title);
        await writeLogs(db, [{ user_id: userId, video_id: parsed.videoId, stage: "single_video", route: r.route ?? "youtube_direct", outcome: r.status, detail: r.statusDetail ?? (r.captionLang ? `lang ${r.captionLang}` : null), duration_ms: Date.now() - t0 }]);
        const row = latestMeta(toRow(r), saved);
        const { error } = await db.from("videos").upsert({ ...row, channel_id: saved?.channel_id ?? null, position: saved?.position ?? 0 });
        if (error) return { error: error.message } as const;
        if (r.transcript && !transcript) { await saveTranscript(db, r.id, r.transcript, r.captionLang, r.cues); transcript = r.transcript; freshCues = r.cues ?? []; }
      } catch (e) {
        await writeLogs(db, [{ user_id: userId, video_id: parsed.videoId, stage: "single_video", route: "youtube_direct", outcome: "error", detail: (e as Error).message, duration_ms: Date.now() - t0 }]);
        if (!saved || !transcript) return { error: (e as Error).message } as const;
      }
      if (userId && transcript) {
        await unlock(db, userId, [parsed.videoId], "single_video");
        if (freshCues.length) await db.from("user_caption_unlocks").upsert({ user_id: userId, video_id: parsed.videoId }, { onConflict: "user_id,video_id", ignoreDuplicates: true });
      }
      return { kind: "video" as const, videoId: parsed.videoId, transcript, cues: freshCues };
    }

    if (!userId) return { error: "Sign in to crawl whole channels — it's free.", authRequired: true } as const;

    let found;
    const knownId = parsed.kind === "playlist" ? `PL:${parsed.playlistId}` : parsed.url.match(/channel\/(UC[\w-]{22})/)?.[1];
    const known = new Set<string>();
    if (data.refresh && knownId && parsed.kind !== "playlist") {
      for (let offset = 0; ; offset += 1000) {
        const { data: old } = await db.from("videos").select("id").eq("channel_id", knownId).range(offset, offset + 999);
        for (const row of old ?? []) known.add(row.id);
        if (!old || old.length < 1000) break;
      }
    }
    const d0 = Date.now();
    try { found = parsed.kind === "playlist"
      ? { ...(await yt.discoverPlaylist(parsed.playlistId, process.env["YOUTUBE_API_KEY"])), exact: false, route: "playlist_discovery", fallbackFrom: null }
      : await discover(parsed.url, known); } catch (e) {
      await writeLogs(db, [{ user_id: userId, stage: "discovery", route: "all_routes_failed", outcome: "error", detail: `${parsed.url} — ${(e as Error).message}`, duration_ms: Date.now() - d0 }]);
      // YouTube refused discovery: resume from the saved video list when we know the channel.
      const id = knownId;
      const known = id ? await db.from("channels").select("id").eq("id", id).maybeSingle() : null;
      if (!id || !known?.data) return { error: (e as Error).message } as const;
      await requeueBlocked(db, id);
      await db.from("projects").update({ updated_at: new Date().toISOString() }).eq("user_id", userId).eq("channel_id", id);
      return { kind: "channel" as const, channelId: id, cached: true, newVideos: 0 };
    }
    const { channel, videos, exact } = found;
    await writeLogs(db, [{ user_id: userId, channel_id: channel.channelId, stage: "discovery", route: found.route, outcome: "ok",
      detail: `${videos.length} videos${found.fallbackFrom ? ` (Data API failed: ${found.fallbackFrom})` : ""}`, duration_ms: Date.now() - d0 }]);
    const now = new Date().toISOString();
    const existing = await db.from("channels").select("id").eq("id", channel.channelId).maybeSingle();
    const previousCount = (await db.from("channels").select("video_count").eq("id", channel.channelId).maybeSingle()).data?.video_count ?? 0;
    const collectionCount = data.refresh ? Math.max(previousCount, videos.length) : videos.length;
    await db.from("channels").upsert({
      id: channel.channelId, title: channel.title, handle: channel.handle, thumbnail: channel.thumbnail,
      video_count: collectionCount, updated_at: now,
    });
    const { data: tokenMeta } = await callerProfile();
    await db.from("profiles").upsert({ user_id: userId, ...tokenMeta }, { onConflict: "user_id", ignoreDuplicates: true });
    await db.from("projects").upsert({
      user_id: userId, channel_id: channel.channelId, channel_title: channel.title,
      thumbnail: channel.thumbnail, video_count: collectionCount, updated_at: now,
    }, { onConflict: "user_id,channel_id" });

    // Bulk-merge discovered metadata: new videos are queued, known ones get their latest stats.
    let fresh = 0;
    for (let i = 0; i < videos.length; i += 500) {
      const chunk = videos.slice(i, i + 500);
      const { data: rows, error: readError } = await db.from("videos")
        .select("id,title,views,views_updated_at,duration_seconds,publish_date,position,channel_id").in("id", chunk.map((v) => v.id));
      if (readError) return { error: readError.message } as const;
      const byId = new Map((rows ?? []).map((r) => [r.id, r]));
      const discoveredRows = chunk.map((d, k) => ({ id: d.id, channel_id: parsed.kind === "playlist" ? null : channel.channelId,
        position: i + k, title: d.title, views: d.views ?? null,
        views_updated_at: d.views != null ? now : null, duration_seconds: d.durationSeconds ?? null,
        publish_date: d.publishDate ?? null, updated_at: now }));
      fresh += discoveredRows.filter((r) => !byId.has(r.id)).length;
      try {
        await saveDiscoveredVideos(discoveredRows, new Set(byId.keys()), (d) => {
          const r = byId.get(d.id);
          if (!r) return {};
          const next = mergeDiscovered(r, { id: d.id, title: d.title, views: d.views,
            durationSeconds: d.duration_seconds, publishDate: d.publish_date }, exact, now);
          if (parsed.kind !== "playlist" && !data.refresh && (r.position !== d.position || r.channel_id !== d.channel_id))
            Object.assign(next, { position: d.position, channel_id: d.channel_id });
          return Object.keys(next).length ? { ...next, updated_at: now } : {};
        }, async (newRows) => {
          // A concurrent crawl may have inserted a video already: never overwrite it.
          const { error } = await db.from("videos").upsert(newRows, { onConflict: "id", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
        }, async (id, patch) => {
          const { error } = await db.from("videos").update(patch).eq("id", id);
          if (error) throw new Error(error.message);
        });
      } catch (e) { return { error: (e as Error).message } as const; }
    }
    if (parsed.kind === "playlist") {
      for (let i = 0; i < videos.length; i += 500) {
        const { error } = await db.from("collection_videos").upsert(videos.slice(i, i + 500).map((v, k) => ({ collection_id: channel.channelId, video_id: v.id, position: i + k })));
        if (error) return { error: error.message } as const;
      }
    }
    await requeueBlocked(db, channel.channelId);
    if (data.refresh) {
      await db.from("videos").update({ status: "pending", attempts: 0 }).eq("channel_id", channel.channelId).eq("status", "failed");
    }
    return { kind: "channel" as const, channelId: channel.channelId, cached: !!existing.data, newVideos: fresh };
  });

/** Rows hit by a temporary YouTube bot check go back in the queue. */
async function requeueBlocked(db: Db, channelId: string) {
  await db.from("videos").update({ status: "pending", attempts: 0, status_detail: null })
    .eq("channel_id", channelId).eq("status", "unavailable").or("status_detail.ilike.%not a bot%,status_detail.ilike.%sign in to confirm%");
}

type MetaPatch = { title?: string; views?: number; views_updated_at?: string; duration_seconds?: number; publish_date?: string; position?: number; channel_id?: string };
type SavedMeta = { title: string; views: number | null; views_updated_at?: string | null | undefined; duration_seconds: number | null; publish_date: string | null };

/** Latest metadata wins, but an empty value never replaces a saved one. Rounded listing views only refresh stale counts. */
function mergeDiscovered(r: SavedMeta, d: Discovered, exact: boolean, now: string) {
  const p: MetaPatch = {};
  if (d.title && d.title !== r.title) p.title = d.title;
  const stale = !r.views_updated_at || Date.now() - Date.parse(r.views_updated_at) > VIEWS_STALE_MS;
  if (d.views != null && d.views !== r.views && (r.views == null || exact || stale)) { p.views = d.views; p.views_updated_at = now; }
  if (d.durationSeconds != null && d.durationSeconds !== r.duration_seconds && (r.duration_seconds == null || exact)) p.duration_seconds = d.durationSeconds;
  if (d.publishDate && (r.publish_date == null || (exact && Date.parse(d.publishDate) !== Date.parse(r.publish_date)))) p.publish_date = d.publishDate;
  return p;
}

async function callerProfile(): Promise<{ data: UserMeta }> {
  const header = getRequestHeader("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return { data: { email: null, display_name: null, avatar_url: null } };
  const key = process.env['SUPABASE_PUBLISHABLE_KEY']!;
  const client = createClient(process.env['SUPABASE_URL']!, key, { auth: { persistSession: false } });
  const { data } = await client.auth.getUser(token);
  const claims = data.user ? { email: data.user.email, user_metadata: data.user.user_metadata } : null;
  return { data: metaFromClaims(claims as Record<string, unknown> | null) };
}

/** Stage 2: unlock cached transcripts instantly, extract the rest. Browser calls this until remaining = 0. */
export const processBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ channelId: z.string().regex(collectionIdPattern) }).parse(d))
  .handler(async ({ data, context }) => {
    const yt = await import("./youtube.server");
    const db = await admin();
    const { supabase, userId, claims } = context;
    const today = new Date().toISOString().slice(0, 10);
    await db.from("profiles").upsert({ user_id: userId, ...metaFromClaims(claims) }, { onConflict: "user_id", ignoreDuplicates: true });

    const [{ data: usage }, { data: wallet }] = await Promise.all([
      supabase.from("daily_usage").select("used").eq("user_id", userId).eq("day", today).maybeSingle(),
      supabase.from("wallets").select("credits").eq("user_id", userId).maybeSingle(),
    ]);
    const used = usage?.used ?? 0;
    const credits = wallet?.credits ?? 0;
    const freeLeft = Math.max(0, FREE_DAILY - used);
    const allowance = freeLeft + credits;
    const remainingFor = async () => (await db.rpc("user_channel_remaining", { _user: userId, _channel: data.channelId })).data ?? 0;
    if (allowance <= 0) {
      return { processed: 0, remaining: await remainingFor(), throttled: false, quotaExceeded: true, freeLeft: 0, credits };
    }

    const { data: todo, error } = await db.rpc("user_channel_todo", { _user: userId, _channel: data.channelId, _limit: Math.min(BATCH, allowance) });
    if (error) throw new Error(error.message);

    let throttled = false;
    const unlocked: string[] = [];
    const logs: LogRow[] = [];
    const base = { user_id: userId, channel_id: data.channelId, stage: "transcript" };
    await yt.pool(todo ?? [], 3, async (v) => {
      // Already extracted by anyone: no YouTube request at all.
      if (v.cached) {
        if (v.status !== "ok") await db.from("videos").update({ status: "ok", status_detail: null, updated_at: new Date().toISOString() }).eq("id", v.id);
        unlocked.push(v.id);
        logs.push({ ...base, video_id: v.id, route: "shared_cache", outcome: "ok", detail: "0 network calls", duration_ms: 0 });
        return;
      }
      const t0 = Date.now();
      try {
        const r = await yt.extractVideo(v.id, v.title);
        logs.push({ ...base, video_id: v.id, route: r.route ?? "youtube_direct", outcome: r.status, detail: r.statusDetail ?? (r.captionLang ? `lang ${r.captionLang}` : null), duration_ms: Date.now() - t0 });
        if (r.transcript) await saveTranscript(db, r.id, r.transcript, r.captionLang, r.cues);
        await db.from("videos").update({ ...latestMeta(toRow(r), v), attempts: v.attempts + 1 }).eq("id", v.id);
        if (r.transcript) unlocked.push(v.id);
      } catch (e) {
        const msg = (e as Error).message;
        logs.push({ ...base, video_id: v.id, route: "youtube_direct", outcome: msg.includes("429") || msg.startsWith("BOT_CHECK") ? "throttled" : "error", detail: msg, duration_ms: Date.now() - t0 });
        if (msg.includes("429") || msg.startsWith("BOT_CHECK")) {
          throttled = true;
          const partial = e instanceof yt.BotCheckError ? fillMissing(e.partial, v) : {};
          await db.from("videos").update({ ...partial, status_detail: msg, updated_at: new Date().toISOString() }).eq("id", v.id);
          return;
        }
        const final = v.attempts + 1 >= MAX_ATTEMPTS;
        await db.from("videos").update({
          attempts: v.attempts + 1, status: final ? "failed" : "pending", status_detail: msg, updated_at: new Date().toISOString(),
        }).eq("id", v.id);
      }
    });

    // Only delivered transcripts count against quota.
    const { data: delivered, error: deliveryError } = await db.rpc("deliver_transcript_unlocks", { _user: userId, _ids: unlocked });
    if (deliveryError) throw new Error(deliveryError.message);
    const result = delivered as { ids: string[]; freeUsed: number; creditUsed: number; freeLeft: number; credits: number };
    if (result.ids.length) {
      const { data: timed } = await db.from("video_caption_cues").select("video_id").in("video_id", result.ids);
      if (timed?.length) await db.from("user_caption_unlocks").upsert(timed.map((x) => ({ user_id: userId, video_id: x.video_id })), { onConflict: "user_id,video_id", ignoreDuplicates: true });
    }
    const processed = result.ids.length;
    const freeUsed = result.freeUsed;
    const creditUsed = result.creditUsed;
    if (creditUsed > 0 || freeUsed > 0) logs.push({ ...base, stage: "billing", route: "quota", outcome: "charged", detail: `${freeUsed} free, ${creditUsed} credits` });
    await writeLogs(db, logs);
    // Touch unlocked rows so the browser's incremental sync picks them up.
    if (unlocked.length) await db.from("videos").update({ updated_at: new Date().toISOString() }).in("id", unlocked);

    return { processed, remaining: await remainingFor(), throttled, quotaExceeded: result.freeLeft + result.credits === 0, freeLeft: result.freeLeft, credits: result.credits };
  });

function toRow(r: import("./youtube.server").VideoResult) {
  return {
    id: r.id,
    title: r.title,
    publish_date: r.publishDate,
    views: r.views,
    views_updated_at: r.views != null ? new Date().toISOString() : null as string | null,
    duration_seconds: r.durationSeconds,
    status: r.status,
    status_detail: r.status === "ok" ? null : r.statusDetail,
    caption_lang: r.captionLang,
    word_count: r.transcript ? r.transcript.split(/\s+/).length : 0,
    updated_at: new Date().toISOString(),
  };
}

type Saved = { title: string; views: number | null; views_updated_at?: string | null | undefined; duration_seconds: number | null; publish_date: string | null };

/** Latest non-empty values win; an empty value never replaces a saved one. */
function latestMeta<T extends ReturnType<typeof toRow>>(row: T, saved: Saved | null | undefined): T {
  if (!saved) return row;
  return {
    ...row,
    title: row.title || saved.title,
    views: row.views ?? saved.views,
    views_updated_at: row.views != null ? row.views_updated_at : saved.views_updated_at ?? null,
    duration_seconds: row.duration_seconds ?? saved.duration_seconds,
    publish_date: row.publish_date ?? saved.publish_date,
  };
}

/** From a blocked fetch, only fill fields that are still empty. */
function fillMissing(r: import("./youtube.server").VideoResult, saved: Saved) {
  const patch: MetaPatch = {};
  if (!saved.title && r.title) patch.title = r.title;
  if (saved.views == null && r.views != null) patch.views = r.views;
  if (saved.duration_seconds == null && r.durationSeconds != null) patch.duration_seconds = r.durationSeconds;
  if (saved.publish_date == null && r.publishDate) patch.publish_date = r.publishDate;
  return patch;
}
