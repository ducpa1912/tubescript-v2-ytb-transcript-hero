import { z } from "zod";
import { normalizeCues, type Cue } from "./captions";

export const ANALYSIS_VERSION = 1;
export const ANALYSIS_COST = { read: 0, watch: 10 } as const;
export type AnalysisTier = keyof typeof ANALYSIS_COST;
export const settingsSchema = z.object({
  // Legacy setting is accepted for stored rows, but never permits paid Read routing.
  readPaidFallback: z.boolean().default(false),
  watchModel: z.enum(["google/gemini-3.1-flash-lite", "google/gemini-3.5-flash-lite"]).default("google/gemini-3.1-flash-lite"),
  autoRollup: z.boolean().default(false),
  provider: z.enum(["auto", "opencode-go", "opencode-zen", "openrouter"]).default("auto"),
  batchSize: z.number().int().min(5).max(10).default(5),
});
export type AnalysisSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_ANALYSIS_SETTINGS = settingsSchema.parse({});
export type Segment = { id: string; start: number | null; end: number | null; text: string };

/** Anchors come only from cached cues; untimed legacy text never gets invented timestamps. */
export function buildSegments(transcript: string, cues: Cue[]): Segment[] {
  const timed = normalizeCues(cues);
  const out: Segment[] = [];
  const push = (text: string, start: number | null, end: number | null) => {
    if (text.trim()) out.push({ id: `s${String(out.length + 1).padStart(2, "0")}`, start, end, text: text.trim() });
  };
  if (!timed.length) {
    const words = transcript.trim().split(/\s+/);
    for (let i = 0; i < words.length; i += 110) push(words.slice(i, i + 110).join(" "), null, null);
    return out;
  }
  let start = timed[0]?.start ?? 0, end = start, text = "", previous = "";
  for (const cue of timed) {
    if (text && (cue.start - start >= 45 || (end - start >= 20 && /[.!?]$/.test(text)))) {
      push(text, start, end); start = cue.start; text = "";
    }
    // Rolling auto-caption windows often repeat an entire preceding cue.
    if (cue.text !== previous) text += `${text ? " " : ""}${cue.text}`;
    previous = cue.text; end = Math.max(end, cue.start + cue.dur);
  }
  push(text, start, end);
  return out;
}

const safeStr = (max = 3000) => z.string().max(max).nullish().transform((v) => v ?? "");
const score = z.number().min(0).max(1).default(0);
export const hookAttributesSchema = z.object({ imperative: score, question: score, bold_claim: score,
  curiosity_gap: score, problem_solution: score, personal_story: score, pattern_interrupt: score });
const arcSchema = z.preprocess((v) => typeof v === "string" ? { primary: v } : v ?? {},
  z.object({ primary: safeStr(), arc: safeStr() }));
const hookSchema = z.preprocess((v) => typeof v === "string" ? { prose: v } : v ?? {},
  z.object({ prose: safeStr(), attributes: hookAttributesSchema.default({}) }));
export type HeatMoment = { startMs: number; intensity: number };
export const analysisResultSchema = z.preprocess((v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const old = v as Record<string, unknown>;
  // Additive reader compatibility: never rewrite or re-charge existing cached analyses.
  return { ...old, visual_narrative: old.visual_narrative ?? old.visualNarrative,
    onScreenText: Array.isArray(old.onScreenText) ? old.onScreenText.map((t) => typeof t === "string" ? { text: t } : t) : old.onScreenText };
}, z.object({
  summary: z.string().min(1).max(6000), thesis: z.string().min(1).max(3000),
  hook: hookSchema, tone: arcSchema, mood: arcSchema,
  intent: safeStr(), cta: safeStr(), delivery: safeStr(), energy_curve: safeStr(),
  visual_style: safeStr(), visual_narrative: safeStr(6000),
  structure: z.array(z.object({ segmentId: z.string(), label: safeStr(500), explanation: safeStr(2000) })).max(1000).default([]),
  claims: z.array(z.object({ segmentId: z.string(), claim: safeStr(), evidence: safeStr(), caveat: safeStr() })).max(1000).default([]),
  mentalModels: z.array(safeStr(2000)).max(30).default([]),
  keyMoments: z.array(z.object({ segmentId: z.string(), label: safeStr(1000), why: safeStr(1000) })).max(1000).default([]),
  observations: z.array(z.object({ segmentId: z.string(), seen: safeStr(), heard: safeStr(), mismatch: safeStr() })).max(1000).default([]),
  // Optional id only for legacy cached string entries; new model output requires an anchor below.
  onScreenText: z.array(z.object({ segmentId: z.string().optional(), text: safeStr(1000) })).max(200).default([]),
  heatMoments: z.array(z.object({ startMs: z.number().finite().nonnegative(), intensity: z.number().min(0).max(1) })).max(200).default([]),
}));
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export function validateAnalysis(value: unknown, segments: Segment[], tier: AnalysisTier) {
  const result = analysisResultSchema.parse(value);
  const ids = new Set(segments.map((s) => s.id));
  for (const item of [...result.structure, ...result.claims, ...result.keyMoments, ...result.observations, ...result.onScreenText]) {
    if (!item.segmentId || !ids.has(item.segmentId)) throw new Error("Analysis returned an unknown segment anchor.");
  }
  if (tier === "watch") {
    if (!result.observations.length) throw new Error("Watch analysis produced no observations.");
    const covered = new Set(result.observations.map((o) => o.segmentId));
    if (covered.size !== result.observations.length) throw new Error("Watch analysis returned duplicate observations.");
    const missing = segments.filter((s) => !covered.has(s.id));
    if (missing.length > Math.max(2, Math.ceil(segments.length * 0.15))) {
      throw new Error(`Watch analysis covered only ${covered.size}/${segments.length} segments.`);
    }
    for (const s of missing) result.observations.push({ segmentId: s.id, seen: "", heard: "", mismatch: "" });
    const order = new Map(segments.map((s, i) => [s.id, i]));
    result.observations.sort((a, b) => (order.get(a.segmentId) ?? 0) - (order.get(b.segmentId) ?? 0));
  }
  if (tier === "read") { result.observations = []; result.visual_style = ""; result.visual_narrative = ""; result.onScreenText = []; result.heatMoments = []; }
  return result;
}

/** Caption segments measure speech pacing, NOT visual cuts or B-roll. */
export function computeVideoFacts(segments: Segment[], durationS = 0, chapterCount = 0) {
  const intervals = segments.flatMap((s) => s.start != null && s.end != null && s.end > s.start ? [{ start: s.start, end: s.end, speech: Boolean(s.text.trim()) }] : []);
  const durations = intervals.map((s) => s.end - s.start).sort((a, b) => a - b);
  const duration = Number.isFinite(durationS) && durationS > 0 ? durationS : Math.max(0, ...intervals.map((s) => s.end));
  let speechDuration = 0, end = 0;
  for (const s of intervals.filter((s) => s.speech).sort((a, b) => a.start - b.start)) {
    speechDuration += Math.max(0, s.end - Math.max(end, s.start)); end = Math.max(end, s.end);
  }
  const wordsTotal = segments.reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0);
  const round = (n: number) => Math.round(n * 10) / 10;
  const mid = Math.floor(durations.length / 2);
  const median = durations.length % 2 ? durations[mid] ?? 0 : ((durations[mid - 1] ?? 0) + (durations[mid] ?? 0)) / 2;
  return { durationS: round(duration), segmentCount: segments.length, medianSegmentS: round(median), minSegmentS: durations[0] ?? 0,
    maxSegmentS: durations.at(-1) ?? 0, transcriptSegmentsPerMin: duration ? round(segments.length * 60 / duration) : 0,
    speechTimePct: duration ? Math.min(100, Math.round(speechDuration * 100 / duration)) : 0,
    wordsTotal, wordsPerMin: duration ? Math.round(wordsTotal * 60 / duration) : 0,
    longSegmentCount: durations.filter((d) => d >= 20).length, chapterCount };
}

export function analysisFailureStatus(attempts: number, terminal = false) {
  return terminal || attempts >= 3 ? "failed" : "pending";
}
export function isFreeModel(model: { id: string; pricing?: { prompt?: string | number; completion?: string | number } }) {
  return model.pricing?.prompt != null && model.pricing?.completion != null
    && Number(model.pricing.prompt) === 0 && Number(model.pricing.completion) === 0;
}
export function analysisDebit(tier: AnalysisTier, credits: number, alreadyUnlocked: boolean, delivered: boolean) {
  if (alreadyUnlocked || !delivered) return 0;
  const cost = ANALYSIS_COST[tier];
  if (credits < cost) throw new Error("Insufficient credits");
  return cost;
}