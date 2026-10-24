import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, MessageSquare, PenLine, Download, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ChannelDossierView } from "@/components/channel-dossier";
import { AnalysisQueueControls } from "@/components/analysis-panel";
import { dossierMarkdown } from "@/lib/channel-intelligence";
import { supabase } from "@/integrations/supabase/client";
import { askChannelBrain, generateChannelBrief, generateScript, getChannelBrain } from "@/lib/channel.functions";


function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name }); a.click(); URL.revokeObjectURL(url);
}
const Md = ({ text }: { text: string }) => <div className="prose prose-sm max-w-none text-foreground dark:prose-invert [&_table]:text-xs [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;

export function ChannelBrain({ channelId }: { channelId: string }) {
  const fetchBrain = useServerFn(getChannelBrain);
  const brain = useQuery({ queryKey: ["channel-brain", channelId], queryFn: () => fetchBrain({ data: { channelId } }) });
  const generate = useServerFn(generateChannelBrief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = brain.data;
  const withText = d?.stats.videos.filter((v) => v.hasTranscript).length ?? 0;

  async function runBrief() {
    setBusy(true); setError(null);
    try { await generate({ data: { channelId } }); await brain.refetch(); }
    catch (e) { setError(e instanceof Error ? e.message : "Channel analysis failed."); }
    finally { setBusy(false); }
  }

  return <div className="py-4">
    <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold"><Brain className="size-6 text-primary" />Channel Brain</h1>
    {d && <p className="mt-1 text-sm text-muted-foreground">{d.stats.count} videos · {withText} transcripts unlocked · median {Math.round(d.stats.medianViews).toLocaleString()} views · {d.stats.hits} hits · {d.stats.flops} flops</p>}
    {brain.isLoading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}
    {brain.error && <p role="alert" className="mt-8 text-sm text-destructive">{brain.error.message}</p>}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {d && <Tabs defaultValue="brief" className="mt-6">
      <TabsList className="h-auto flex-wrap justify-start gap-1">
        <TabsTrigger value="brief"><Brain className="size-4" />Channel analysis</TabsTrigger>
        <TabsTrigger value="library">Performance</TabsTrigger>
        <TabsTrigger value="chat" disabled={!d.brief}><MessageSquare className="size-4" />Chat</TabsTrigger>
        <TabsTrigger value="scripts" disabled={!d.brief}><PenLine className="size-4" />Script lab</TabsTrigger>
      </TabsList>
      <TabsContent value="brief" className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runBrief} disabled={busy || !d.readiness.ready}>{busy ? <Loader2 className="animate-spin" /> : <Brain />}{d.brief ? "Update channel analysis" : "Run channel analysis"}</Button>
          {d.brief && <Button variant="ghost" onClick={() => download(`${channelId}-channel.md`, d.dossier ? dossierMarkdown(d.dossier, d.channelTitle, d.stats.videos) : d.brief?.markdown ?? "")}><Download />channel.md</Button>}
          <span className="text-xs text-muted-foreground">{busy ? "Reading the whole library — this can take a few minutes." : d.readiness.ready ? "Free · one AI request over your unlocked library." : "Unlock every transcript and run Read on each video first."}</span>
        </div>
        {!d.readiness.ready && <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <p>Requirements: <b>{d.readiness.unlocked}/{d.readiness.captioned}</b> transcripts unlocked · <b>{d.readiness.analysed}/{d.readiness.captioned}</b> Read analyses done.</p>
          {d.readiness.unlocked < d.readiness.captioned && <p className="text-xs text-muted-foreground">Open the Videos tab and use “Unlock all” (daily free allowance first, then 1 credit each).</p>}
          {d.readiness.missingRead.length > 0 && <AnalysisQueueControls tier="read" videoIds={d.readiness.missingRead.slice(0, 200)} onDelivered={() => void brain.refetch()} />}
        </div>}
        {d.brief ? <><p className="text-xs text-muted-foreground">Updated {new Date(d.brief.updated_at).toLocaleString()} from {d.brief.video_count} transcripts</p>{d.dossier ? <ChannelDossierView dossier={d.dossier} videos={d.stats.videos} /> : <><p className="mb-3 rounded-lg border border-warning/50 p-3 text-sm">Older analysis — update to get structured, evidence-based explanations.</p><Md text={d.brief.markdown} /></>}</>
          : <p className="text-sm text-muted-foreground">Publication context, script structure, emotional appeal and viewer needs explain relative performance. Chat and the Script lab unlock after analysis.</p>}
      </TabsContent>
      <TabsContent value="library" className="mt-4">
        <p className="mb-3 text-xs text-muted-foreground">Log-view scores compare up to 20 uploads published closest in time. Recent uploads and small samples are inconclusive; views alone do not explain why.</p>
        <ul className="divide-y text-sm">{[...d.stats.videos].sort((a, b) => (b.peerZ ?? -99) - (a.peerZ ?? -99)).map((v) => <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
          <span className={`w-16 shrink-0 font-mono text-xs ${["above", "breakout"].includes(v.performance) ? "text-success" : v.performance === "below" ? "text-destructive" : "text-muted-foreground"}`}>{["above", "breakout"].includes(v.performance) ? <TrendingUp className="inline size-3" /> : v.performance === "below" ? <TrendingDown className="inline size-3" /> : null} {v.peerZ != null ? `${v.peerZ.toFixed(2)}σ` : v.performance === "new" ? "Too new" : "Limited"}</span>
          <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{v.title}</a>
          <span className="shrink-0 text-xs text-muted-foreground">{v.views?.toLocaleString() ?? "?"} views</span>
        </li>)}</ul>
      </TabsContent>
      <TabsContent value="chat" className="mt-4"><Chat channelId={channelId} /></TabsContent>
      <TabsContent value="scripts" className="mt-4"><ScriptLab channelId={channelId} videos={d.stats.videos} scripts={d.scripts as ScriptRow[]} onSaved={() => void brain.refetch()} /></TabsContent>
    </Tabs>}
  </div>;
}

function Chat({ channelId }: { channelId: string }) {
  const ask = useServerFn(askChannelBrain);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; sources?: { videoId: string; title: string }[] }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    const question = q.trim(); if (!question || busy) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: question }]); setQ(""); setBusy(true);
    try { const r = await ask({ data: { channelId, question, history } }); setMessages((m) => [...m, { role: "assistant", content: r.answer, sources: r.sources }]); }
    catch (e) { setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : "Failed"}` }]); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Ask by idea, direction, approach or intention — e.g. "Where do they argue one AI is better than another?" or "Which hook style opened the top videos?"</p>
    <div className="space-y-3">{messages.map((m, i) => <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm" : "rounded-lg border p-3"}>
      {m.role === "assistant" ? <Md text={m.content} /> : m.content}
      {m.sources && m.sources.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Sources: {m.sources.map((s) => <a key={s.videoId} className="mr-2 underline" href={`https://www.youtube.com/watch?v=${s.videoId}`} target="_blank" rel="noreferrer">{s.title}</a>)}</p>}
    </div>)}{busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Thinking…</p>}</div>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the whole library…" aria-label="Question" />
      <Button type="submit" disabled={busy || q.trim().length < 2}>Ask</Button>
    </form>
  </div>;
}

type ScriptRow = { id: string; mode: string; input: { topic?: string }; output: string; created_at: string };
function ScriptLab({ channelId, videos, scripts, onSaved }: { channelId: string; videos: { id: string; title: string; label: string; ratio: number | null; performance: string; hasTranscript: boolean }[]; scripts: ScriptRow[]; onSaved: () => void }) {
  const run = useServerFn(generateScript);
  const [mode, setMode] = useState<"replicate" | "style" | "gap">("replicate");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState(videos.find((v) => ["above", "breakout"].includes(v.performance) && v.hasTranscript)?.id ?? "");
  const [own, setOwn] = useState(channelId);
  const [length, setLength] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ["projects-min"], queryFn: async () => (await supabase.from("projects").select("channel_id, channel_title").order("updated_at", { ascending: false })).data ?? [] });
  const outliers = [...videos].filter((v) => v.hasTranscript).sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  async function go() {
    setBusy(true); setError(null);
    try { const r = await run({ data: { channelId, mode, topic: topic || undefined, sourceVideoId: mode === "replicate" ? source : undefined, ownChannelId: mode === "gap" ? own : undefined, lengthMin: length } }); setOutput(r.output); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : "Script generation failed."); }
    finally { setBusy(false); }
  }
  const modes = [
    { id: "replicate", title: "Replicate a video or topic", body: "Blueprint an outlier and reuse its structure for a new angle." },
    { id: "style", title: "Clone a creator's style", body: "Their tone, voice, hook and rhythm on your topic." },
    { id: "gap", title: "Fill a trend gap", body: "Find what your channel is missing vs. this one, then script it." },
  ] as const;
  return <div className="space-y-4 text-sm">
    <div className="grid gap-2 sm:grid-cols-3">{modes.map((m) => <Button variant="outline" key={m.id} onClick={() => setMode(m.id)} className={`h-auto whitespace-normal rounded-lg border p-3 text-left block ${mode === m.id ? "border-primary bg-primary/5" : "hover:bg-accent"}`}><p className="font-medium">{m.title}</p><p className="mt-1 text-xs text-muted-foreground">{m.body}</p></Button>)}</div>
    {mode === "replicate" && <label className="block">Source video<select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2">
      {outliers.map((v) => <option key={v.id} value={v.id}>{v.ratio != null ? `${v.ratio}x · ` : ""}{v.title}</option>)}</select></label>}
    {mode === "gap" && <label className="block">Your own channel (must be crawled + analysed)<select value={own} onChange={(e) => setOwn(e.target.value)} className="mt-1 w-full rounded-md border bg-background px-3 py-2">
      {(projects.data ?? []).map((p) => <option key={p.channel_id} value={p.channel_id}>{p.channel_title || p.channel_id}</option>)}</select></label>}
    <label className="block">{mode === "replicate" ? "New topic (optional)" : mode === "style" ? "Topic" : "Steer toward (optional)"}<Textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} className="mt-1" /></label>
    <label className="flex items-center gap-2">Length (minutes)<Input type="number" min={1} max={60} value={length} onChange={(e) => setLength(Number(e.target.value) || 10)} className="w-20" /></label>
    <Button onClick={go} disabled={busy || (mode === "replicate" && !source)}>{busy ? <Loader2 className="animate-spin" /> : <PenLine />}Generate script</Button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {output && <div className="rounded-lg border p-4"><div className="mb-2 flex justify-end"><Button size="sm" variant="ghost" onClick={() => download("script.md", output)}><Download />Markdown</Button></div><Md text={output} /></div>}
    {scripts.length > 0 && <div><h4 className="font-medium">Saved scripts</h4><ul className="mt-2 divide-y">{scripts.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
      <span className="w-20 shrink-0 text-xs capitalize text-muted-foreground">{s.mode}</span>
      <Button variant="ghost" className="min-w-0 flex-1 truncate justify-start text-left hover:underline" onClick={() => setOutput(s.output)}>{s.input?.topic || s.output.split("\n").find((l) => l.trim()) || "Script"}</Button>
      <span className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</span>
    </li>)}</ul></div>}
  </div>;
}
