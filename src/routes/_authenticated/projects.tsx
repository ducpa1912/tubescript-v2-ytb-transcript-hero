import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureProfile, getAccount } from "@/lib/account.functions";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
  head: () => ({
    meta: [
      { title: "Your projects — Tubescript" },
      { name: "description", content: "Every channel you've crawled, saved as a resumable project." },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Your projects — Tubescript" },
      { property: "og:description", content: "Every channel you've crawled, saved as a resumable project." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ProjectsPage() {
  const account = useQuery({
    queryKey: ["account"],
    queryFn: () => getAccount(),
  });

  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, channel_id, channel_title, thumbnail, video_count, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    ensureProfile().then(() => account.refetch()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const brains = useQuery({
    queryKey: ["channel-brains", projects.data?.map((p) => p.channel_id)],
    enabled: !!projects.data?.length,
    queryFn: async () => {
      const { data, error } = await supabase.from("channel_briefs").select("channel_id").in("channel_id", projects.data?.map((p) => p.channel_id) ?? []);
      if (error) throw error;
      return data.map((b) => b.channel_id);
    },
  });

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← New crawl
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            Your projects
          </h1>
        </div>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = "/";
          }}
          className="rounded-md border border-input px-3 py-1.5 text-sm text-foreground hover:bg-accent"
        >
          Sign out
        </button>
      </div>

      {account.data && (
        <p className="mt-2 text-sm text-muted-foreground">
          {account.data.usedToday}/10 transcripts used today · {account.data.credits} paid credits
        </p>
      )}
      <Link to="/billing" className="mt-3 inline-block text-sm text-primary underline">Credits & billing</Link>

      {projects.isLoading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {projects.data && projects.data.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          No projects yet. Crawl a channel from the home page to create one.
        </p>
      )}

      <div className="mt-6 grid gap-3">
        {projects.data?.map((p) => (
          <div
            key={p.id}
            className="relative flex items-center gap-4 rounded-lg border border-input p-4 transition-colors hover:bg-accent"
          >
            <a href={`/?channel=${encodeURIComponent(p.channel_id)}`} className="absolute inset-0" aria-label={`Open ${p.channel_title || p.channel_id}`} />
            {p.thumbnail && (
              <img src={p.thumbnail} alt="" className="h-10 w-10 rounded-full object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {p.channel_title || p.channel_id}
              </p>
              <p className="text-xs text-muted-foreground">
                {p.video_count} videos · updated {new Date(p.updated_at).toLocaleDateString()}
              </p>
            </div>
            {brains.data?.includes(p.channel_id) && <span title="Channel Brain available" aria-label="Channel Brain available" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/50 text-primary"><Brain className="size-4" /></span>}
          </div>
        ))}
      </div>
    </div>
  );
}
