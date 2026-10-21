import { z } from "zod";
import { normalizeCues, type Cue } from "./captions";

export const ANALYSIS_VERSION = 1;
export const ANALYSIS_COST = { read: 0, watch: 10 } as const;
export type AnalysisTier = keyof typeof ANALYSIS_COST;
export const settingsSchema = z.object({
  readFamily: z.enum(["minimax", "deepseek"]).default("minimax"),
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

export const analysisResultSchema = z.object({
  summary: z.string().min(1).max(6000),
  thesis: z.string().min(1).max(3000),
  hook: z.string().max(3000),
  structure: z.array(z.object({ segmentId: z.string(), label: z.string().max(500), explanation: z.string().max(2000) })).max(1000),
  tone: z.string().max(3000),
  claims: z.array(z.object({ segmentId: z.string(), claim: z.string().max(3000), evidence: z.string().max(3000), caveat: z.string().max(3000) })).max(1000),
  mentalModels: z.array(z.string().max(2000)).max(30),
  intent: z.string().max(3000),
  cta: z.string().max(3000),
  keyMoments: z.array(z.object({ segmentId: z.string(), label: z.string().max(1000) })).max(1000),
  observations: z.array(z.object({ segmentId: z.string(), seen: z.string().max(3000), heard: z.string().max(3000), mismatch: z.string().max(3000) })).max(1000).default([]),
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export function validateAnalysis(value: unknown, segments: Segment[], tier: AnalysisTier) {
  const result = analysisResultSchema.parse(value);
  const ids = new Set(segments.map((s) => s.id));
  for (const item of [...result.structure, ...result.claims, ...result.keyMoments, ...result.observations]) {
    if (!ids.has(item.segmentId)) throw new Error("Analysis returned an unknown segment anchor.");
  }
  if (tier === "watch" && (!result.observations.length || segments.some((s) => !result.observations.some((o) => o.segmentId === s.id)))) {
    throw new Error("Watch analysis did not cover every segment.");
  }
  if (tier === "read") result.observations = [];
  return result;
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