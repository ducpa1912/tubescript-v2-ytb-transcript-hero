import { useMemo } from "react";
import type { z } from "zod";
import { TrendingUp, TrendingDown, Lightbulb, CheckCircle2, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/captions";
import type { HeatMoment } from "@/lib/analysis";
import type { watchResultSchema } from "@/lib/watch";
import { deconstruct, detectRetention, retentionTips } from "@/lib/retention";

export function RetentionDeconstructor({ heat, result, onSeek, durationS }: { heat: HeatMoment[]; result: z.infer<typeof watchResultSchema>; onSeek: (s: number) => void; durationS?: number }) {
  const data = useMemo(() => {
    const { baseline, spikes, drops } = detectRetention(heat);
    const events = deconstruct([...spikes, ...drops].sort((a, b) => a.startS - b.startS), result.moments);
    return { baseline, events, tips: retentionTips(events, result.moments) };
  }, [heat, result]);
  const end = durationS || ((heat.at(-1)?.startMs ?? 0) / 1000 + 1);

  if (!heat.length) return <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
    YouTube shows no "most replayed" graph for this video yet (usually it needs more views), so spikes and drops can't be mapped. The technique checklist below still applies.
    <Techniques tips={data.tips} />
  </div>;

  return <section className="space-y-5 text-sm">
    <div>
      <h4 className="font-semibold">Replay spikes & drops</h4>
      <p className="mt-1 text-xs text-muted-foreground">Based on YouTube's "most replayed" graph — replay interest, not exact audience retention.</p>
      <div className="relative mt-3 h-20 w-full overflow-hidden rounded-md border bg-muted/40" aria-hidden>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="h-full w-full">
          <polyline fill="none" stroke="var(--primary)" strokeWidth="2" points={heat.map((h) => `${(h.startMs / 1000 / end) * 1000},${100 - h.intensity * 95}`).join(" ")} />
          <line x1="0" x2="1000" y1={100 - data.baseline * 95} y2={100 - data.baseline * 95} stroke="var(--muted-foreground)" strokeDasharray="6 6" strokeWidth="1" />
        </svg>
        {data.events.map((e, i) => <button key={i} onClick={() => onSeek(e.startS)} title={formatTimestamp(e.startS)}
          className={`absolute top-1 size-3 -translate-x-1/2 rounded-full ring-2 ring-background ${e.kind === "spike" ? "bg-success" : "bg-destructive"}`} style={{ left: `${(e.startS / end) * 100}%` }} />)}
      </div>
    </div>
    {data.events.length === 0 && <p className="text-muted-foreground">Replay interest is steady — no clear spikes or drops.</p>}
    <div className="space-y-3">{data.events.map((e, i) => <article key={i} className={`rounded-lg border-l-4 p-3 ${e.kind === "spike" ? "border-success bg-success/5" : "border-destructive bg-destructive/5"}`}>
      <header className="flex flex-wrap items-center gap-2">
        {e.kind === "spike" ? <TrendingUp className="size-4 text-success" /> : <TrendingDown className="size-4 text-destructive" />}
        <strong>{e.kind === "spike" ? "Replay spike" : "Interest drop"}</strong>
        <Button size="sm" variant="ghost" className="h-auto px-1 font-mono text-xs" onClick={() => onSeek(e.startS)}>{formatTimestamp(e.startS)}{e.kind === "drop" ? `–${formatTimestamp(e.endS)}` : ""}</Button>
        <span className="font-mono text-xs text-muted-foreground">{e.change > 0 ? "+" : ""}{Math.round(e.change * 100)} pts</span>
      </header>
      {e.moment ? <>
        <p className="mt-2 leading-relaxed">{e.moment.what_is_seen}</p>
        {e.cues.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{e.cues.map((c, j) => <li key={j}>{c}</li>)}</ul>}
        {e.risks.length > 0 && <div className="mt-2"><p className="font-medium">Likely reasons for the drop</p><ul className="mt-1 list-disc space-y-1 pl-4">{e.risks.map((r, j) => <li key={j}>{r}</li>)}</ul></div>}
      </> : <p className="mt-2 text-muted-foreground">No Watch moment close enough to explain this point.</p>}
    </article>)}</div>
    <Techniques tips={data.tips} />
  </section>;
}

function Techniques({ tips }: { tips: ReturnType<typeof retentionTips> }) {
  return <div className="mt-4 space-y-2">
    <h4 className="flex items-center gap-2 font-semibold"><Lightbulb className="size-4 text-primary" />Hook & retention playbook</h4>
    <p className="text-xs text-muted-foreground">Techniques this video already uses, and ones worth trying next.</p>
    <ul className="grid gap-2 sm:grid-cols-2">{tips.map((t) => <li key={t.id} className="rounded-md border p-3">
      <div className="flex items-center gap-2 font-medium">{t.seen ? <CheckCircle2 className="size-4 text-success" /> : <Compass className="size-4 text-muted-foreground" />}{t.title}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t.detail}</p>
      <p className="mt-1 text-xs">{t.evidence.length ? `At replay spikes: ${t.evidence.map((s) => formatTimestamp(s)).join(", ")}` : t.seen ? "Used, but not at a spike." : "Not used yet — explore it."}</p>
    </li>)}</ul>
  </div>;
}
