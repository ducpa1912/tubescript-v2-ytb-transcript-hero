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
/** Accepts common provider wrapper variants; content is still strictly validated afterwards. */
export function normalizeWatchShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] && typeof value[0] === "object" && Array.isArray((value[0] as Record<string, unknown>)["moments"])) return value[0];
    return { summary: "Audiovisual moments for this video.", visual_narrative: "", moments: value };
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["result", "analysis", "data", "output"]) {
      const inner = o[k];
      if (inner && typeof inner === "object" && !Array.isArray(inner) && Array.isArray((inner as Record<string, unknown>)["moments"])) return inner;
    }
    if (!Array.isArray(o["moments"])) for (const k of ["observations", "timeline", "segments"]) if (Array.isArray(o[k])) return { ...o, moments: o[k] };
  }
  return value;
}
const MISSING_TOLERANCE = (n: number) => Math.max(2, Math.ceil(n * 0.15));
export function validateWatch(value: unknown, segments: Segment[]) {
  const raw = normalizeWatchShape(value) as Record<string, unknown> | null;
  if (raw && Array.isArray(raw["moments"])) {
    // Drop individually malformed or unknown-anchor moments instead of rejecting the whole result.
    raw["moments"] = raw["moments"].filter((m) => watchMomentSchema.safeParse(m).success
      && segments.some((s) => s.id === (m as { segmentId: string }).segmentId && s.start != null && s.end != null));
  }
  const parsed = watchResultSchema.parse(raw);
  const coverage = new Set<string>();
  const anchors = new Map(segments.map((s) => [s.id, s]));
  const moments = parsed.moments.flatMap((m) => {
    const segment = anchors.get(m.segmentId)!;
    if (coverage.has(m.segmentId)) return [];
    coverage.add(m.segmentId);
    const round = (n: number) => Math.round(n * 100) / 100;
    // Segment timing is authoritative; clamp drifting model timestamps into the caption interval.
    const at = Math.min(segment.end!, Math.max(segment.start!, m.at));
    return [{ ...m, at: round(at), start: round(segment.start!), end: round(segment.end!) }];
  });
  if (segments.length - coverage.size > MISSING_TOLERANCE(segments.length)) throw new Error(`Watch covered only ${coverage.size}/${segments.length} synchronized moments.`);
  const order = new Map(segments.map((s, i) => [s.id, i]));
  moments.sort((a, b) => (order.get(a.segmentId) ?? 0) - (order.get(b.segmentId) ?? 0));
  return { ...parsed, moments };
}
export function watchNeedsRefresh(cache: { watch_format: number; created_at: string } | null, requestedAt?: string | null) {
  return !cache || cache.watch_format !== WATCH_FORMAT || Boolean(requestedAt && new Date(cache.created_at).getTime() < new Date(requestedAt).getTime());
}