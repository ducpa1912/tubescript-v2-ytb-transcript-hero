import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, Download, Loader2, Play, Pause, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enqueueAnalyses, getAnalyses, getAnalysisSettings, listAnalysisJobs, processAnalysisJob } from "@/lib/analysis.functions";
import { analysisResultSchema, type AnalysisTier, type Segment } from "@/lib/analysis";
import { download, formatTimestamp } from "@/lib/export";
import { watchResultSchema } from "@/lib/watch";
import { WatchEvidence } from "./watch-evidence";
import { RetentionDeconstructor } from "./retention-deconstructor";

type Job = Awaited<ReturnType<typeof listAnalysisJobs>>[number];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

export function AnalysisQueueControls({ videoIds, onDelivered, tier, refreshWatch = false }: { videoIds: string[]; onDelivered?: () => void; tier?: AnalysisTier | undefined; refreshWatch?: boolean }) {
  const enqueue = useServerFn(enqueueAnalyses), list = useServerFn(listAnalysisJobs), process = useServerFn(processAnalysisJob), preferences = useServerFn(getAnalysisSettings);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [progress, setProgress] = useState("");
  const [called, setCalled] = useState<Partial<Record<AnalysisTier, number>>>({}), [delivered, setDelivered] = useState<Partial<Record<AnalysisTier, number>>>({});
  const [now, setNow] = useState(() => Date.now());
  const stopped = useRef(false), mounted = useRef(true), draining = useRef(false);
  const query = useQueryClient();
  const ids = new Set(videoIds);
  function track(jobs: Job[]) {
    const mine = jobs.filter((j) => ids.has(j.video_id));
    const c: Partial<Record<AnalysisTier, number>> = {}, d: Partial<Record<AnalysisTier, number>> = {};
    for (const j of mine) {
      const t = j.tier as AnalysisTier, created = new Date(j.created_at).getTime();
      if (j.status === "pending" || j.status === "running") c[t] = Math.min(c[t] ?? Infinity, created);
      else if (j.status === "done" && d[t] == null) d[t] = Math.round((new Date(j.updated_at).getTime() - created) / 1000);
    }
    if (mounted.current) { setCalled(c); setDelivered(d); }
    return mine.filter((j) => j.status === "pending" || j.status === "running");
  }
  useEffect(() => {
    mounted.current = true;
    // Reopened tab: detect jobs already called for these videos and resume watching them.
    void list().then((jobs) => { if (track(jobs).length) void drain(); }).catch(() => {});
    return () => { mounted.current = false; stopped.current = true; };
  }, [videoIds.join(",")]);
  const active = busy || Object.keys(called).length > 0;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  async function drain() {
    if (draining.current) return;
    draining.current = true; setBusy(true); setError(null); stopped.current = false;
    try {
      const settings = await preferences();
      while (!stopped.current && mounted.current) {
        const jobs = await list();
        const mineActive = track(jobs);
        const active = jobs.filter((j) => j.status === "pending" || j.status === "running");
        setProgress(`${jobs.filter((j) => j.status === "done").length} done · ${active.length} queued · ${jobs.filter((j) => j.status === "failed").length} failed`);
        if (!active.length) break;
        const ready = active.filter((j) => new Date(j.available_at).getTime() <= Date.now() && (j.status === "pending" || !j.lease_until || new Date(j.lease_until).getTime() < Date.now())).slice(0, settings.batchSize);
        // Another tab/lease holds the work: just poll until it finishes.
        if (!ready.length) { await new Promise((r) => setTimeout(r, mineActive.length ? 4000 : 1500)); continue; }
        for (let i = 0; i < ready.length && !stopped.current; i += 3) {
          const outcomes = await Promise.allSettled(ready.slice(i, i + 3).map((j) => process({ data: { jobId: j.id } })));
          const rejected = outcomes.find((r) => r.status === "rejected");
          if (rejected?.status === "rejected") throw rejected.reason;
        }
        await query.invalidateQueries({ queryKey: ["account"] });
        onDelivered?.();
      }
      track(await list());
      onDelivered?.();
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Queue unavailable."); }
    finally { draining.current = false; if (mounted.current) setBusy(false); }
  }
  async function start(t: AnalysisTier) {
    // Lock instantly, before any network round-trip, so a double click cannot queue twice.
    setCalled((c) => ({ ...c, [t]: Date.now() })); setBusy(true); setError(null);
    try {
      const settings = await preferences();
      for (let i = 0; i < videoIds.length; i += settings.batchSize) await enqueue({ data: { videoIds: videoIds.slice(i, i + settings.batchSize), tier: t, refresh: t === "watch" && refreshWatch } });
      await drain();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not queue analysis."); setBusy(false); setCalled((c) => { const n = { ...c }; delete n[t]; return n; }); }
  }
  const label = (t: AnalysisTier, idle: string) => called[t] != null ? `${t === "read" ? "Read" : "Watch"} · Called (${fmt(Math.floor((now - called[t]!) / 1000))})` : idle;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {tier !== "watch" && <Button size="sm" variant="secondary" disabled={active || !videoIds.length} onClick={() => void start("read")}><BookOpen />{label("read", "Read · Free")}</Button>}
      {tier !== "read" && <Button size="sm" variant="outline" disabled={active || !videoIds.length} onClick={() => void start("watch")}><Eye />{label("watch", refreshWatch ? "Refresh Watch · Already unlocked" : `Watch · ${videoIds.length * 10} credits`)}</Button>}
      {busy ? <Button size="icon" variant="ghost" title="Stop watching in this tab (work continues)" aria-label="Pause analysis queue" onClick={() => { stopped.current = true; }}><Pause /></Button> : <Button size="icon" variant="ghost" title="Resume queue" aria-label="Resume analysis queue" onClick={() => void drain()}><Play /></Button>}
      {active && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
    </div>
    {active && <p role="status" className="text-xs text-muted-foreground">Processing — AI analysis can take up to 10 minutes. You can close this tab; progress is saved and resumes when you return.</p>}
    {!active && (delivered.read != null || delivered.watch != null) && videoIds.length === 1 && <p role="status" className="text-xs text-muted-foreground">{[delivered.read != null ? `Read delivered in ${fmt(delivered.read)}` : "", delivered.watch != null ? `Watch delivered in ${fmt(delivered.watch)}` : ""].filter(Boolean).join(" · ")}</p>}
    {!active && progress && videoIds.length > 1 && <p role="status" className="text-xs text-muted-foreground">{progress}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function AnalysisPanel({ videoId, onSeek, tier }: { videoId: string; onSeek: (seconds: number) => void; tier?: AnalysisTier }) {
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
  const activeTier = tier ?? selected;
  const analysis = analyses.find((a) => a.tier === activeTier);
  let stored: unknown = analysis?.result;
  if (typeof stored === "string") { try { stored = JSON.parse(stored); } catch { /* Unstructured legacy output stays readable as text. */ } }
  const parsed = analysisResultSchema.safeParse(stored);
  const watch = watchResultSchema.safeParse(stored);
  const result = parsed.success ? parsed.data : null;
  const segments = Array.isArray(analysis?.segments) ? analysis.segments as unknown as Segment[] : [];
  function anchor(id: string) {
    const segment = segments.find((s) => s.id === id);
    return <Button size="sm" variant="ghost" className="h-auto px-1 font-mono text-xs text-primary" disabled={segment?.start == null} onClick={() => { if (segment?.start != null) onSeek(segment.start); }}>{segment?.start == null ? id : formatTimestamp(segment.start)}</Button>;
  }
  return <section className="space-y-4 border-t pt-4">
    <h3 className="font-semibold">{tier === "watch" ? "Watch analysis" : tier === "read" ? "Read analysis" : "Video analysis"}</h3>
    <AnalysisQueueControls videoIds={[videoId]} tier={tier} refreshWatch={Boolean(analyses.some((a) => a.tier === "watch"))} onDelivered={() => void refresh()} />
    {!tier && <div className="flex gap-2" role="tablist" aria-label="Analysis tiers">
      {(["read", "watch"] as const).map((t) => <Button key={t} role="tab" aria-selected={selected === t} variant={selected === t ? "secondary" : "ghost"} size="sm" onClick={() => setSelected(t)}>{t === "read" ? <BookOpen /> : <Eye />}{t === "read" ? "Read" : "Watch"}{analyses.some((a) => a.tier === t) ? " ✓" : ""}</Button>)}
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {activeTier === "watch" && analysis?.watch_format === 0 && <p className="border-l-2 border-warning pl-3 text-sm text-muted-foreground">Earlier Watch output. A successful refresh replaces it with synchronized audiovisual moments.</p>}
    {activeTier === "watch" && watch.success ? <>
      <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => download(`${videoId}-watch-analysis.json`, JSON.stringify(analysis, null, 2), "application/json")}><Download />JSON</Button></div>
      <RetentionDeconstructor heat={(stored as { heatMoments?: { startMs: number; intensity: number }[] })?.heatMoments ?? []} result={watch.data} onSeek={onSeek} />
      <WatchEvidence result={watch.data} onSeek={onSeek} />
    </> : result ? <div className="space-y-4 text-sm">
      <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => download(`${videoId}-${activeTier}-analysis.json`, JSON.stringify({ ...analysis, result }, null, 2), "application/json")}><Download />JSON</Button></div>
      <div><h4 className="font-medium">Central thesis</h4><p className="mt-1 leading-relaxed">{result.thesis}</p></div>
      <div><h4 className="font-medium">Overview</h4><p className="mt-1 leading-relaxed">{result.summary}</p></div>
      {[ ["Hook", result.hook.prose], ["Verbal tone", result.tone.primary], ["Tone arc", result.tone.arc], ["Intent & incentives", result.intent], ["Call to action", result.cta],
        ...(activeTier === "watch" ? [["Mood", result.mood.primary], ["Mood arc", result.mood.arc], ["Delivery", result.delivery], ["Energy curve", result.energy_curve], ["Visual style", result.visual_style], ["Visual narrative", result.visual_narrative]] : [])
      ].map(([label, text]) => text && <div key={label}><h4 className="font-medium">{label}</h4><p className="mt-1 leading-relaxed">{text}</p></div>)}
      {Object.values(result.hook.attributes).some((v) => v > 0) && <div><h4 className="font-medium">Hook profile</h4><dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">{Object.entries(result.hook.attributes).map(([name, value]) => <div key={name} className="flex items-center justify-between gap-3 border-b pb-1"><dt className="capitalize">{name.replace(/_/g, " ")}</dt><dd className="font-mono text-xs text-primary">{Math.round(value * 100)}%</dd></div>)}</dl></div>}
      {result.mentalModels.length > 0 && <div><h4 className="font-medium">Mental models</h4><ul className="mt-1 list-disc space-y-1 pl-4">{result.mentalModels.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
      {result.structure.length > 0 && <div><h4 className="font-medium">Argument structure</h4>{result.structure.map((s, i) => <div className="mt-2 border-l-2 border-primary pl-3" key={i}>{anchor(s.segmentId)} <strong>{s.label}</strong><p className="mt-1">{s.explanation}</p></div>)}</div>}
      {result.claims.length > 0 && <div><h4 className="font-medium">Claims & evidence</h4>{result.claims.map((c, i) => <div key={i} className="mt-2 space-y-1 border-b pb-3">{anchor(c.segmentId)}<p className="font-medium">{c.claim}</p><p>{c.evidence}</p>{c.caveat && <aside className="my-3 rounded-md border border-warning/40 border-l-4 bg-warning/10 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-warning"><ShieldAlert className="size-4 shrink-0" />Epistemic boundary & caveat</div><p className="mt-2 text-sm italic leading-relaxed text-foreground">{c.caveat.replace(/^\[|\]$/g, "")}</p></aside>}</div>)}</div>}
      {result.keyMoments.length > 0 && <div><h4 className="font-medium">Key moments</h4>{result.keyMoments.map((m, i) => <div key={i} className="mt-2">{anchor(m.segmentId)} <strong className="font-medium">{m.label}</strong>{m.why && <p className="mt-1 leading-relaxed">{m.why}</p>}</div>)}</div>}
      {result.observations.length > 0 && <div><h4 className="font-medium">Seen & heard</h4>{result.observations.map((o, i) => <div className="mt-3 space-y-1 border-b pb-3" key={i}>{anchor(o.segmentId)}{o.seen || o.heard ? <><p><strong>Seen:</strong> {o.seen || "Not reported"}</p><p><strong>Heard:</strong> {o.heard || "Not reported"}</p></> : <p className="text-muted-foreground">No observation reported for this segment.</p>}{o.mismatch && <aside className="mt-2 rounded-md border-l-4 border-warning bg-warning/10 p-3"><strong className="text-warning">Visual-verbal tension</strong><p className="mt-1">{o.mismatch}</p></aside>}</div>)}</div>}
      {activeTier === "watch" && result.onScreenText.length > 0 && <div><h4 className="font-medium">On-screen text & graphics</h4><ul className="mt-1 space-y-2">{result.onScreenText.map((t, i) => <li key={i}>{t.segmentId && anchor(t.segmentId)} {t.text}</li>)}</ul></div>}
      {activeTier === "watch" && result.heatMoments.length > 0 && <div><h4 className="font-medium">Most replayed moments</h4><ul className="mt-2 space-y-1">{[...result.heatMoments].sort((a, b) => b.intensity - a.intensity).slice(0, 3).map((h) => <li key={h.startMs}><Button size="sm" variant="ghost" className="font-mono text-xs text-primary" onClick={() => onSeek(h.startMs / 1000)}>{formatTimestamp(h.startMs / 1000)}</Button>Replay intensity {Math.round(h.intensity * 100)}%</li>)}</ul></div>}
    </div> : typeof stored === "string" ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{stored}</p> : <p className="text-sm text-muted-foreground">{activeTier === "read" ? "No Read analysis yet." : "No Watch analysis unlocked."}</p>}
  </section>;
}