import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/start-server-core";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
async function discover(url: string) {
  const yt = await import("./youtube.server");
  const key = process.env['YOUTUBE_API_KEY'];
  if (key) {
    try { return { ...(await yt.discoverChannelViaApi(url, key)), exact: true }; } catch { /* fall back to keyless */ }
  }
  return { ...(await yt.discoverChannel(url)), exact: false };
}

/** Store a transcript once, globally. Existing transcripts are never replaced. */
async function saveTranscript(db: Db, id: string, transcript: string, lang: string | null) {
  await db.from("video_transcripts").upsert(
    { video_id: id, transcript, caption_lang: lang, word_count: transcript.split(/\s+/).length },
    { onConflict: "video_id", ignoreDuplicates: true },
  );
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
      try {
        const r = await yt.extractVideo(parsed.videoId, saved?.title);
        const row = latestMeta(toRow(r), saved);
        const { error } = await db.from("videos").upsert({ ...row, channel_id: saved?.channel_id ?? null, position: saved?.position ?? 0 });
        if (error) return { error: error.message } as const;
        if (r.transcript && !transcript) { await saveTranscript(db, r.id, r.transcript, r.captionLang); transcript = r.transcript; }
      } catch (e) {
        if (!saved || !transcript) return { error: (e as Error).message } as const;
      }
      if (userId && transcript) await unlock(db, userId, [parsed.videoId], "single_video");
      return { kind: "video" as const, videoId: parsed.videoId, transcript };
    }

    if (!userId) return { error: "Sign in to crawl whole channels — it's free.", authRequired: true } as const;

    let found;
    try { found = await discover(parsed.url); } catch (e) {
      // YouTube refused discovery: resume from the saved video list when we know the channel.
      const id = parsed.url.match(/channel\/(UC[\w-]{22})/)?.[1];
      const known = id ? await db.from("channels").select("id").eq("id", id).maybeSingle() : null;
      if (!id || !known?.data) return { error: (e as Error).message } as const;
      await requeueBlocked(db, id);
      await db.from("projects").update({ updated_at: new Date().toISOString() }).eq("user_id", userId).eq("channel_id", id);
      return { kind: "channel" as const, channelId: id, cached: true, newVideos: 0 };
    }
    const { channel, videos, exact } = found;
    const now = new Date().toISOString();
    const existing = await db.from("channels").select("id").eq("id", channel.channelId).maybeSingle();
    await db.from("channels").upsert({
      id: channel.channelId, title: channel.title, handle: channel.handle, thumbnail: channel.thumbnail,
      video_count: videos.length, updated_at: now,
    });
    const { data: tokenMeta } = await callerProfile();
    await db.from("profiles").upsert({ user_id: userId, ...tokenMeta }, { onConflict: "user_id", ignoreDuplicates: true });
    await db.from("projects").upsert({
      user_id: userId, channel_id: channel.channelId, channel_title: channel.title,
      thumbnail: channel.thumbnail, video_count: videos.length, updated_at: now,
    }, { onConflict: "user_id,channel_id" });

    // Bulk-merge discovered metadata: new videos are queued, known ones get their latest stats.
    let fresh = 0;
    for (let i = 0; i < videos.length; i += 500) {
      const chunk = videos.slice(i, i + 500);
      const { data: rows } = await db.from("videos")
        .select("id,title,views,views_updated_at,duration_seconds,publish_date,position,channel_id").in("id", chunk.map((v) => v.id));
      const byId = new Map((rows ?? []).map((r) => [r.id, r]));
      const upserts = [];
      for (const [k, d] of chunk.entries()) {
        const pos = i + k;
        const r = byId.get(d.id);
        if (!r) {
          fresh++;
          upserts.push({ id: d.id, channel_id: channel.channelId, position: pos, title: d.title, status: "pending",
            views: d.views ?? null, views_updated_at: d.views != null ? now : null,
            duration_seconds: d.durationSeconds ?? null, publish_date: d.publishDate ?? null, updated_at: now });
          continue;
        }
        const next = mergeDiscovered(r, d, exact, now);
        if (r.position !== pos || r.channel_id !== channel.channelId) Object.assign(next, { position: pos, channel_id: channel.channelId });
        if (Object.keys(next).length) upserts.push({ ...r, ...next, updated_at: now });
      }
      if (upserts.length) {
        const { error } = await db.from("videos").upsert(upserts, { onConflict: "id" });
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

type SavedMeta = { title: string; views: number | null; views_updated_at?: string | null; duration_seconds: number | null; publish_date: string | null };

/** Latest metadata wins, but an empty value never replaces a saved one. Rounded listing views only refresh stale counts. */
function mergeDiscovered(r: SavedMeta, d: Discovered, exact: boolean, now: string) {
  const p: Record<string, unknown> = {};
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
  .inputValidator((d) => z.object({ channelId: z.string().regex(/^UC[\w-]{22}$/) }).parse(d))
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
    await yt.pool(todo ?? [], 3, async (v) => {
      // Already extracted by anyone: no YouTube request at all.
      if (v.cached) {
        if (v.status !== "ok") await db.from("videos").update({ status: "ok", status_detail: null, updated_at: new Date().toISOString() }).eq("id", v.id);
        unlocked.push(v.id);
        return;
      }
      try {
        const r = await yt.extractVideo(v.id, v.title);
        if (r.transcript) await saveTranscript(db, r.id, r.transcript, r.captionLang);
        await db.from("videos").update({ ...latestMeta(toRow(r), v), attempts: v.attempts + 1 }).eq("id", v.id);
        if (r.transcript) unlocked.push(v.id);
      } catch (e) {
        const msg = (e as Error).message;
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
    const processed = unlocked.length;
    const freeUsed = Math.min(freeLeft, processed);
    const creditUsed = processed - freeUsed;
    await unlock(db, userId, unlocked.slice(0, freeUsed), "daily_free");
    await unlock(db, userId, unlocked.slice(freeUsed), "credit");
    if (freeUsed > 0) await db.from("daily_usage").upsert({ user_id: userId, day: today, used: used + freeUsed });
    if (creditUsed > 0) {
      await db.from("wallets").upsert({ user_id: userId, credits: credits - creditUsed, updated_at: new Date().toISOString() });
      await db.from("credit_ledger").insert({
        user_id: userId, delta: -creditUsed, type: "crawl",
        description: `Channel crawl — ${creditUsed} videos beyond the free daily quota`,
      });
    }
    // Touch unlocked rows so the browser's incremental sync picks them up.
    if (unlocked.length) await db.from("videos").update({ updated_at: new Date().toISOString() }).in("id", unlocked);

    return { processed, remaining: await remainingFor(), throttled, quotaExceeded: false, freeLeft: Math.max(0, freeLeft - freeUsed), credits: credits - creditUsed };
  });

function toRow(r: import("./youtube.server").VideoResult) {
  return {
    id: r.id,
    title: r.title,
    publish_date: r.publishDate,
    views: r.views,
    views_updated_at: r.views != null ? new Date().toISOString() : undefined,
    duration_seconds: r.durationSeconds,
    status: r.status,
    status_detail: r.status === "ok" ? null : r.statusDetail,
    caption_lang: r.captionLang,
    word_count: r.transcript ? r.transcript.split(/\s+/).length : 0,
    updated_at: new Date().toISOString(),
  };
}

type Saved = { title: string; views: number | null; duration_seconds: number | null; publish_date: string | null };

/** Latest non-empty values win; an empty value never replaces a saved one. */
function latestMeta<T extends ReturnType<typeof toRow>>(row: T, saved: Saved | null | undefined): T {
  if (!saved) return row;
  return {
    ...row,
    title: row.title || saved.title,
    views: row.views ?? saved.views,
    duration_seconds: row.duration_seconds ?? saved.duration_seconds,
    publish_date: row.publish_date ?? saved.publish_date,
  };
}

/** From a blocked fetch, only fill fields that are still empty. */
function fillMissing(r: import("./youtube.server").VideoResult, saved: Saved) {
  const patch: Record<string, unknown> = {};
  if (!saved.title && r.title) patch.title = r.title;
  if (saved.views == null && r.views != null) patch.views = r.views;
  if (saved.duration_seconds == null && r.durationSeconds != null) patch.duration_seconds = r.durationSeconds;
  if (saved.publish_date == null && r.publishDate) patch.publish_date = r.publishDate;
  return patch;
}
