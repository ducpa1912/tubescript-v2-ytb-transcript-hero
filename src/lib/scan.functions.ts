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

/** Resolve input, discover videos and register them. Cached channels skip discovery unless refresh is set. */
export const startScan = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ input: z.string().min(1).max(500), refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    const yt = await import("./youtube.server");
    const db = await admin();
    let parsed;
    try { parsed = yt.parseInput(data.input); } catch (e) { return { error: (e as Error).message } as const; }

    if (parsed.kind === "video") {
      const r = await yt.extractVideo(parsed.videoId);
      const row = toRow(r);
      const { error } = await db.from("videos").upsert({ ...row, channel_id: null, position: 0 });
      if (error) return { error: error.message } as const;
      return { kind: "video" as const, videoId: parsed.videoId };
    }

    // Channel crawls are for signed-in users only.
    const userId = await callerUserId();
    if (!userId) {
      return { error: "Sign in to crawl whole channels — it's free.", authRequired: true } as const;
    }

    let found;
    try { found = await yt.discoverChannel(parsed.url); } catch (e) {
      // YouTube refused discovery (often a temporary bot check). If we already know this
      // channel, resume from the saved video list instead of failing.
      const id = parsed.url.match(/channel\/(UC[\w-]{22})/)?.[1];
      const cached = id ? await db.from("channels").select("id").eq("id", id).maybeSingle() : null;
      if (!id || !cached?.data) return { error: (e as Error).message } as const;
      await db.from("videos").update({ status: "pending", attempts: 0, status_detail: null })
        .eq("channel_id", id).eq("status", "unavailable").ilike("status_detail", "%not a bot%");
      await db.from("projects").update({ updated_at: new Date().toISOString() }).eq("user_id", userId).eq("channel_id", id);
      return { kind: "channel" as const, channelId: id, cached: true, newVideos: 0 };
    }
    const { channel, videos } = found;
    const existing = await db.from("channels").select("id").eq("id", channel.channelId).maybeSingle();
    await db.from("channels").upsert({
      id: channel.channelId, title: channel.title, handle: channel.handle, thumbnail: channel.thumbnail,
      video_count: videos.length, updated_at: new Date().toISOString(),
    });
    // Save the crawl as the user's project so they can resume or update later.
    const { data: tokenMeta } = await callerProfile();
    await db.from("profiles").upsert({ user_id: userId, ...tokenMeta }, { onConflict: "user_id", ignoreDuplicates: true });
    await db.from("projects").upsert({
      user_id: userId, channel_id: channel.channelId, channel_title: channel.title,
      thumbnail: channel.thumbnail, video_count: videos.length, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,channel_id" });
    // Register new videos as pending; keep already-resolved ones (cache).
    // Saved fields are never overwritten — discovery only fills in what's still missing.
    const known = new Set<string>();
    const byId = new Map(videos.map((v) => [v.id, v]));
    for (let i = 0; i < videos.length; i += 500) {
      const ids = videos.slice(i, i + 500).map((v) => v.id);
      const { data: rows } = await db.from("videos")
        .select("id,title,status,status_detail,views,duration_seconds,publish_date").in("id", ids);
      for (const r of rows ?? []) {
        known.add(r.id);
        const d = byId.get(r.id);
        // Repair rows hit by a temporary YouTube bot check: requeue them.
        const blocked = r.status === "unavailable" && /not a bot|sign in to confirm/i.test(r.status_detail ?? "");
        const patch: Record<string, unknown> = {};
        if (!r.title && d?.title) patch.title = d.title;
        if (r.views == null && d?.views != null) patch.views = d.views;
        if (r.duration_seconds == null && d?.durationSeconds != null) patch.duration_seconds = d.durationSeconds;
        if (r.publish_date == null && d?.publishDate) patch.publish_date = d.publishDate;
        if (blocked) Object.assign(patch, { status: "pending", attempts: 0, status_detail: null });
        if (Object.keys(patch).length) await db.from("videos").update(patch).eq("id", r.id);
      }
    }
    const fresh = videos.map((v, i) => ({ v, i })).filter(({ v }) => !known.has(v.id));
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await db.from("videos").insert(
        fresh.slice(i, i + 500).map(({ v, i: pos }) => ({
          id: v.id, channel_id: channel.channelId, title: v.title, position: pos, status: "pending",
          views: v.views ?? null, duration_seconds: v.durationSeconds ?? null, publish_date: v.publishDate ?? null,
        })),
      );
      if (error) return { error: error.message } as const;
    }
    // Keep ordering fresh for known videos too.
    if (data.refresh) {
      await db.from("videos").update({ status: "pending", attempts: 0 }).eq("channel_id", channel.channelId).eq("status", "failed");
    }
    return { kind: "channel" as const, channelId: channel.channelId, cached: !!existing.data, newVideos: fresh.length };
  });

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

/** Process one paced batch of pending videos. The browser calls this repeatedly until remaining = 0. */
export const processBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ channelId: z.string().regex(/^UC[\w-]{22}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const yt = await import("./youtube.server");
    const db = await admin();
    const { supabase, userId, claims } = context;
    const today = new Date().toISOString().slice(0, 10);

    // Make sure the profile row exists (projects reference it).
    await db.from("profiles").upsert({ user_id: userId, ...metaFromClaims(claims) }, { onConflict: "user_id", ignoreDuplicates: true });

    const [{ data: usage }, { data: wallet }] = await Promise.all([
      supabase.from("daily_usage").select("used").eq("user_id", userId).eq("day", today).maybeSingle(),
      supabase.from("wallets").select("credits").eq("user_id", userId).maybeSingle(),
    ]);
    const used = usage?.used ?? 0;
    const credits = wallet?.credits ?? 0;
    const freeLeft = Math.max(0, FREE_DAILY - used);
    const allowance = freeLeft + credits;
    if (allowance <= 0) {
      const { count } = await db.from("videos").select("id", { count: "exact", head: true })
        .eq("channel_id", data.channelId).eq("status", "pending");
      return { processed: 0, remaining: count ?? 0, throttled: false, quotaExceeded: true, freeLeft: 0, credits };
    }

    const limit = Math.min(BATCH, allowance);
    const { data: todo, error } = await db.from("videos")
      .select("id,attempts,title,views,duration_seconds,publish_date,transcript,caption_lang")
      .eq("channel_id", data.channelId).eq("status", "pending").order("position").limit(limit);
    if (error) throw new Error(error.message);

    let throttled = false;
    let resolvedCount = 0;
    await yt.pool(todo ?? [], 3, async (v) => {
      // A transcript we already have is never fetched (or charged) again.
      if (v.transcript) {
        await db.from("videos").update({ status: "ok", status_detail: null, updated_at: new Date().toISOString() }).eq("id", v.id);
        return;
      }
      try {
        const r = await yt.extractVideo(v.id, v.title);
        await db.from("videos").update({ ...keepSaved(toRow(r), v), attempts: v.attempts + 1 }).eq("id", v.id);
        resolvedCount++;
      } catch (e) {
        const msg = (e as Error).message;
        // Bot checks / rate limits are temporary: keep the video pending and don't charge for it,
        // but keep any details (date, views, length) that did come through.
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
        if (final) resolvedCount++;
      }
    });

    const processed = resolvedCount;
    const freeUsed = Math.min(freeLeft, processed);
    const creditUsed = processed - freeUsed;
    if (freeUsed > 0) {
      await db.from("daily_usage").upsert({ user_id: userId, day: today, used: used + freeUsed });
    }
    if (creditUsed > 0) {
      await db.from("wallets").upsert({ user_id: userId, credits: credits - creditUsed, updated_at: new Date().toISOString() });
      await db.from("credit_ledger").insert({
        user_id: userId, delta: -creditUsed, type: "crawl",
        description: `Channel crawl — ${creditUsed} videos beyond the free daily quota`,
      });
    }

    const { count } = await db.from("videos").select("id", { count: "exact", head: true })
      .eq("channel_id", data.channelId).eq("status", "pending");
    return { processed, remaining: count ?? 0, throttled, quotaExceeded: false, freeLeft: Math.max(0, freeLeft - freeUsed), credits: credits - creditUsed };
  });

function toRow(r: import("./youtube.server").VideoResult) {
  return {
    id: r.id,
    title: r.title,
    publish_date: r.publishDate,
    views: r.views,
    duration_seconds: r.durationSeconds,
    status: r.status,
    status_detail: r.status === "ok" ? null : r.statusDetail,
    caption_lang: r.captionLang,
    transcript: r.transcript,
    word_count: r.transcript ? r.transcript.split(/\s+/).length : 0,
    updated_at: new Date().toISOString(),
  };
}
