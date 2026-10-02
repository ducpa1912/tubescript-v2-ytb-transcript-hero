import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const BATCH = 9; // videos per call; 3 at a time x 2 player calls = 6 outbound (Worker cap)
const MAX_ATTEMPTS = 3;

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
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

    let found;
    try { found = await yt.discoverChannel(parsed.url); } catch (e) { return { error: (e as Error).message } as const; }
    const { channel, videos } = found;
    const existing = await db.from("channels").select("id").eq("id", channel.channelId).maybeSingle();
    await db.from("channels").upsert({
      id: channel.channelId, title: channel.title, handle: channel.handle, thumbnail: channel.thumbnail,
      video_count: videos.length, updated_at: new Date().toISOString(),
    });
    // Register new videos as pending; keep already-resolved ones (cache).
    const known = new Set<string>();
    for (let i = 0; i < videos.length; i += 500) {
      const ids = videos.slice(i, i + 500).map((v) => v.id);
      const { data: rows } = await db.from("videos").select("id").in("id", ids);
      rows?.forEach((r) => known.add(r.id));
    }
    const fresh = videos.map((v, i) => ({ v, i })).filter(({ v }) => !known.has(v.id));
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await db.from("videos").insert(
        fresh.slice(i, i + 500).map(({ v, i: pos }) => ({ id: v.id, channel_id: channel.channelId, title: v.title, position: pos, status: "pending" })),
      );
      if (error) return { error: error.message } as const;
    }
    // Keep ordering fresh for known videos too.
    if (data.refresh) {
      await db.from("videos").update({ status: "pending", attempts: 0 }).eq("channel_id", channel.channelId).eq("status", "failed");
    }
    return { kind: "channel" as const, channelId: channel.channelId, cached: !!existing.data, newVideos: fresh.length };
  });

/** Process one paced batch of pending videos. The browser calls this repeatedly until remaining = 0. */
export const processBatch = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ channelId: z.string().regex(/^UC[\w-]{22}$/) }).parse(d))
  .handler(async ({ data }) => {
    const yt = await import("./youtube.server");
    const db = await admin();
    const { data: todo, error } = await db.from("videos").select("id,attempts")
      .eq("channel_id", data.channelId).eq("status", "pending").order("position").limit(BATCH);
    if (error) throw new Error(error.message);
    let throttled = false;
    await yt.pool(todo ?? [], 3, async (v) => {
      try {
        const r = await yt.extractVideo(v.id);
        await db.from("videos").update({ ...toRow(r), attempts: v.attempts + 1 }).eq("id", v.id);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("429")) throttled = true;
        const final = v.attempts + 1 >= MAX_ATTEMPTS;
        await db.from("videos").update({
          attempts: v.attempts + 1, status: final ? "failed" : "pending", status_detail: msg, updated_at: new Date().toISOString(),
        }).eq("id", v.id);
      }
    });
    const { count } = await db.from("videos").select("id", { count: "exact", head: true })
      .eq("channel_id", data.channelId).eq("status", "pending");
    return { processed: todo?.length ?? 0, remaining: count ?? 0, throttled };
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
