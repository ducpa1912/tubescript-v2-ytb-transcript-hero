import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Loader2, Search, X, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { startScan, processBatch } from "@/lib/scan.functions";
import { getAccount } from "@/lib/account.functions";
import { STATUS_LABEL, download, fmtDuration, toCSV, toJSON, toMarkdown, type Row } from "@/lib/export";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tubescript — every transcript from a YouTube channel" },
      { name: "description", content: "Paste a YouTube channel or video link and get every transcript with title, date, views and duration. Export to CSV, JSON or Markdown." },
      { property: "og:title", content: "Tubescript — every transcript from a YouTube channel" },
      { property: "og:description", content: "Paste a channel link, get every transcript. Export to CSV, JSON or Markdown." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Channel = { id: string; title: string; handle: string | null; thumbnail: string | null; video_count: number };
type SortKey = "position" | "title" | "publish_date" | "views" | "duration_seconds" | "status" | "word_count";
const COLS = "id,title,publish_date,views,duration_seconds,status,status_detail,caption_lang,word_count,transcript,position,updated_at";
type DbRow = Row & { position: number; updated_at: string };

function Index() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "discovering" | "parsing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [rows, setRows] = useState<Map<string, DbRow>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [quotaReached, setQuotaReached] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ? { id: data.user.id } : null));
  }, []);
  const account = useQuery({ queryKey: ["account"], enabled: !!user, queryFn: () => getAccount() });

  const runRef = useRef(0);
  const lastSync = useRef<string>("1970-01-01");

  const mergeRows = (list: DbRow[]) =>
    setRows((prev) => {
      const next = new Map(prev);
      for (const r of list) {
        next.set(r.id, r);
        if (r.updated_at > lastSync.current) lastSync.current = r.updated_at;
      }
      return next;
    });

  const syncChannel = useCallback(async (channelId: string, full: boolean) => {
    const since = full ? "1970-01-01" : lastSync.current;
    for (let from = 0; ; from += 200) {
      const { data, error } = await supabase.from("videos").select(COLS)
        .eq("channel_id", channelId).gte("updated_at", since).order("position").range(from, from + 199);
      if (error) throw error;
      mergeRows(data as DbRow[]);
      if (!data || data.length < 200) break;
    }
  }, []);

  const run = async (refresh = false) => {
    const value = input.trim();
    if (!value) return;
    const runId = ++runRef.current;
    setError(null); setNotice(null); setAuthNeeded(false); setQuotaReached(false); setPhase("discovering"); setRows(new Map()); setChannel(null);
    lastSync.current = "1970-01-01";
    try {
      const res = await startScan({ data: { input: value, refresh } });
      if ("error" in res) {
        if ("authRequired" in res && res.authRequired) { setAuthNeeded(true); setPhase("idle"); return; }
        throw new Error(res.error);
      }
      if (res.kind === "video") {
        const { data } = await supabase.from("videos").select(COLS).eq("id", res.videoId);
        mergeRows((data ?? []) as DbRow[]);
        setChannel(null);
        setPhase("done");
        return;
      }
      const { data: ch } = await supabase.from("channels").select("*").eq("id", res.channelId).single();
      setChannel(ch as Channel);
      await syncChannel(res.channelId, true);
      if (res.cached && res.newVideos === 0) setNotice("Loaded from cache");
      setPhase("parsing");
      let backoff = 0;
      while (runRef.current === runId) {
        try {
          const b = await processBatch({ data: { channelId: res.channelId } });
          await syncChannel(res.channelId, false);
          if (b.quotaExceeded) { setQuotaReached(true); break; }
          if (b.remaining === 0) break;
          backoff = b.throttled ? Math.min(30000, (backoff || 2000) * 2) : 0;
          if (backoff) { setNotice(`YouTube asked us to slow down — pausing ${Math.round(backoff / 1000)}s`); await new Promise((r) => setTimeout(r, backoff + Math.random() * 500)); setNotice(null); }
        } catch (e) {
          backoff = Math.min(30000, (backoff || 2000) * 2);
          setNotice(`Connection hiccup — retrying in ${Math.round(backoff / 1000)}s`);
          await new Promise((r) => setTimeout(r, backoff));
          setNotice(null);
        }
      }
      if (runRef.current === runId) { await syncChannel(res.channelId, false); setPhase("done"); }
    } catch (e) {
      if (runRef.current === runId) { setError((e as Error).message); setPhase("idle"); }
    }
  };

  const list = useMemo(() => [...rows.values()], [rows]);
  const total = channel ? Math.max(channel.video_count, list.length) : list.length;
  const resolved = list.filter((r) => r.status !== "pending").length;
  const busy = phase === "discovering" || phase === "parsing";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <div className="flex justify-end">
          {user ? (
            <Link to="/projects" className="font-mono text-xs text-muted-foreground hover:text-foreground">
              Your projects{account.data ? ` · ${account.data.usedToday}/10 today` : ""}
            </Link>
          ) : (
            <Link to="/auth" className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-accent">
              Sign in
            </Link>
          )}
        </div>
        <h1 className="font-mono text-sm tracking-[0.3em] text-primary uppercase">Tubescript</h1>
        <p className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Every transcript. One paste.</p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); run(); }}
        className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-2xl border bg-card p-2 shadow-window focus-within:shadow-glow transition-shadow"
      >
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={user ? "youtube.com/@channel  or  a video link" : "Paste a YouTube video link"}
          aria-label="YouTube channel or video URL"
          className="min-w-0 flex-1 bg-transparent px-3 py-3 font-mono text-sm outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="lg" disabled={busy || !input.trim()} className="rounded-xl font-semibold">
          {busy ? <Loader2 className="animate-spin" /> : null}
          {busy ? "Working" : "Extract"}
        </Button>
      </form>

      {!user && (
        <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-muted-foreground">
          * <Link to="/auth" className="text-primary underline">Register free</Link> to paste channel links, save every crawl as a project, and get 10 video transcripts a day.
        </p>
      )}

      {error && <p role="alert" className="mt-4 text-center text-sm text-destructive">{error}</p>}

      {authNeeded && (
        <div className="mx-auto mt-4 max-w-2xl rounded-xl border bg-card p-4 text-center text-sm">
          Channel crawls need a free account — single videos still work without one.
          <Link to="/auth" className="ml-2 font-medium text-primary underline">Sign in with Google</Link>
        </div>
      )}

      {quotaReached && (
        <div className="mx-auto mt-4 max-w-2xl rounded-xl border bg-card p-4 text-center text-sm">
          You've used your 10 free transcripts for today. Your progress is saved — come back tomorrow or upgrade for 500 transcripts a month.
        </div>
      )}

      {phase !== "idle" && (
        <Progress phase={phase} resolved={resolved} total={total} notice={notice} channel={channel}
          onRefresh={() => run(true)} />
      )}

      {list.length > 0 && <ResultsTable rows={list} heading={channel?.title ?? list[0]?.title ?? "Transcripts"} ready={phase === "done"} />}
    </main>
  );
}

function Progress({ phase, resolved, total, notice, channel, onRefresh }: {
  phase: string; resolved: number; total: number; notice: string | null; channel: Channel | null; onRefresh: () => void;
}) {
  const pct = total ? Math.round((resolved / total) * 100) : 0;
  return (
    <section className="mx-auto mt-8 w-full max-w-2xl" aria-live="polite">
      <div className="flex items-center justify-between gap-4 font-mono text-xs text-muted-foreground">
        <span className="flex items-center gap-2 truncate">
          {channel?.thumbnail && <img src={channel.thumbnail} alt="" className="size-5 rounded-full" />}
          <span className="truncate text-foreground">{channel?.title}</span>
        </span>
        <span data-testid="progress-text" className="shrink-0">
          {phase === "discovering" ? "Discovering videos…" : phase === "parsing" ? `Parsed ${resolved}/${total} videos…` : `Done · ${resolved}/${total} videos`}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full bg-primary transition-[width] duration-500 ${phase === "discovering" ? "w-1/4 animate-pulse" : ""}`}
          style={phase === "discovering" ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex min-h-5 items-center justify-between font-mono text-xs text-muted-foreground">
        <span>{notice}</span>
        {phase === "done" && channel && (
          <button onClick={onRefresh} className="flex items-center gap-1 hover:text-foreground"><RotateCw className="size-3" /> Check for new videos</button>
        )}
      </div>
    </section>
  );
}

const STATUS_STYLE: Record<string, string> = {
  ok: "text-success",
  no_captions: "text-warning",
  unavailable: "text-muted-foreground",
  failed: "text-destructive",
  pending: "text-muted-foreground",
};

function ResultsTable({ rows, heading, ready }: { rows: DbRow[]; heading: string; ready: boolean }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "position", dir: 1 });
  const [open, setOpen] = useState<DbRow | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const f = needle
      ? rows.filter((r) => r.title.toLowerCase().includes(needle) || r.transcript?.toLowerCase().includes(needle))
      : rows;
    const { key, dir } = sort;
    return [...f].sort((a, b) => {
      const x = a[key] as any, y = b[key] as any;
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
  }, [rows, q, sort]);

  const virt = useVirtualizer({ count: view.length, getScrollElement: () => parentRef.current, estimateSize: () => 52, overscan: 12 });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1));
    return c;
  }, [rows]);

  const exp = (fmt: "csv" | "json" | "md") => {
    const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "transcripts";
    if (fmt === "csv") download(`${slug}.csv`, toCSV(view), "text/csv;charset=utf-8");
    if (fmt === "json") download(`${slug}.json`, toJSON(view), "application/json");
    if (fmt === "md") download(`${slug}.md`, toMarkdown(view, heading), "text/markdown");
  };

  const H = ({ k, label, className = "" }: { k: SortKey; label: string; className?: string }) => (
    <button
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === "title" || k === "position" ? 1 : -1 }))}
      className={`flex items-center gap-1 hover:text-foreground ${sort.key === k ? "text-foreground" : ""} ${className}`}
    >
      {label}
      {sort.key === k && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );

  const grid = "grid grid-cols-[2.5rem_minmax(0,1fr)_6.5rem_6rem_4.5rem_10rem] gap-3 items-center px-4";

  return (
    <section className="mt-10 overflow-hidden rounded-2xl border bg-card shadow-window">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <div className="flex gap-1.5" aria-hidden>
          <span className="size-3 rounded-full bg-destructive/80" /><span className="size-3 rounded-full bg-warning/80" /><span className="size-3 rounded-full bg-success/80" />
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles and transcripts"
            aria-label="Search" className="w-full rounded-lg border bg-surface py-1.5 pr-8 pl-8 text-sm outline-none focus:border-primary" />
          {q && <button onClick={() => setQ("")} aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button>}
        </div>
        <div className="flex gap-1">
          {(["csv", "json", "md"] as const).map((f) => (
            <Button key={f} variant="secondary" size="sm" onClick={() => exp(f)} disabled={!ready} className="font-mono uppercase">
              <Download /> {f === "md" ? "Markdown" : f}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-b px-4 py-2 font-mono text-xs text-muted-foreground">
        <span>{view.length.toLocaleString()} shown</span>
        {Object.entries(counts).map(([s, n]) => (
          <span key={s} className={STATUS_STYLE[s]}>{n} · {STATUS_LABEL[s] ?? s}</span>
        ))}
      </div>
      <div className={`${grid} border-b py-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase`}>
        <H k="position" label="#" />
        <H k="title" label="Title" />
        <H k="publish_date" label="Published" />
        <H k="views" label="Views" className="justify-end" />
        <H k="duration_seconds" label="Length" className="justify-end" />
        <H k="status" label="Transcript" />
      </div>
      <div ref={parentRef} className="h-[65vh] overflow-auto" data-testid="table-scroll">
        <div style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((vi) => {
            const r = view[vi.index]!;
            return (
              <button
                key={r.id}
                data-row
                onClick={() => setOpen(r)}
                className={`${grid} absolute inset-x-0 h-[52px] border-b border-border/50 text-left text-sm hover:bg-accent/50`}
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <span className="font-mono text-xs text-muted-foreground">{r.position + 1}</span>
                <span className="truncate">{r.title || r.id}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.publish_date?.slice(0, 10) ?? "—"}</span>
                <span className="text-right font-mono text-xs">{r.views != null ? compact(r.views) : "—"}</span>
                <span className="text-right font-mono text-xs">{fmtDuration(r.duration_seconds)}</span>
                <span className={`truncate font-mono text-xs ${STATUS_STYLE[r.status]}`}>
                  {r.status === "pending" ? <Loader2 className="inline size-3 animate-spin" /> : r.status === "ok" ? `${r.word_count.toLocaleString()} words` : STATUS_LABEL[r.status]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-6 leading-snug">{open.title}</SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {open.publish_date?.slice(0, 10)} · {open.views?.toLocaleString()} views · {fmtDuration(open.duration_seconds)}
                  {open.caption_lang ? ` · ${open.caption_lang}` : ""} ·{" "}
                  <a className="text-primary underline" href={`https://www.youtube.com/watch?v=${open.id}`} target="_blank" rel="noreferrer">Watch</a>
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-6 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
                {open.transcript ?? <span className="text-muted-foreground italic">{open.status_detail ?? STATUS_LABEL[open.status]}</span>}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
