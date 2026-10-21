import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, Download, Loader2, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enqueueAnalyses, getAnalyses, getAnalysisSettings, listAnalysisJobs, processAnalysisJob } from "@/lib/analysis.functions";
import { analysisResultSchema, type AnalysisTier, type Segment } from "@/lib/analysis";
import { download, fmtDuration } from "@/lib/export";

export function AnalysisQueueControls({ videoIds, onDelivered }: { videoIds: string[]; onDelivered?: () => void }) {
  const enqueue = useServerFn(enqueueAnalyses), list = useServerFn(listAnalysisJobs), process = useServerFn(processAnalysisJob), preferences = useServerFn(getAnalysisSettings);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [progress, setProgress] = useState("");
  const stopped = useRef(false), mounted = useRef(true);
  const query = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  async function drain() {
    setBusy(true); setError(null); stopped.current = false;
    try {
      const settings = await preferences();
      while (!stopped.current && mounted.current) {
        const jobs = await list();
        const active = jobs.filter((j) => j.status === "pending" || j.status === "running");
        setProgress(`${jobs.filter((j) => j.status === "done").length} done · ${active.length} queued · ${jobs.filter((j) => j.status === "failed").length} failed`);
        if (!active.length) break;
        const ready = active.filter((j) => new Date(j.available_at).getTime() <= Date.now() && (j.status === "pending" || !j.lease_until || new Date(j.lease_until).getTime() < Date.now())).slice(0, settings.batchSize);
        if (!ready.length) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        for (let i = 0; i < ready.length && !stopped.current; i += 3) {
          const outcomes = await Promise.allSettled(ready.slice(i, i + 3).map((j) => process({ data: { jobId: j.id } })));
          const rejected = outcomes.find((r) => r.status === "rejected");
          if (rejected?.status === "rejected") throw rejected.reason;
        }
        await query.invalidateQueries({ queryKey: ["account"] });
        onDelivered?.();
      }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Queue unavailable."); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function start(tier: AnalysisTier) {
    setBusy(true); setError(null);
    try {
      const settings = await preferences();
      for (let i = 0; i < videoIds.length; i += settings.batchSize) await enqueue({ data: { videoIds: videoIds.slice(i, i + settings.batchSize), tier } });
      await drain();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not queue analysis."); setBusy(false); }
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy || !videoIds.length} onClick={() => void start("read")}><BookOpen />Read · Free</Button>
      <Button size="sm" variant="outline" disabled={busy || !videoIds.length} onClick={() => void start("watch")}><Eye />Watch · {videoIds.length * 10} credits</Button>
      {busy ? <Button size="icon" variant="ghost" title="Pause queue" aria-label="Pause analysis queue" onClick={() => { stopped.current = true; }}><Pause /></Button> : <Button size="icon" variant="ghost" title="Resume queue" aria-label="Resume analysis queue" onClick={() => void drain()}><Play /></Button>}
      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
    {progress && <p role="status" className="text-xs text-muted-foreground">{progress}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function AnalysisPanel({ videoId, onSeek }: { videoId: string; onSeek: (seconds: number) => void }) {
  const fetch = useServerFn(getAnalyses);
  const [analyses, setAnalyses] = useState<Awaited<ReturnType<typeof getAnalyses>>>([]);
  const [selected, setSelected] = useState<AnalysisTier>("read");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  async function refresh() {
    try { const items = await fetch({ data: { videoId } }); if (mounted.current) setAnalyses(items); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Analysis unavailable."); }
  }
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [videoId]);
  const analysis = analyses.find((a) => a.tier === selected);
  const parsed = analysisResultSchema.safeParse(analysis?.result);
  const result = parsed.success ? parsed.data : null;
  const segments = Array.isArray(analysis?.segments) ? analysis.segments as unknown as Segment[] : [];
  function anchor(id: string) {
    const segment = segments.find((s) => s.id === id);
    return <Button size="sm" variant="ghost" className="h-auto px-1 font-mono text-xs text-primary" disabled={segment?.start == null} onClick={() => { if (segment?.start != null) onSeek(segment.start); }}>{segment?.start == null ? id : fmtDuration(segment.start)}</Button>;
  }
  return <section className="space-y-4 border-t pt-4">
    <h3 className="font-semibold">Video analysis</h3>
    <AnalysisQueueControls videoIds={[videoId]} onDelivered={() => void refresh()} />
    <div className="flex gap-2" role="tablist" aria-label="Analysis tiers">
      {(["read", "watch"] as const).map((t) => <Button key={t} role="tab" aria-selected={selected === t} variant={selected === t ? "secondary" : "ghost"} size="sm" onClick={() => setSelected(t)}>{t === "read" ? <BookOpen /> : <Eye />}{t === "read" ? "Read" : "Watch"}{analyses.some((a) => a.tier === t) ? " ✓" : ""}</Button>)}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result ? <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{analysis?.provider} · {analysis?.model}</p><Button size="sm" variant="ghost" onClick={() => download(`${videoId}-${selected}-analysis.json`, JSON.stringify({ ...analysis, result }, null, 2), "application/json")}><Download />JSON</Button></div>
      <div><h4 className="font-medium">Central thesis</h4><p className="mt-1 leading-relaxed">{result.thesis}</p></div>
      <div><h4 className="font-medium">Overview</h4><p className="mt-1 leading-relaxed">{result.summary}</p></div>
      {[ ["Hook", result.hook], ["Verbal tone", result.tone], ["Intent & incentives", result.intent], ["Call to action", result.cta] ].map(([label, text]) => text && <div key={label}><h4 className="font-medium">{label}</h4><p className="mt-1 leading-relaxed">{text}</p></div>)}
      {result.mentalModels.length > 0 && <div><h4 className="font-medium">Mental models</h4><ul className="mt-1 list-disc space-y-1 pl-4">{result.mentalModels.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
      {result.structure.length > 0 && <div><h4 className="font-medium">Argument structure</h4>{result.structure.map((s, i) => <div className="mt-2 border-l-2 border-primary pl-3" key={i}>{anchor(s.segmentId)} <strong>{s.label}</strong><p className="mt-1">{s.explanation}</p></div>)}</div>}
      {result.claims.length > 0 && <div><h4 className="font-medium">Claims & evidence</h4>{result.claims.map((c, i) => <div key={i} className="mt-2 space-y-1 border-b pb-3">{anchor(c.segmentId)}<p className="font-medium">{c.claim}</p><p>{c.evidence}</p><p className="text-muted-foreground">{c.caveat}</p></div>)}</div>}
      {result.keyMoments.length > 0 && <div><h4 className="font-medium">Key moments</h4>{result.keyMoments.map((m, i) => <p key={i}>{anchor(m.segmentId)} {m.label}</p>)}</div>}
      {result.observations.length > 0 && <div><h4 className="font-medium">Seen & heard</h4>{result.observations.map((o, i) => <div className="mt-3 space-y-1 border-b pb-3" key={i}>{anchor(o.segmentId)}<p><strong>Seen:</strong> {o.seen}</p><p><strong>Heard:</strong> {o.heard}</p>{o.mismatch && <p className="text-warning"><strong>Mismatch:</strong> {o.mismatch}</p>}</div>)}</div>}
    </div> : <p className="text-sm text-muted-foreground">{selected === "read" ? "No Read analysis yet." : "No Watch analysis unlocked."}</p>}
  </section>;
}