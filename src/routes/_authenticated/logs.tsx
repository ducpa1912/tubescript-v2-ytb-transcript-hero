import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
  head: () => ({
    meta: [
      { title: "Pipeline logs — Tubescript" },
      { name: "description", content: "See every crawl step and which route it went through." },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Pipeline logs — Tubescript" },
      { property: "og:description", content: "See every crawl step and which route it went through." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const OUTCOME_STYLE: Record<string, string> = {
  ok: "text-primary",
  charged: "text-primary",
  no_captions: "text-muted-foreground",
  throttled: "text-accent-foreground",
  error: "text-destructive",
};

function LogsPage() {
  const [stage, setStage] = useState("all");
  const [q, setQ] = useState("");
  const logs = useQuery({
    queryKey: ["pipeline_logs"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from("pipeline_logs").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo(() => (logs.data ?? []).filter((r) =>
    (stage === "all" || r.stage === stage) &&
    (!q || `${r.route} ${r.outcome} ${r.video_id ?? ""} ${r.channel_id ?? ""} ${r.detail ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [logs.data, stage, q]);

  const routeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of logs.data ?? []) m.set(`${r.stage} → ${r.route}`, (m.get(`${r.stage} → ${r.route}`) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs.data]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pipeline logs</h1>
        <Link to="/" className="font-mono text-xs text-muted-foreground hover:text-foreground">← Back</Link>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {routeCounts.map(([k, n]) => (
          <span key={k} className="rounded-md border border-border px-2 py-1 font-mono text-xs">{k} · {n}</span>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1.5 text-sm">
          {["all", "discovery", "transcript", "single_video", "billing"].map((s) => <option key={s}>{s}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search video, route, error…"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
      </div>

      {logs.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events yet — run a crawl and they'll appear here.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>{["Time", "Stage", "Route", "Outcome", "Video / Channel", "ms", "Detail"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-1.5">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-1.5">{r.stage}</td>
                  <td className="px-3 py-1.5">{r.route}</td>
                  <td className={`px-3 py-1.5 ${OUTCOME_STYLE[r.outcome] ?? ""}`}>{r.outcome}</td>
                  <td className="px-3 py-1.5">
                    {r.video_id ? <a className="underline" href={`https://youtu.be/${r.video_id}`} target="_blank" rel="noreferrer">{r.video_id}</a> : r.channel_id ?? "—"}
                  </td>
                  <td className="px-3 py-1.5">{r.duration_ms ?? ""}</td>
                  <td className="max-w-md break-words px-3 py-1.5 text-muted-foreground">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
