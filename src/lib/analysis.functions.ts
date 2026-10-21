import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ANALYSIS_COST, ANALYSIS_VERSION, DEFAULT_ANALYSIS_SETTINGS, analysisFailureStatus, buildSegments, settingsSchema, type AnalysisTier, type AnalysisSettings } from "./analysis";
import { normalizeCues } from "./captions";
import type { Json } from "@/integrations/supabase/types";
import { WATCH_FORMAT, watchNeedsRefresh } from "./watch";

const videoId = z.string().regex(/^[\w-]{11}$/);
const tier = z.enum(["read", "watch"]);
const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
type Db = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

export const getAnalysisSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.from("analysis_settings").select("settings").eq("user_id", context.userId).maybeSingle();
  if (error) throw new Error("Could not load analysis settings.");
  return settingsSchema.parse(data?.settings ?? DEFAULT_ANALYSIS_SETTINGS);
});
export const saveAnalysisSettings = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => settingsSchema.parse(input)).handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("analysis_settings").upsert({ user_id: context.userId, settings: asJson(data), updated_at: new Date().toISOString() });
    if (error) throw new Error("Could not save analysis settings.");
    return data;
  });
export const getAnalysisModels = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async () => {
  const { availableRoutes } = await import("./ai-router.server");
  const [read, watch] = await Promise.all([availableRoutes(DEFAULT_ANALYSIS_SETTINGS, "read"), availableRoutes({ ...DEFAULT_ANALYSIS_SETTINGS, autoRollup: true }, "watch")]);
  return { read: read.map(({ provider, model }) => ({ provider, model })), watch: watch.map(({ provider, model }) => ({ provider, model })) };
});
export const getAnalyses = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ videoId }).parse(input)).handler(async ({ data, context }) => {
    const { data: analyses, error } = await context.supabase.from("video_analyses").select("*").eq("video_id", data.videoId).eq("version", ANALYSIS_VERSION);
    if (error) throw new Error("Could not load analysis.");
    return analyses ?? [];
  });
export const listAnalysisJobs = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
    const [active, recent] = await Promise.all([
      context.supabase.from("analysis_jobs").select("*").eq("user_id", context.userId).in("status", ["pending", "running"]).order("created_at").limit(200),
      context.supabase.from("analysis_jobs").select("*").eq("user_id", context.userId).in("status", ["done", "failed"]).order("updated_at", { ascending: false }).limit(100),
    ]);
  if (active.error || recent.error) throw new Error("Could not load analysis queue.");
  return [...(active.data ?? []), ...(recent.data ?? [])];
});
export const enqueueAnalyses = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ videoIds: z.array(videoId).min(1).max(10), tier, refresh: z.boolean().default(false) }).parse(input)).handler(async ({ data, context }) => {
    if (data.refresh && data.tier !== "watch") throw new Error("Only Watch supports refresh.");
    const ids = [...new Set(data.videoIds)];
    const [{ data: access, error: accessError }, { data: preferences }] = await Promise.all([
      context.supabase.from("user_video_unlocks").select("video_id").eq("user_id", context.userId).in("video_id", ids),
      context.supabase.from("analysis_settings").select("settings").eq("user_id", context.userId).maybeSingle(),
    ]);
    if (accessError || access?.length !== ids.length) throw new Error("Unlock every selected transcript before analysis.");
    const settings = settingsSchema.parse(preferences?.settings ?? DEFAULT_ANALYSIS_SETTINGS);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    if (data.refresh) {
      const { data: unlocks, error: unlockError } = await context.supabase.from("user_analysis_unlocks").select("video_id").eq("user_id", context.userId).eq("tier", "watch").eq("version", ANALYSIS_VERSION).in("video_id", ids);
      if (unlockError || unlocks?.length !== ids.length) throw new Error("Unlock Watch before refreshing it.");
    }
    const { data: caches, error: cacheError } = await db.from("video_analyses").select("video_id,watch_format").in("video_id", ids).eq("tier", data.tier).eq("version", ANALYSIS_VERSION);
    if (cacheError) throw new Error("Could not read analysis cache.");
    if (data.refresh || caches?.length !== ids.length || (data.tier === "watch" && caches.some((c) => c.watch_format !== WATCH_FORMAT))) {
      const { availableRoutes } = await import("./ai-router.server");
      if (!(await availableRoutes(settings, data.tier)).length) throw new Error("No eligible model is available. Check model settings.");
    }
    const { data: old, error: oldError } = await context.supabase.from("analysis_jobs").select("id,video_id,status").eq("user_id", context.userId).eq("tier", data.tier).eq("version", ANALYSIS_VERSION).in("video_id", ids);
    if (oldError) throw new Error("Could not load existing jobs.");
    const fresh = ids.filter((id) => !old?.some((j) => j.video_id === id));
    if (fresh.length) {
      const { error } = await db.from("analysis_jobs").upsert(fresh.map((id) => ({ user_id: context.userId, video_id: id, tier: data.tier, settings: asJson(settings), refresh_requested_at: data.refresh ? new Date().toISOString() : null })), { onConflict: "user_id,video_id,tier,version", ignoreDuplicates: true });
      if (error) throw new Error("Could not queue analyses.");
    }
    const stale = new Set(caches?.filter((c) => data.tier === "watch" && c.watch_format !== WATCH_FORMAT).map((c) => c.video_id));
    const retries = old?.filter((j) => j.status === "failed" || (j.status === "done" && (data.refresh || stale.has(j.video_id)))).map((j) => j.id) ?? [];
    if (retries.length) {
      const { error } = await db.from("analysis_jobs").update({ status: "pending", attempts: 0, error: null, lease_until: null, refresh_requested_at: data.refresh ? new Date().toISOString() : null, available_at: new Date().toISOString(), settings: asJson(settings) }).eq("user_id", context.userId).in("id", retries).in("status", ["done", "failed"]);
      if (error) throw new Error("Could not retry analyses.");
    }
    return { queued: fresh.length + retries.length };
  });

async function generate(db: Db, user: string, id: string, analysisTier: AnalysisTier, settings: AnalysisSettings, requestedAt?: string | null) {
  const cached = await db.from("video_analyses").select("*").eq("video_id", id).eq("tier", analysisTier).eq("version", ANALYSIS_VERSION).maybeSingle();
  if (cached.error) throw new Error("Could not read analysis cache.");
  if (cached.data && (analysisTier === "read" || !watchNeedsRefresh(cached.data, requestedAt))) return cached.data;
  const token = crypto.randomUUID();
  const { data: claimed, error } = await db.rpc("claim_analysis_generation", { _video: id, _tier: analysisTier, _version: ANALYSIS_VERSION, _token: token });
  if (error || !claimed) throw new Error("Another analysis is running; retry shortly.");
  try {
    const [{ data: text }, { data: timings }, { data: video }] = await Promise.all([
      db.from("video_transcripts").select("transcript").eq("video_id", id).maybeSingle(),
      db.from("video_caption_cues").select("cues").eq("video_id", id).maybeSingle(),
      db.from("videos").select("title,duration_seconds").eq("id", id).maybeSingle(),
    ]);
    if (!text?.transcript) throw new Error("Transcript is missing. No credits spent.");
    const segments = buildSegments(text.transcript, normalizeCues(timings?.cues));
    if (analysisTier === "watch" && segments.some((s) => s.start == null)) throw new Error("Add timestamps before Watch analysis. No credits spent.");
    // Watch runs independently from Read: no tier-1 output is fed in, so it cannot be diluted or anchored.
    const { routeAnalysis } = await import("./ai-router.server");
    const { data: categories, error: categoryError } = analysisTier === "watch"
      ? await db.from("watch_categories").select("slug,label,description").order("slug").limit(200)
      : { data: [], error: null };
    if (categoryError) throw new Error("Could not load Watch vocabulary.");
    const signals = analysisTier === "watch" ? await (await import("./youtube.server")).extractVideoSignals(id) : { heatMoments: [], chapters: [] };
    const result = await routeAnalysis({ tier: analysisTier, videoId: id, title: video?.title ?? id, segments, settings, durationS: video?.duration_seconds ?? 0, categories: categories ?? [], ...signals }, async (route, outcome, detail, ms) => {
      try { await db.from("pipeline_logs").insert({ user_id: user, video_id: id, stage: `analysis_${analysisTier}`, route: `${route.provider}/${route.model}`, outcome, detail, duration_ms: ms }); } catch { /* Logging must not stop delivery. */ }
    });
    const { error: saveError } = analysisTier === "watch"
      ? await db.rpc("replace_watch_analysis", { _video: id, _token: token, _result: asJson(result.result), _segments: asJson(segments), _provider: result.provider, _model: result.model, _usage: asJson(result.usage) })
      : await db.from("video_analyses").upsert({ video_id: id, tier: analysisTier, version: ANALYSIS_VERSION, result: asJson(result.result), segments: asJson(segments), provider: result.provider, model: result.model, usage: asJson(result.usage) }, { onConflict: "video_id,tier,version", ignoreDuplicates: true });
    if (saveError) throw new Error("Could not save analysis. No credits spent.");
    const { data: saved, error: readError } = await db.from("video_analyses").select("*").eq("video_id", id).eq("tier", analysisTier).eq("version", ANALYSIS_VERSION).single();
    if (readError) throw new Error("Could not read saved analysis.");
    return saved;
  } finally {
    await db.from("analysis_generation_leases").delete().eq("video_id", id).eq("tier", analysisTier).eq("version", ANALYSIS_VERSION).eq("token", token);
  }
}

/** Each job is its own invocation; browser batches at most three invocations concurrently. */
export const processAnalysisJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input)).handler(async ({ data, context }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: jobs, error } = await db.rpc("claim_analysis_job", { _user: context.userId, _job: data.jobId });
    if (error) throw new Error("Could not claim analysis job.");
    const job = jobs?.[0];
    if (!job) return { status: "waiting" };
    try {
      const { data: access } = await context.supabase.from("user_video_unlocks").select("video_id").eq("user_id", context.userId).eq("video_id", job.video_id).maybeSingle();
      if (!access) throw new Error("Unlock this transcript first.");
      const analysisTier = tier.parse(job.tier);
      if (analysisTier === "watch") {
        const [{ data: unlocked }, { data: wallet }] = await Promise.all([
          context.supabase.from("user_analysis_unlocks").select("video_id").eq("user_id", context.userId).eq("video_id", job.video_id).eq("tier", "watch").eq("version", ANALYSIS_VERSION).maybeSingle(),
          context.supabase.from("wallets").select("credits").eq("user_id", context.userId).maybeSingle(),
        ]);
        if (!unlocked && (wallet?.credits ?? 0) < ANALYSIS_COST.watch) throw new Error("Watch requires 10 credits. No credits spent.");
      }
      await generate(db, context.userId, job.video_id, analysisTier, settingsSchema.parse(job.settings), job.refresh_requested_at);
      const { data: delivered, error: deliveryError } = await db.rpc("deliver_analysis_unlock", { _user: context.userId, _video: job.video_id, _tier: analysisTier, _version: ANALYSIS_VERSION });
      const delivery = delivered as { delivered?: boolean; charged?: number } | null;
      if (deliveryError || !delivery?.delivered) throw new Error("Analysis saved, but delivery needs sufficient credits. No credits spent.");
      const { error: doneError } = await db.from("analysis_jobs").update({ status: "done", error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      if (doneError) throw new Error("Analysis delivered; queue status could not be saved. Retry safely.");
      await db.from("pipeline_logs").insert({ user_id: context.userId, video_id: job.video_id, stage: "analysis_billing", route: "shared_cache_unlock", outcome: "delivered", detail: `${analysisTier}: ${delivery.charged ?? 0} credits` });
      return { status: "done" };
    } catch (e) {
      const detail = e instanceof Error ? e.message : "Analysis failed.";
      const terminal = (e instanceof Error && "terminal" in e && e.terminal === true) || /10 credits|Unlock this transcript|Add timestamps|Transcript is missing/.test(detail);
      const status = analysisFailureStatus(job.attempts, terminal);
      const wait = 5000 * 2 ** job.attempts + Math.round(Math.random() * 1000);
      const { error: updateError } = await db.from("analysis_jobs").update({ status, error: detail, lease_until: null, available_at: new Date(Date.now() + wait).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      if (updateError) throw new Error("Could not save the analysis failure. Queue recovery will wait for the lease.");
      try { await db.from("pipeline_logs").insert({ user_id: context.userId, video_id: job.video_id, stage: `analysis_${job.tier}`, route: "job_runner", outcome: status, detail: `Attempt ${job.attempts}/3: ${detail}` }); } catch { /* Diagnostics must not break job state. */ }
      return { status, error: detail };
    }
  });