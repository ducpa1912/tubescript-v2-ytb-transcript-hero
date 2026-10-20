import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addTimestamps } from "@/lib/captions.functions";
import { subtitleTime, toSubtitle, type Cue } from "@/lib/captions";
import { download, type Row } from "@/lib/export";

export function TranscriptViewer({ row, signedIn }: { row: Row & { cues?: Cue[] }; signedIn: boolean }) {
  const [cues, setCues] = useState(row.cues ?? []);
  const [seek, setSeek] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  return <div className="space-y-4 px-4 pb-6">
    {row.transcript && <>
      <div className="flex flex-wrap items-center gap-2">
        {cues.length ? (["srt", "vtt", "sbv"] as const).map((format) => <Button key={format} size="sm" variant="secondary"
          onClick={() => download(`${row.id}.${format}`, toSubtitle(cues, format), format === "vtt" ? "text/vtt" : "text/plain")}>
          <Download />{format.toUpperCase()}
        </Button>) : signedIn && <>
          <Button size="sm" variant="outline" onClick={() => void enrich()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Clock3 />}Add timestamps
          </Button>
          <span className="text-xs text-muted-foreground">1 free allowance, then 1 credit · charged on delivery</span>
        </>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {seek != null && <iframe key={`${row.id}-${seek}`} title={`${row.title} — video player`}
        src={`https://www.youtube-nocookie.com/embed/${row.id}?start=${Math.floor(seek)}&autoplay=1`}
        allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-md border" />}
    </>}
    {cues.length ? <div className="space-y-1">{cues.map((cue, index) => <Button key={`${cue.start}-${index}`} variant="ghost"
      aria-label={`Seek to ${subtitleTime(cue.start).slice(0, 8)}`}
      onClick={() => setSeek(cue.start)} className="h-auto w-full items-start justify-start gap-3 whitespace-normal px-2 py-2 text-left font-normal">
      <span className="shrink-0 font-mono text-xs text-primary">{subtitleTime(cue.start).slice(0, 8)}</span>
      <span className="text-sm leading-relaxed">{cue.text}</span>
    </Button>)}</div> : <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{row.transcript ?? row.status_detail ?? "No captions available"}</p>}
  </div>;
}