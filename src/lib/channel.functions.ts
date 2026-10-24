import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBriefPrompt, buildChatPrompt, buildScriptPrompt, retrieve, scoreChannel, type ChannelVideo } from "./channel";
import { dossierMarkdown, parseChannelDossier, validateChannelDossier } from "./channel-intelligence";

const channelId = z.string().min(1).max(64);
type Ctx = { supabase: any; userId: string };

/** Loads channel videos plus the transcripts this user has unlocked (RLS-protected read). */
async function loadChannel(ctx: Ctx, id: string, withText: boolean) {
  const list: ChannelVideo[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data: videos, error } = await ctx.supabase.from("videos").select("id, title, views, publish_date, duration_seconds").eq("channel_id", id).order("publish_date", { ascending: false }).order("id").range(offset, offset + 499);
    if (error) throw new Error("Could not load channel videos.");
    list.push(...(videos ?? []) as ChannelVideo[]);
    if (!videos || videos.length < 500) break;
  }
  if (!withText || !list.length) return list;
  const ids = list.map((v) => v.id);
  const text = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data: unlocks, error: unlockError } = await ctx.supabase.from("user_video_unlocks").select("video_id").eq("user_id", ctx.userId).in("video_id", ids.slice(i, i + 100));
    if (unlockError) throw new Error("Could not verify your unlocked channel transcripts.");
    const owned = (unlocks ?? []).map((u: { video_id: string }) => u.video_id);
    if (!owned.length) continue;
    const { data: rows, error: textError } = await ctx.supabase.from("video_transcripts").select("video_id, transcript").in("video_id", owned);
    if (textError) throw new Error("Could not load your channel scripts. Previous analysis was kept.");
    for (const r of rows ?? []) text.set(r.video_id, r.transcript);
  }
  return list.map((v) => ({ ...v, transcript: text.get(v.id) }));
}
/** Channel Brain needs every captioned video unlocked AND Read-analysed by this user. */
async function readiness(ctx: Ctx, id: string, videos: { id: string; transcript?: string | undefined }[]) {
  const { data: ok } = await ctx.supabase.from("videos").select("id").eq("channel_id", id).eq("status", "ok").limit(5000);
  const captioned = new Set<string>((ok ?? []).map((r: { id: string }) => r.id));
  const unlocked = videos.filter((v) => v.transcript && captioned.has(v.id)).map((v) => v.id);
  const read = new Set<string>();
  for (let i = 0; i < unlocked.length; i += 100) {
    const { data } = await ctx.supabase.from("video_analyses").select("video_id").eq("tier", "read").in("video_id", unlocked.slice(i, i + 100));
    for (const r of data ?? []) read.add(r.video_id);
  }
  const missingRead = unlocked.filter((v) => !read.has(v));
  return { captioned: captioned.size, unlocked: unlocked.length, analysed: read.size, missingRead, ready: captioned.size >= 3 && unlocked.length >= captioned.size && read.size >= captioned.size };
}
async function loadBrief(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase.from("channel_briefs").select("*").eq("user_id", ctx.userId).eq("channel_id", id).maybeSingle();
  return data as { markdown: string; stats: Record<string, number>; updated_at: string; video_count: number; model: string } | null;
}
async function admin() { return (await import("@/integrations/supabase/client.server")).supabaseAdmin; }
async function log(userId: string, stage: string, route: string, outcome: string, detail: string, ms: number) {
  try { await (await admin()).from("pipeline_logs").insert({ user_id: userId, stage, route, outcome, detail: detail.slice(0, 2000), duration_ms: ms }); } catch { /* never block */ }
}

export const getChannelBrain = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ channelId }).parse(i)).handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const [videos, brief, scripts, project] = await Promise.all([
      loadChannel(ctx, data.channelId, true), loadBrief(ctx, data.channelId),
      ctx.supabase.from("generated_scripts").select("id, mode, input, output, created_at").eq("user_id", ctx.userId).eq("channel_id", data.channelId).order("created_at", { ascending: false }).limit(20),
      ctx.supabase.from("projects").select("channel_title").eq("user_id", ctx.userId).eq("channel_id", data.channelId).maybeSingle(),
    ]);
    const stats = scoreChannel(videos);
    return {
      channelTitle: (project.data?.channel_title as string) || data.channelId,
      brief, dossier: brief ? parseChannelDossier(brief.markdown) : null, scripts: scripts.data ?? [],
      readiness: await readiness(ctx, data.channelId, videos),
      stats: { ...stats, videos: stats.videos.map(({ transcript, ...v }) => ({ ...v, hasTranscript: Boolean(transcript) })) },
    };
  });

export const generateChannelBrief = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ channelId }).parse(i)).handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const [videos, project] = await Promise.all([loadChannel(ctx, data.channelId, true), ctx.supabase.from("projects").select("channel_title").eq("user_id", ctx.userId).eq("channel_id", data.channelId).maybeSingle()]);
    const withText = videos.filter((v) => v.transcript).length;
    const ready = await readiness(ctx, data.channelId, videos);
    if (!ready.ready) throw new Error(`Channel Brain needs every captioned video unlocked and Read-analysed first (${ready.unlocked}/${ready.captioned} transcripts, ${ready.analysed}/${ready.captioned} Read analyses).`);
    const stats = scoreChannel(videos);
    const { routeText } = await import("./ai-router.server");
    const start = Date.now();
    try {
      const out = await routeText(buildBriefPrompt((project.data?.channel_title as string) || data.channelId, stats), { json: true, maxTokens: 32000 });
      const dossier = validateChannelDossier(JSON.parse(out.text), stats.videos);
      const { error: saveError } = await (await admin()).from("channel_briefs").upsert({ user_id: ctx.userId, channel_id: data.channelId, markdown: JSON.stringify(dossier), model: out.model, video_count: withText,
        stats: { medianViews: stats.medianViews, hits: stats.hits, flops: stats.flops, count: stats.count }, updated_at: new Date().toISOString() });
      if (saveError) throw new Error("Could not save channel analysis; your previous analysis was kept.");
      await log(ctx.userId, "channel_brief", out.model, "success", `${withText} transcripts`, Date.now() - start);
      return { markdown: JSON.stringify(dossier) };
    } catch (e) {
      await log(ctx.userId, "channel_brief", "ai-router", "failed", e instanceof Error ? e.message : "failed", Date.now() - start);
      throw e;
    }
  });

export const askChannelBrain = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ channelId, question: z.string().min(2).max(2000),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(20).default([]) }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const [videos, brief] = await Promise.all([loadChannel(ctx, data.channelId, true), loadBrief(ctx, data.channelId)]);
    if (!brief) throw new Error("Generate the channel analysis first.");
    const chunks = retrieve(data.question + " " + data.history.slice(-2).map((m) => m.content).join(" "), videos);
    const { routeText } = await import("./ai-router.server");
    const dossier = parseChannelDossier(brief.markdown);
    const briefText = dossier ? dossierMarkdown(dossier, data.channelId, videos) : brief.markdown;
    const out = await routeText(buildChatPrompt(briefText, data.question, chunks, data.history), { maxTokens: 3000, timeoutMs: 180000 });
    return { answer: out.text, sources: [...new Map(chunks.map((c) => [c.videoId, { videoId: c.videoId, title: c.title }])).values()] };
  });

export const generateScript = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ channelId, mode: z.enum(["replicate", "style", "gap"]), topic: z.string().max(500).optional(),
    sourceVideoId: z.string().regex(/^[\w-]{11}$/).optional(), ownChannelId: channelId.optional(), lengthMin: z.number().int().min(1).max(60).default(10) }).parse(i))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const brief = await loadBrief(ctx, data.channelId);
    if (!brief) throw new Error("Generate the channel analysis first.");
    const channelVideos = await loadChannel(ctx, data.channelId, true);
    const dossier = parseChannelDossier(brief.markdown);
    const briefText = dossier ? dossierMarkdown(dossier, data.channelId, channelVideos) : brief.markdown;
    let source: ChannelVideo | undefined;
    if (data.mode === "replicate") {
      if (!data.sourceVideoId) throw new Error("Choose a source video to replicate.");
      source = channelVideos.find((v) => v.id === data.sourceVideoId);
      if (!source?.transcript) throw new Error("Unlock that video's transcript first.");
    }
    let ownBrief: string | undefined;
    if (data.mode === "gap") {
      const own = await loadBrief(ctx, data.ownChannelId ?? data.channelId);
      if (!own) throw new Error("Crawl your own channel and generate its channel analysis first.");
      const ownDossier = parseChannelDossier(own.markdown);
      ownBrief = ownDossier ? dossierMarkdown(ownDossier, data.ownChannelId ?? data.channelId, await loadChannel(ctx, data.ownChannelId ?? data.channelId, false)) : own.markdown;
    }
    const { routeText } = await import("./ai-router.server");
    const start = Date.now();
    const out = await routeText(buildScriptPrompt(data.mode, { brief: briefText, ownBrief, topic: data.topic, source, lengthMin: data.lengthMin }), { maxTokens: 9000 });
    const { data: saved } = await (await admin()).from("generated_scripts").insert({ user_id: ctx.userId, channel_id: data.channelId, mode: data.mode, model: out.model,
      input: { topic: data.topic ?? "", sourceVideoId: data.sourceVideoId ?? "", ownChannelId: data.ownChannelId ?? "", lengthMin: data.lengthMin }, output: out.text }).select("id, created_at").single();
    await log(ctx.userId, "script_generate", out.model, "success", data.mode, Date.now() - start);
    return { id: saved?.id, output: out.text };
  });
