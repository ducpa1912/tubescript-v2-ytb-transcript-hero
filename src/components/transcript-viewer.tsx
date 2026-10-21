import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Clock3, Search, FileText, BookOpen, Eye, X, Copy, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { startScan } from "@/lib/scan.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addTimestamps } from "@/lib/captions.functions";
import { formatTimestamp, toSubtitle, type Cue } from "@/lib/captions";
import { download, type Row } from "@/lib/export";
import { AnalysisPanel } from "./analysis-panel";

export function TranscriptViewer({ row, signedIn, onRetried }: { row: Row & { cues?: Cue[] }; signedIn: boolean; onRetried?: (row: Partial<Row> & { cues?: Cue[] }) => void }) {
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const scan = useServerFn(startScan);
  async function retry() {
    setRetrying(true); setRetryMsg(null);
    try {
      const res = await scan({ data: { input: `https://www.youtube.com/watch?v=${row.id}` } });
      if ("error" in res) throw new Error(res.error);
      const { data } = await supabase.from("videos").select("id,title,publish_date,views,duration_seconds,status,status_detail,caption_lang,word_count").eq("id", row.id).maybeSingle();
      const transcript = res.kind === "video" ? res.transcript : null;
      if (!transcript) setRetryMsg("Still no English captions found. Try again later.");
      else setCues(res.kind === "video" ? res.cues : []);
      onRetried?.({ ...(data ?? {}), transcript, cues: res.kind === "video" ? res.cues : [] } as Partial<Row> & { cues?: Cue[] });
    } catch (e) { setRetryMsg((e as Error).message); }
    finally { setRetrying(false); }
  }
  const [cues, setCues] = useState(row.cues ?? []);
  const [seek, setSeek] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const add = useServerFn(addTimestamps);
  const queryClient = useQueryClient();
  async function enrich() {
    setPending(true); setError(null);
    try {
      const result = await add({ data: { videoId: row.id } });
      setCues(result.cues);
      await queryClient.invalidateQueries({ queryKey: ["account"] });
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => q ? cues.filter((c) => c.text.toLowerCase().includes(q)) : cues, [cues, q]);
  const paragraphs = useMemo(() => (row.transcript ?? "").split(/\n+/).filter((p) => !q || p.toLowerCase().includes(q)), [row.transcript, q]);

  const player = seek != null && <div className="sticky top-0 z-10 space-y-1 bg-background pb-2">
    <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setSeek(null)} aria-label="Close player"><X />Close player</Button></div>
    <iframe key={`${row.id}-${seek}`} title={`${row.title} — video player`}
      src={`https://www.youtube-nocookie.com/embed/${row.id}?start=${Math.floor(seek)}&autoplay=1`}
      allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-md border" />
  </div>;

  if (!row.transcript) return <div className="px-4 pb-6">
    <div className="space-y-3 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
      <p>{row.status_detail ?? "No captions available"}</p>
      <Button size="sm" variant="outline" onClick={() => void retry()} disabled={retrying}>
        {retrying ? <Loader2 className="animate-spin" /> : <RotateCw />}Retry captions
      </Button>
      {retryMsg && <p role="status" className="text-xs">{retryMsg}</p>}
    </div>
  </div>;

  return <div className="space-y-3 px-4 pb-6">
    {player}
    <Tabs defaultValue="transcript">
      <TabsList className="w-full">
        <TabsTrigger value="transcript" className="flex-1"><FileText />Transcript</TabsTrigger>
        <TabsTrigger value="read" className="flex-1"><BookOpen />Read<span className="hidden sm:inline"> · Free</span></TabsTrigger>
        <TabsTrigger value="watch" className="flex-1"><Eye />Watch<span className="hidden sm:inline"> · 10 credits</span></TabsTrigger>
      </TabsList>

      <TabsContent value="transcript" className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search transcript" className="h-8 pl-8" aria-label="Search transcript" />
          </div>
          <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(row.transcript ?? "")}><Copy />Copy</Button>
          {cues.length ? (["srt", "vtt", "sbv"] as const).map((format) => <Button key={format} size="sm" variant="secondary"
            onClick={() => download(`${row.id}.${format}`, toSubtitle(cues, format), format === "vtt" ? "text/vtt" : "text/plain")}>
            <Download />{format.toUpperCase()}
          </Button>) : signedIn && <Button size="sm" variant="outline" onClick={() => void enrich()} disabled={pending}
            title="Uses 1 free allowance, then 1 credit · charged on delivery">
            {pending ? <Loader2 className="animate-spin" /> : <Clock3 />}Add timestamps
          </Button>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="max-h-[60vh] overflow-y-auto rounded-md border">
          {cues.length ? <div className="divide-y">{shown.map((cue, index) => <Button key={`${cue.start}-${index}`} variant="ghost"
            aria-label={`Seek to ${formatTimestamp(cue.start)}`}
            onClick={() => setSeek(cue.start)} className="h-auto w-full items-start justify-start gap-3 rounded-none whitespace-normal px-3 py-2 text-left font-normal">
            <span className="shrink-0 font-mono text-xs text-primary">{formatTimestamp(cue.start)}</span>
            <span className="text-sm leading-relaxed">{cue.text}</span>
          </Button>)}</div>
            : <div className="space-y-3 p-4 text-sm leading-relaxed">{paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>}
          {q && !(cues.length ? shown.length : paragraphs.length) && <p className="p-4 text-sm text-muted-foreground">No matches.</p>}
        </div>
      </TabsContent>

      {(["read", "watch"] as const).map((tier) => <TabsContent key={tier} value={tier} className="pt-2">
        {signedIn ? <AnalysisPanel videoId={row.id} onSeek={setSeek} tier={tier} />
          : <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Sign in to run {tier === "read" ? "Read" : "Watch"} analysis.</p>}
      </TabsContent>)}
    </Tabs>
  </div>;
}
