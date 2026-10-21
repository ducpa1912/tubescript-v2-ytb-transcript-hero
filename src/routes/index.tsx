import { TranscriptViewer } from "@/components/transcript-viewer";
import { AnalysisQueueControls } from "@/components/analysis-panel";
import { normalizeCues, type Cue } from "@/lib/captions";
import { collectionIdPattern, collectionUrl } from "@/lib/collections";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { unlockTranscripts } from "@/lib/unlock.functions";
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
      { name: "description", content: "Extract YouTube channel, playlist and video transcripts with searchable metadata, timed captions and CSV, JSON, Markdown, SRT, VTT or SBV downloads." },
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
const COLS = "id,title,publish_date,views,duration_seconds,status,status_detail,caption_lang,word_count,position,updated_at";
type DbRow = Row & { position: number; updated_at: string; cues?: Cue[] };

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
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id } : null);
      // Opening a saved project: /?channel=UC... resumes it automatically.
      const ch = new URLSearchParams(window.location.search).get("channel");
      if (ch && collectionIdPattern.test(ch)) {
        const url = collectionUrl(ch);
        setInput(url);
        void runRefLatest.current(false, url);
      }
    });
  }, []);
  const account = useQuery({ queryKey: ["account"], enabled: !!user, queryFn: () => getAccount() });

  const runRef = useRef(0);
  const runRefLatest = useRef<(refresh?: boolean, override?: string) => Promise<void>>(async () => {});
  const lastSync = useRef<string>("1970-01-01");

  const mergeRows = (list: DbRow[]) =>
    setRows((prev) => {
      const next = new Map(prev);
      for (const r of list) {
        next.set(r.id, { ...r, transcript: r.transcript ?? prev.get(r.id)?.transcript ?? null, cues: r.cues ?? prev.get(r.id)?.cues ?? [] });
        if (r.updated_at > lastSync.current) lastSync.current = r.updated_at;
      }
      return next;
    });

  const syncChannel = useCallback(async (channelId: string, full: boolean) => {
    const since = full ? "1970-01-01" : lastSync.current;
    if (channelId.startsWith("PL:")) {
      for (let from = 0; ; from += 200) {
        const { data: members, error } = await supabase.from("collection_videos").select("video_id,position").eq("collection_id", channelId).order("position").range(from, from + 199);
        if (error) throw error;
        if (!members?.length) break;
        const { data: videos, error: videoError } = await supabase.from("videos").select(COLS).in("id", members.map((m) => m.video_id));
        if (videoError) throw videoError;
        const { data: texts } = await supabase.from("video_transcripts").select("video_id,transcript").in("video_id", members.map((m) => m.video_id));
        const { data: timing } = await supabase.from("video_caption_cues").select("video_id,cues").in("video_id", members.map((m) => m.video_id));
        mergeRows((videos ?? []).map((v) => ({ ...v, position: members.find((m) => m.video_id === v.id)?.position ?? 0, transcript: texts?.find((t) => t.video_id === v.id)?.transcript ?? null, cues: normalizeCues(timing?.find((t) => t.video_id === v.id)?.cues) })));
        if (members.length < 200) break;
      }
      return;
    }
    for (let from = 0; ; from += 200) {
      const { data, error } = await supabase.from("videos").select(COLS)
        .eq("channel_id", channelId).gte("updated_at", since).order("position").range(from, from + 199);
      if (error) throw error;
      const list = data as DbRow[];
      // Transcripts are shared but only readable once this user has unlocked them.
      const ok = list.filter((r) => r.status === "ok").map((r) => r.id);
      const texts = new Map<string, string>();
      const timings = new Map<string, Cue[]>();
      for (let i = 0; i < ok.length; i += 100) {
        const { data: t } = await supabase.from("video_transcripts").select("video_id,transcript").in("video_id", ok.slice(i, i + 100));
        for (const x of t ?? []) texts.set(x.video_id, x.transcript);
        const { data: timing } = await supabase.from("video_caption_cues").select("video_id,cues").in("video_id", ok.slice(i, i + 100));
        for (const x of timing ?? []) timings.set(x.video_id, normalizeCues(x.cues));
      }
      mergeRows(list.map((r) => ({ ...r, transcript: texts.get(r.id) ?? null, cues: timings.get(r.id) ?? [] })));
      if (!data || data.length < 200) break;
    }
  }, []);

  const run = async (refresh = false, override?: string) => {
    const value = (override ?? input).trim();
    if (!value) return;
    const runId = ++runRef.current;
    setError(null); setNotice(null); setAuthNeeded(false); setQuotaReached(false); setPhase("discovering"); if (!refresh) { setRows(new Map()); setChannel(null); }
    lastSync.current = "1970-01-01";
    try {
      const res = await startScan({ data: { input: value, refresh } });
      if ("error" in res) {
        if ("authRequired" in res && res.authRequired) { setAuthNeeded(true); setPhase("idle"); return; }
        throw new Error(res.error);
      }
      if (res.kind === "video") {
        const { data } = await supabase.from("videos").select(COLS).eq("id", res.videoId);
        mergeRows(((data ?? []) as DbRow[]).map((r) => ({ ...r, transcript: res.transcript, cues: res.cues })));
        setChannel(null);
        setPhase("done");
        return;
      }
      const { data: ch } = await supabase.from("channels").select("*").eq("id", res.channelId).single();
      setChannel(ch as Channel);
      await syncChannel(res.channelId, true);
      if (refresh) setNotice(res.newVideos ? `${res.newVideos} new videos found` : "No new videos — saved transcripts kept");
      else if (res.cached && res.newVideos === 0) setNotice("Loaded from cache");
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

  runRefLatest.current = run;

  const list = useMemo(() => [...rows.values()], [rows]);
  const total = channel ? Math.max(channel.video_count, list.length) : list.length;
  const resolved = list.filter((r) => r.status !== "pending").length;
  const busy = phase === "discovering" || phase === "parsing";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-10 sm:px-6">
      <header className="mb-10 text-center">
        <div className="flex justify-end">
          {user ? (
            <span className="flex gap-4">
              <Link to="/settings" className="font-mono text-xs text-muted-foreground hover:text-foreground">Settings</Link>
              <Link to="/analysis" className="font-mono text-xs text-muted-foreground hover:text-foreground">Analysis</Link>
              <Link to="/logs" className="font-mono text-xs text-muted-foreground hover:text-foreground">Logs</Link>
              <Link to="/billing" className="font-mono text-xs text-muted-foreground hover:text-foreground">Credits</Link>
              <Link to="/projects" className="font-mono text-xs text-muted-foreground hover:text-foreground">
                Your projects{account.data ? ` · ${account.data.usedToday}/10 today` : ""}
              </Link>
            </span>
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
          placeholder={user ? "YouTube channel, playlist, or video link" : "Paste a YouTube video link"}
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

      {quotaReached && <UpgradeCard locked={list.filter((r) => r.status === "pending" || (r.status === "ok" && !r.transcript)).length} />}

      {phase !== "idle" && (
        <Progress phase={phase} resolved={resolved} total={total} notice={notice} channel={channel}
          onRefresh={() => channel ? run(true, collectionUrl(channel.id)) : run(true)} />
      )}

      {list.length > 0 && <ResultsTable rows={list} heading={channel?.title ?? list[0]?.title ?? "Transcripts"} ready={phase === "done"} locked={!!channel} signedIn={!!user} onUnlocked={() => channel ? syncChannel(channel.id, true) : Promise.resolve()} />}
    </main>
  );
}

function UpgradeCard({ locked }: { locked: number }) {
  return (
    <div className="mx-auto mt-4 flex max-w-2xl flex-col items-center gap-3 rounded-xl border bg-card p-5 text-center text-sm">
      <p>
        You've used your 10 free transcripts for today.
        {locked > 0 && <> <span className="font-medium">{locked} more videos</span> are waiting — your progress is saved.</>}
      </p>
      <Button size="lg" className="rounded-xl font-semibold" asChild>
        <Link to="/billing">Get 500 transcripts — $5</Link>
      </Button>
      <p className="text-xs text-muted-foreground">Or come back tomorrow for 10 more free.</p>
    </div>
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
          <Button variant="ghost" size="sm" onClick={onRefresh}><RotateCw className="size-3" /> Check for new videos</Button>
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

function ResultsTable({ rows, heading, ready, locked = false, signedIn, onUnlocked }: { rows: DbRow[]; heading: string; ready: boolean; locked?: boolean; signedIn: boolean; onUnlocked: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "position", dir: 1 });
  const [open, setOpen] = useState<DbRow | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const unlockFn = useServerFn(unlockTranscripts);
  const queryClient = useQueryClient();
  const [unlocking, setUnlocking] = useState(false);
  const [unlockNotice, setUnlockNotice] = useState<string | null>(null);
  async function unlockIds(ids: string[]) {
    setUnlocking(true); setUnlockNotice(null);
    try {
      let delivered = 0;
      for (let i = 0; i < ids.length; i += 1000) {
        const result = await unlockFn({ data: { videoIds: ids.slice(i, i + 1000) } });
        delivered += result.ids.length;
        if (result.freeLeft + result.credits === 0) break;
      }
      await onUnlocked();
      await queryClient.invalidateQueries({ queryKey: ["account"] });
      setUnlockNotice(delivered ? `${delivered} transcripts unlocked.` : "No allowance remaining. Visit Credits to add more.");
    } catch { setUnlockNotice("Unable to unlock transcripts. Please retry."); }
    finally { setUnlocking(false); }
  }

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
  const lockedIds = locked ? view.filter((r) => r.status === "ok" && !r.transcript).map((r) => r.id) : [];

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
      {lockedIds.length > 0 && <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Button variant="outline" size="sm" disabled={!ready || unlocking} onClick={() => void unlockIds(lockedIds.slice(0, 25))}>Unlock next 25</Button>
        <Button variant="outline" size="sm" disabled={!ready || unlocking} onClick={() => void unlockIds(lockedIds)}>Unlock all ({lockedIds.length})</Button>
        <span className="text-xs text-muted-foreground">Free allowance first, then 1 credit each</span>
      </div>}
      {unlockNotice && <p role="status" className="border-b px-4 py-2 text-sm text-muted-foreground">{unlockNotice}</p>}
      {signedIn && view.some((r) => r.transcript) && <div className="border-b px-4 py-3"><AnalysisQueueControls videoIds={view.filter((r) => r.transcript).map((r) => r.id)} /></div>}
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
            const r = view[vi.index];
            if (!r) return null;
            // Metadata is always shown (latest values); only the transcript text is locked.
            const isLocked = locked && r.status === "ok" && !r.transcript;
            return (
              <Button variant="ghost" disabled={isLocked && (!ready || unlocking)}
                key={r.id}
                data-row
                onClick={() => isLocked ? void unlockIds([r.id]) : setOpen(r)}
                className={`${grid} absolute inset-x-0 h-[52px] rounded-none border-b border-border/50 text-left text-sm font-normal hover:bg-accent/50`}
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <span className="font-mono text-xs text-muted-foreground">{r.position + 1}</span>
                <span className="truncate">{r.title || r.id}</span>
                <span className={`font-mono text-xs text-muted-foreground `}>{r.publish_date?.slice(0, 10) ?? "—"}</span>
                <span className={`text-right font-mono text-xs `}>{r.views != null ? compact(r.views) : "—"}</span>
                <span className={`text-right font-mono text-xs `}>{fmtDuration(r.duration_seconds)}</span>
                <span className={`truncate font-mono text-xs ${STATUS_STYLE[r.status]}`}>
                  {isLocked ? "Unlock transcript" : r.status === "pending" ? <Loader2 className="inline size-3 animate-spin" /> : r.status === "ok" ? `${r.word_count.toLocaleString()} words` : STATUS_LABEL[r.status]}
                </span>
              </Button>
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
              <TranscriptViewer key={open.id} row={open} signedIn={signedIn} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
