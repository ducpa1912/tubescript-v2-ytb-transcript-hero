import { useMemo, useState } from "react";
import { z } from "zod";
import { Film, Volume2, Sparkles, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/lib/captions";
import { watchResultSchema } from "@/lib/watch";

export function WatchEvidence({ result, onSeek }: { result: z.infer<typeof watchResultSchema>; onSeek: (seconds: number) => void }) {
  const [category, setCategory] = useState("all");
  const categories = useMemo(() => [...new Map(result.moments.map((m) => [m.shot_type.slug, m.shot_type])).values()], [result]);
  const shown = result.moments.filter((m) => category === "all" || m.shot_type.slug === category);
  return <div className="space-y-6 text-sm">
    <div><h4 className="font-semibold">Audiovisual overview</h4><p className="mt-2 leading-relaxed">{result.summary}</p></div>
    {result.visual_narrative && <div><h4 className="font-semibold">Visual narrative</h4><p className="mt-2 leading-relaxed">{result.visual_narrative}</p></div>}
    <div className="flex flex-wrap items-center gap-3 border-y py-3">
      <label htmlFor="watch-shot-filter" className="font-medium">Shot type</label>
      <select id="watch-shot-filter" value={category} onChange={(e) => setCategory(e.target.value)} className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-foreground">
        <option value="all">All moments ({result.moments.length})</option>
        {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
      </select>
      <span className="text-xs text-muted-foreground">{shown.length} moments</span>
    </div>
    <div className="divide-y">{shown.map((m) => <article key={m.segmentId} className="space-y-4 py-5 first:pt-0">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" className="font-mono" onClick={() => onSeek(m.at)} aria-label={`Seek to ${formatTimestamp(m.at)}`}>{formatTimestamp(m.at)}</Button>
        <span className="font-medium" title={m.shot_type.description}>{m.shot_type.label}</span>
      </header>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0 space-y-3"><h5 className="flex items-center gap-2 font-semibold"><Film className="size-4 text-primary" />Picture</h5>
          <p className="break-words leading-relaxed">{m.what_is_seen}</p>
          {m.diagram.subject && <div className="border-l-2 border-primary pl-3"><p className="font-medium">{m.diagram.type || "Diagram"}: {m.diagram.subject}</p><p className="mt-1 leading-relaxed">{m.diagram.explanation}</p></div>}
          {m.on_screen_text.length > 0 && <div><h6 className="font-medium">On-screen text</h6><ul className="mt-1 space-y-1 font-mono text-xs">{m.on_screen_text.map((t, i) => <li key={i} className="break-words">“{t}”</li>)}</ul></div>}
          {[["Body language", m.body_language], ["Lighting", m.lighting], ["Visual change", m.visual_change], ["Visual hook", m.visual_hook]].map(([label, value]) => value && <div key={label}><h6 className="font-medium">{label}</h6><p className="mt-1 break-words leading-relaxed">{value}</p></div>)}
        </div>
        <div className="min-w-0 space-y-3"><h5 className="flex items-center gap-2 font-semibold"><Volume2 className="size-4 text-primary" />Sound & voice</h5>
          {m.heard && <p className="break-words leading-relaxed">{m.heard}</p>}
          {[["Voice quality", m.voice_tone.quality], ["Word stress", m.voice_tone.stress], ["Pacing & pauses", m.voice_tone.pacing], ["Volume", m.voice_tone.volume], ["Wording tone", m.text_tone]].map(([label, value]) => value && <div key={label}><h6 className="font-medium">{label}</h6><p className="mt-1 break-words leading-relaxed">{value}</p></div>)}
        </div>
      </div>
      {[m.vfx, m.practical_effects, m.sound_effects].some((e) => e.description) && <div className="border-y py-3"><h5 className="mb-3 flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />Effects</h5>
        <dl className="grid gap-3 sm:grid-cols-3">{[["Digital / VFX", m.vfx], ["Practical effects", m.practical_effects], ["Sound effects", m.sound_effects]].map(([label, effect]) => {
          if (typeof effect === "string" || !effect?.description) return null;
          return <div key={String(label)} className="min-w-0"><dt className="font-medium">{String(label)}</dt><dd className="mt-1 break-words leading-relaxed">{effect.description}{effect.purpose && <p className="mt-1 text-muted-foreground">{effect.purpose}</p>}</dd></div>;
        })}</dl>
      </div>}
      {m.audiovisual_relation && <div className="border-l-2 border-primary pl-3"><h6 className="font-medium">Picture–sound relationship</h6><p className="mt-1 leading-relaxed">{m.audiovisual_relation}</p></div>}
      {m.caveat && <aside className="rounded-md border border-warning/40 border-l-4 bg-warning/10 p-3"><h6 className="flex items-center gap-2 font-semibold text-warning"><ShieldAlert className="size-4" />Evidence limits</h6><p className="mt-2 italic leading-relaxed">{m.caveat}</p></aside>}
    </article>)}</div>
  </div>;
}