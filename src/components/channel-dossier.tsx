import type { ChannelDossier } from "@/lib/channel-intelligence";

type Video = { id: string; title: string; peerZ: number | null; performance: string };
export function ChannelDossierView({ dossier: d, videos }: { dossier: ChannelDossier; videos: Video[] }) {
  const name = (id: string) => videos.find((v) => v.id === id)?.title ?? id;
  const source = (id: string) => <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer" className="text-primary underline">{name(id)}</a>;
  const confidence = (c: string) => <span className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">{c} evidence</span>;
  const quote = (q: { videoId: string; quote: string; significance: string }, i: number) => <blockquote key={i} className="border-l-2 border-primary pl-3 text-sm"><p>“{q.quote}”</p><p className="mt-1 text-xs text-muted-foreground">{q.significance} · {source(q.videoId)}</p></blockquote>;
  const cards = (title: string, items: { title: string; finding: string; confidence: string; videoIds: string[] }[]) => <section><h3 className="mb-3 font-semibold">{title}</h3><div className="grid gap-3 sm:grid-cols-2">{items.map((i) => <article key={i.title} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="font-medium">{i.title}</h4>{confidence(i.confidence)}</div><p className="mt-2 text-sm text-muted-foreground">{i.finding}</p><p className="mt-3 flex flex-wrap gap-2 text-xs">{i.videoIds.map((id) => <span key={id}>{source(id)}</span>)}</p></article>)}</div></section>;
  return <div className="space-y-8">
    <p className="border-l-2 border-primary py-2 pl-4 text-sm leading-relaxed">{d.overview}</p>
    <section><h3 className="mb-3 font-semibold">Why videos over- or under-performed</h3><div className="space-y-3">{d.autopsies.map((a, index) => {
      const v = videos.find((x) => x.id === a.videoId);
      return <details key={a.videoId} className="rounded-lg border p-4" open={index === 0}>
        <summary className="cursor-pointer"><span className="font-medium">{name(a.videoId)}</span><span className="ml-2 font-mono text-xs text-primary">{v?.peerZ != null ? `${v.peerZ > 0 ? "+" : ""}${v.peerZ.toFixed(2)}σ` : "Limited peers"}</span><p className="mt-2 text-sm text-muted-foreground">{a.verdict}</p></summary>
        <div className="mt-3">{confidence(a.confidence)}</div>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">{([["Publishing context", a.publicationContext], ["Script architecture", a.scriptArchitecture], ["Emotional appeal", a.emotionalAppeal], ["Viewer needs", a.audienceFit], ["Title promise", a.packaging], [`Compared with ${name(a.comparisonVideoId)}`, a.comparison]] as const).map(([k, value]) => <div key={k}><dt className="text-xs font-medium uppercase text-muted-foreground">{k}</dt><dd className="mt-1 leading-relaxed">{value}</dd></div>)}</dl>
        <div className="mt-5 space-y-3">{a.evidence.map(quote)}</div>
        <aside className="mt-4 rounded-lg border border-warning/50 p-3 text-sm"><h4 className="font-medium">Other possible reasons</h4><ul className="mt-1 list-disc pl-5 text-muted-foreground">{a.alternativeExplanations.map((x) => <li key={x}>{x}</li>)}</ul></aside>
        <p className="mt-3 text-sm"><strong>Next test:</strong> {a.experiment}</p>
      </details>;
    })}</div></section>
    {cards("Content pillars", d.topics)}
    <section><h3 className="mb-3 font-semibold">Viewer needs & emotional appeal</h3><div className="grid gap-3 sm:grid-cols-2">{d.audience.map((a) => <article key={a.segment} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium">{a.segment}</h4>{confidence(a.confidence)}</div><p className="text-sm">{a.need}</p><p className="text-sm text-muted-foreground">{a.emotionalAppeal}</p>{a.evidence.map(quote)}</article>)}</div></section>
    {cards("Voice & hooks", d.voice)}
    {d.trends.length > 0 && cards("Evolving topics", d.trends.map((t) => ({ title: t.topic, finding: `${t.trajectory} ${t.publicationContext}`, confidence: t.confidence, videoIds: t.videoIds })))}
    {d.opportunities.length > 0 && cards("Opportunities to test", d.opportunities.map((o) => ({ title: o.topic, finding: `${o.rationale} Test: ${o.experiment}`, confidence: o.confidence, videoIds: o.videoIds })))}
    <aside className="rounded-lg border border-warning/50 p-3 text-sm"><h3 className="font-medium">Evidence limits</h3><ul className="mt-1 list-disc pl-5 text-muted-foreground">{d.limitations.map((x) => <li key={x}>{x}</li>)}</ul></aside>
  </div>;
}