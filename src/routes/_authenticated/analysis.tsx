import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { AnalysisQueueControls, AnalysisPanel } from "@/components/analysis-panel";
import { listAnalysisJobs } from "@/lib/analysis.functions";
import { Button } from "@/components/ui/button";
const jobsQuery = queryOptions({ queryKey: ["analysis-jobs"], queryFn: () => listAnalysisJobs() });
export const Route = createFileRoute("/_authenticated/analysis")({
  loader: ({ context }) => context.queryClient.ensureQueryData(jobsQuery),
  head: () => ({ meta: [{ title: "Video analysis queue — Tubescript" }, { name: "description", content: "Resume queued Read and Watch analyses and inspect delivered video insights in Tubescript." }, { property: "og:title", content: "Video analysis queue — Tubescript" }, { property: "og:description", content: "Your queued and delivered Tubescript video analyses." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: AnalysisPage,
});
function AnalysisPage() {
  const jobs = useSuspenseQuery(jobsQuery), [open, setOpen] = useState<string | null>(null), [seek, setSeek] = useState<number | null>(null);
  return <main className="mx-auto min-h-screen max-w-4xl px-4 py-10">
    <div className="flex justify-between"><Link to="/" className="text-sm text-muted-foreground">← Tubescript</Link><Link to="/settings" className="text-sm text-primary underline">Model settings</Link></div>
    <h1 className="mt-3 text-2xl font-semibold">Analysis queue</h1>
    <div className="mt-5"><AnalysisQueueControls videoIds={[]} onDelivered={() => void jobs.refetch()} /></div>
    <div className="mt-6 divide-y border-y">{jobs.data.length ? jobs.data.map((j) => <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={j.id}><div className="min-w-0 flex-1"><p className="font-mono text-sm">{j.video_id} · {j.tier}</p><p className="mt-1 text-xs text-muted-foreground">{j.status} · attempt {j.attempts}/3</p>{j.error && <p className="mt-1 break-words text-xs text-destructive">{j.error}</p>}</div><Button size="sm" variant="outline" onClick={() => { setOpen(j.video_id); setSeek(null); }}>Open analysis</Button></div>) : <p className="py-6 text-sm text-muted-foreground">No analyses queued yet.</p>}</div>
    {open && <div className="mt-8">{seek != null && <iframe title="Analysis video player" className="mb-4 aspect-video w-full border" src={`https://www.youtube-nocookie.com/embed/${open}?start=${Math.floor(seek)}&autoplay=1`} allow="autoplay; encrypted-media" allowFullScreen />}<AnalysisPanel key={open} videoId={open} onSeek={setSeek} /></div>}
  </main>;
}