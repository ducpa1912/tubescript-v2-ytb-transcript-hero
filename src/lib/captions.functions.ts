import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeCues, refreshCharge } from "./captions";

/** Legacy text never changes; enrichment is a separate, explicitly requested entitlement. */
export const addTimestamps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: unlock, error } = await context.supabase.from("user_video_unlocks").select("video_id").eq("user_id", context.userId).eq("video_id", data.videoId).maybeSingle();
    if (error || !unlock) throw new Error("Unlock this transcript first.");
    const { data: existing } = await context.supabase.from("video_caption_cues").select("cues").eq("video_id", data.videoId).maybeSingle();
    if (existing) return { cues: normalizeCues(existing.cues) };
    const day = new Date().toISOString().slice(0, 10);
    const [{ data: usage }, { data: wallet }] = await Promise.all([
      context.supabase.from("daily_usage").select("used").eq("user_id", context.userId).eq("day", day).maybeSingle(),
      context.supabase.from("wallets").select("credits").eq("user_id", context.userId).maybeSingle(),
    ]);
    if (!refreshCharge(usage?.used ?? 0, wallet?.credits ?? 0)) throw new Error("No allowance remaining. Add credits or return tomorrow.");
    let { data: cached } = await db.from("video_caption_cues").select("cues").eq("video_id", data.videoId).maybeSingle();
    if (!cached) {
      const yt = await import("./youtube.server");
      const { data: meta } = await db.from("videos").select("title,views,duration_seconds,publish_date").eq("id", data.videoId).maybeSingle();
      const result = await yt.extractVideo(data.videoId, meta ? { title: meta.title, views: meta.views, durationSeconds: meta.duration_seconds, publishDate: meta.publish_date } : undefined);
      const cues = normalizeCues(result.cues);
      if (!cues.length) throw new Error("Timestamps are unavailable. No allowance was spent.");
      const { error: saveError } = await db.from("video_caption_cues").upsert({ video_id: data.videoId, cues }, { onConflict: "video_id", ignoreDuplicates: true });
      if (saveError) throw new Error("Could not save timestamps. No allowance was spent.");
      cached = (await db.from("video_caption_cues").select("cues").eq("video_id", data.videoId).maybeSingle()).data;
    }
    const { data: delivery, error: deliveryError } = await db.rpc("deliver_caption_unlock", { _user: context.userId, _video: data.videoId });
    const delivered = delivery as { delivered?: boolean } | null;
    if (deliveryError || !delivered?.delivered) throw new Error("Timestamps were saved, but your allowance is exhausted. Add credits or return tomorrow.");
    return { cues: normalizeCues(cached?.cues) };
  });