// Client-safe retention deconstruction: YouTube replay heat is "most replayed", not true retention,
// so every label here stays phrased as replay interest, never measured audience retention.
import type { HeatMoment } from "./analysis";
import type { z } from "zod";
import type { watchResultSchema } from "./watch";

type Moment = z.infer<typeof watchResultSchema>["moments"][number];
export type RetentionEvent = { kind: "spike" | "drop"; startS: number; endS: number; intensity: number; change: number };
export type DeconstructedEvent = RetentionEvent & { moment: Moment | null; cues: string[]; risks: string[] };
export type RetentionTip = { id: string; title: string; detail: string; evidence: number[]; seen: boolean };

export const SPIKE_LIFT = 0.15;
export const DROP_FALL = 0.12;

function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function detectRetention(heat: HeatMoment[], max = 5): { baseline: number; spikes: RetentionEvent[]; drops: RetentionEvent[] } {
  const points = [...heat].sort((a, b) => a.startMs - b.startMs);
  const baseline = median(points.map((p) => p.intensity));
  const step = points.length > 1 ? (points[1]!.startMs - points[0]!.startMs) / 1000 : 0;
  const spikes: RetentionEvent[] = [];
  points.forEach((p, i) => {
    const prev = points[i - 1]?.intensity ?? -1, next = points[i + 1]?.intensity ?? -1;
    if (p.intensity >= prev && p.intensity >= next && p.intensity - baseline >= SPIKE_LIFT)
      spikes.push({ kind: "spike", startS: p.startMs / 1000, endS: p.startMs / 1000 + step, intensity: p.intensity, change: +(p.intensity - baseline).toFixed(3) });
  });
  const drops: RetentionEvent[] = [];
  type Run = { start: number; end: number; from: number; to: number };
  let run = null as Run | null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!;
    if (b.intensity < a.intensity) run = run ? { start: run.start, from: run.from, end: b.startMs, to: b.intensity } : { start: a.startMs, end: b.startMs, from: a.intensity, to: b.intensity };
    else if (run) { if (run.from - run.to >= DROP_FALL) drops.push(toDrop(run)); run = null; }
  }
  if (run && run.from - run.to >= DROP_FALL) drops.push(toDrop(run));
  const top = (list: RetentionEvent[]) => [...list].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, max).sort((a, b) => a.startS - b.startS);
  return { baseline, spikes: top(spikes), drops: top(drops) };
}
function toDrop(r: { start: number; end: number; from: number; to: number }): RetentionEvent {
  return { kind: "drop", startS: r.start / 1000, endS: r.end / 1000, intensity: r.to, change: +(r.to - r.from).toFixed(3) };
}

export function nearestMoment(moments: Moment[], t: number): Moment | null {
  let best: Moment | null = null;
  for (const m of moments) if (!best || Math.abs(m.at - t) < Math.abs(best.at - t)) best = m;
  return best && Math.abs(best.at - t) <= 60 ? best : null;
}

const STATIC_SHOTS = /talking-head|medium-shot|static/;
export function deconstruct(events: RetentionEvent[], moments: Moment[]): DeconstructedEvent[] {
  return events.map((e) => {
    const moment = nearestMoment(moments, e.kind === "drop" ? e.startS : e.startS);
    const cues: string[] = [], risks: string[] = [];
    if (moment) {
      if (moment.visual_change) cues.push(`Visual change: ${moment.visual_change}`);
      if (moment.visual_hook) cues.push(`Attention cue: ${moment.visual_hook}`);
      if (moment.diagram.subject) cues.push(`Diagram: ${moment.diagram.subject}`);
      if (moment.on_screen_text.length) cues.push(`On-screen text: “${moment.on_screen_text[0]}”`);
      if (moment.vfx.description) cues.push(`VFX: ${moment.vfx.description}`);
      if (moment.sound_effects.description) cues.push(`Sound: ${moment.sound_effects.description}`);
      if (moment.voice_tone.stress) cues.push(`Vocal stress: ${moment.voice_tone.stress}`);
      const isStatic = !moment.visual_change && !moment.vfx.description && !moment.diagram.subject;
      if (e.kind === "drop") {
        if (isStatic) risks.push("No visual change, effect or graphic near this point — a static stretch.");
        if (STATIC_SHOTS.test(moment.shot_type.slug)) risks.push(`Held ${moment.shot_type.label.toLowerCase()} framing.`);
        if (!moment.sound_effects.description && !moment.voice_tone.stress) risks.push("Flat audio: no sound accent or vocal emphasis noted.");
      }
    }
    return { ...e, moment, cues, risks };
  });
}

// A learning library of hook/retention techniques, each checked against the observed Watch moments,
// so creators see which ones this video uses and which ones are still worth exploring.
const TECHNIQUES: { id: string; title: string; detail: string; test: (m: Moment) => boolean }[] = [
  { id: "pattern-interrupt", title: "Pattern interrupt", detail: "A cut, zoom, angle switch or sudden composition change resets attention every 5–15 seconds.", test: (m) => Boolean(m.visual_change) },
  { id: "visual-proof", title: "Show, don't tell", detail: "Put the proof on screen (diagram, chart, screen recording) the moment the claim is spoken.", test: (m) => Boolean(m.diagram.subject) || /screen-recording|diagram|slide/.test(m.shot_type.slug) },
  { id: "text-anchor", title: "On-screen text anchor", detail: "Key phrases as captions or titles keep silent and skimming viewers oriented.", test: (m) => m.on_screen_text.length > 0 },
  { id: "sound-accent", title: "Sound accents", detail: "Whooshes, risers or hits mark transitions and make payoffs feel bigger.", test: (m) => Boolean(m.sound_effects.description) },
  { id: "vocal-emphasis", title: "Vocal emphasis", detail: "Stress the payoff word, vary pace and pause before reveals.", test: (m) => Boolean(m.voice_tone.stress) },
  { id: "motion-graphics", title: "Motion graphics / VFX", detail: "Animated overlays explain abstract ideas and add novelty without a reshoot.", test: (m) => Boolean(m.vfx.description) },
  { id: "practical-prop", title: "Practical demonstration", detail: "Physical props or in-camera effects create a memorable, replayable moment.", test: (m) => Boolean(m.practical_effects.description) },
  { id: "lighting-shift", title: "Lighting & color shift", detail: "A change in light or grade signals a new chapter or emotional beat.", test: (m) => /change|shift|switch/i.test(m.lighting) },
  { id: "open-loop", title: "Open loop hook", detail: "Tease the payoff in the first 15 seconds and delay it; the visual hook sets the question.", test: (m) => Boolean(m.visual_hook) && m.at <= 30 },
];

export function retentionTips(events: DeconstructedEvent[], moments: Moment[]): RetentionTip[] {
  return TECHNIQUES.map((t) => {
    const evidence = events.filter((e) => e.kind === "spike" && e.moment && t.test(e.moment)).map((e) => e.startS);
    return { id: t.id, title: t.title, detail: t.detail, evidence, seen: moments.some(t.test) };
  }).sort((a, b) => b.evidence.length - a.evidence.length || Number(a.seen) - Number(b.seen));
}
