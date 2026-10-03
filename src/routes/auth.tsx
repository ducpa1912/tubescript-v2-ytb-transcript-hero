import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({
    meta: [
      { title: "Sign in — Tubescript" },
      { name: "description", content: "Sign in to Tubescript to save channel crawls as projects and keep every transcript you extract." },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Sign in — Tubescript" },
      { property: "og:description", content: "Sign in to Tubescript to save channel crawls as projects and keep every transcript you extract." },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function AuthPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) window.location.replace("/");
    });
  }, []);

  const signInWithGoogle = async () => {
    setLoading(true);
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    window.location.replace("/");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to Tubescript
        </Link>
        <h1 className="mt-8 text-2xl font-semibold tracking-tight text-foreground">
          Sign in to Tubescript
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Save every channel crawl as a project, keep transcripts forever, and
          track your daily quota.
        </p>
        <button
          onClick={signInWithGoogle}
          disabled={loading}
          className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.27 3.36-7.27 7.19-7.27 3.19 0 4.89 1.83 5.01 1.98l1.85-1.8C18.79 4.61 16.36 2 12.19 2 7.42 2 3 5.69 3 12s4.28 10 9.19 10c4.53 0 8.91-3.29 8.91-10 0-.83-.14-1.47-.4-1.9z"/>
          </svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
