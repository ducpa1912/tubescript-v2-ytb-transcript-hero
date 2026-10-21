import { z } from "zod";
import type { Segment } from "./analysis";

export const WATCH_FORMAT = 2;
const text = z.string().max(6000).nullish().transform((v) => v ?? "");
export const shotCategorySchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(80).refine((s) => s !== "other", "Name a specific shot category."),
  label: z.string().min(1).max(120), description: text,
});
const effect = z.object({ description: text, purpose: text });
export const watchMomentSchema = z.object({
  segmentId: z.string(), at: z.number().finite().nonnegative(),
  what_is_seen: z.string().min(1).max(6000), shot_type: shotCategorySchema,
  diagram: z.object({ type: text, subject: text, explanation: text }).nullish().transform((v) => v ?? { type: "", subject: "", explanation: "" }),
  on_screen_text: z.array(z.string().max(2000)).max(30).default([]), body_language: text,
  vfx: effect.default({}), practical_effects: effect.default({}), sound_effects: effect.default({}),
  lighting: text, visual_change: text, visual_hook: text,
  heard: text, voice_tone: z.object({ quality: text, stress: text, pacing: text, volume: text }).default({}),
  text_tone: text, audiovisual_relation: text, caveat: text,
});
export const watchResultSchema = z.object({
  summary: z.string().min(1).max(6000), visual_narrative: text,
  moments: z.array(watchMomentSchema).min(1).max(1000),
});
export type WatchCategory = z.infer<typeof shotCategorySchema>;
export type WatchResult = ReturnType<typeof validateWatch>;
export function validateWatch(value: unknown, segments: Segment[]) {
  const parsed = watchResultSchema.parse(value);
  const coverage = new Set<string>();
  const anchors = new Map(segments.map((s) => [s.id, s]));
  const moments = parsed.moments.map((m) => {
    const segment = anchors.get(m.segmentId);
    if (!segment || segment.start == null || segment.end == null) throw new Error("Watch returned an unknown or untimed segment.");
    if (coverage.has(m.segmentId)) throw new Error("Watch returned duplicate moments.");
    if (m.at < segment.start || m.at > segment.end) throw new Error("Watch moment timestamp is outside its caption interval.");
    coverage.add(m.segmentId);
    const round = (n: number) => Math.round(n * 100) / 100;
    return { ...m, at: round(m.at), start: round(segment.start), end: round(segment.end) };
  });
  if (coverage.size !== segments.length) throw new Error(`Watch covered only ${coverage.size}/${segments.length} synchronized moments.`);
  const order = new Map(segments.map((s, i) => [s.id, i]));
  moments.sort((a, b) => (order.get(a.segmentId) ?? 0) - (order.get(b.segmentId) ?? 0));
  return { ...parsed, moments };
}
export function watchNeedsRefresh(cache: { watch_format: number; created_at: string } | null, requestedAt?: string | null) {
  return !cache || cache.watch_format !== WATCH_FORMAT || Boolean(requestedAt && new Date(cache.created_at).getTime() < new Date(requestedAt).getTime());
}