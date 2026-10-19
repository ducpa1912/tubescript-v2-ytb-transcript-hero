import { createFileRoute, Link, ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, Lock, Settings } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { checkPayment, createCheckout, getBilling, getLedger, openBillingPortal } from "@/lib/billing.functions";
import { getAccount } from "@/lib/account.functions";

const LinkCheckout = lazy(() => import("@/components/link-checkout"));
const billingOptions = queryOptions({ queryKey: ["billing"], queryFn: () => getBilling() });
const ledgerOptions = queryOptions({ queryKey: ["ledger"], queryFn: () => getLedger() });
type Product = "monthly" | "topup";

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: (search) => z.object({ session_id: z.string().max(255).optional() }).parse(search),
  loader: ({ context }) => context.queryClient.ensureQueryData(billingOptions),
  head: () => ({ meta: [{ title: "Credits & billing — Tubescript" }, { name: "description", content: "Manage your Tubescript subscription and transcript credits." }, { property: "og:title", content: "Credits & billing — Tubescript" }, { property: "og:description", content: "Manage your Tubescript subscription and transcript credits." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] }),
  component: BillingPage,
});

function BillingPage() {
  const billing = useSuspenseQuery(billingOptions);
  const account = useQuery({ queryKey: ["account"], queryFn: () => getAccount() });
  const queryClient = useQueryClient();
  const portal = useServerFn(openBillingPortal);
  const verify = useServerFn(checkPayment);
  const { session_id } = Route.useSearch();
  const payment = useQuery({ queryKey: ["payment", session_id], enabled: !!session_id,
    queryFn: () => session_id ? verify({ data: { sessionId: session_id } }) : null,
    refetchInterval: (q) => q.state.data?.delivered ? false : 3000 });
  useEffect(() => {
    if (payment.data?.delivered) for (const k of ["account", "billing", "ledger"]) void queryClient.invalidateQueries({ queryKey: [k] });
  }, [payment.data?.delivered, queryClient]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subscribed = billing.data.subscribed;

  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-10">
    <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">← Your projects</Link>
    <h1 className="mt-6 text-3xl font-semibold">Credits & billing</h1>
    <p className="mt-3 font-mono text-sm text-muted-foreground">
      {account.data?.credits ?? "—"} credits · {account.data ? Math.max(0, 10 - account.data.usedToday) : "—"}/10 free left today · free transcripts are always used first · resets 00:00 UTC
    </p>
    {session_id && <p role="status" className="mt-4 text-sm">{payment.isError ? "Unable to confirm payment. Please refresh or contact support." : payment.data?.delivered ? "Payment confirmed — 500 credits added." : payment.data?.paid ? "Payment received. Waiting for your credits…" : "Checking payment…"}</p>}
    {!billing.data.checkoutReady && <p role="status" className="mt-3 text-sm text-warning">Payments are awaiting final Stripe setup.</p>}

    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <PlanCard product="monthly" title="Monthly plan" price="$5 / month"
        body="Fits casual content creators. 500 transcripts every month on top of your 10 free daily, and unlocks credit top-ups."
        active={!subscribed} badge={subscribed ? "Active subscription" : null}
        footer={subscribed && <Button variant="ghost" size="sm" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { const res = await portal(); window.location.assign(res.url); } catch { setError("Billing management is unavailable. Please try again."); } finally { setBusy(false); } }}><Settings />Manage subscription</Button>}
        ready={billing.data.checkoutReady} linkReady={billing.data.linkReady} onError={setError} />
      <PlanCard product="topup" title="Credit top-up" price="$5 one-time"
        body="500 extra transcript credits. Credits never expire."
        active={subscribed} badge={subscribed ? null : "Requires a monthly plan"}
        ready={billing.data.checkoutReady} linkReady={billing.data.linkReady} onError={setError} />
    </div>
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    <Ledger />
  </main>;
}

function PlanCard({ product, title, price, body, active, badge, footer, ready, linkReady, onError }: {
  product: Product; title: string; price: string; body: string; active: boolean; badge: string | null;
  footer?: React.ReactNode; ready: boolean; linkReady: boolean; onError: (e: string | null) => void;
}) {
  const checkout = useServerFn(createCheckout);
  const [busy, setBusy] = useState(false);
  const enabled = active && ready;
  // Preload the Link session so the green Link button is visible immediately.
  const express = useQuery({ queryKey: ["express", product], enabled: enabled && linkReady, staleTime: 30 * 60_000, retry: false,
    queryFn: async () => { const r = await checkout({ data: { product, express: true } });
      return r.clientSecret && r.publishableKey ? { clientSecret: r.clientSecret, publishableKey: r.publishableKey } : null; } });
  async function standard() {
    setBusy(true); onError(null);
    try { const r = await checkout({ data: { product, express: false } }); if (r.url) window.location.assign(r.url); }
    catch (e) { onError(e instanceof Error ? e.message : "Checkout unavailable."); }
    finally { setBusy(false); }
  }
  return <section aria-disabled={!active} className={`relative rounded-lg border bg-card p-5 ${active ? "" : "opacity-60"}`}>
    <div className="flex items-start justify-between gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {badge && <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
        {active ? null : product === "topup" ? <Lock className="size-3" /> : <CheckCircle2 className="size-3" />}{badge}</span>}
    </div>
    <p className="mt-1 font-mono text-xl">{price}</p>
    <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    <div className={`mt-5 grid grid-cols-2 items-start gap-2 ${active ? "" : "pointer-events-none select-none blur-[1px]"}`}>
      <Button className="h-12" disabled={!enabled || busy} onClick={() => void standard()}>
        {busy ? <Loader2 className="animate-spin" /> : <><CreditCard />Checkout</>}
      </Button>
      <div className="min-h-12">
        {!enabled || !linkReady ? <Button className="h-12 w-full" variant="outline" disabled>Link</Button>
          : express.isError ? <p className="text-xs text-destructive">{express.error instanceof Error ? express.error.message : "Link unavailable."}</p>
          : !express.data ? <Button className="h-12 w-full" variant="outline" disabled><Loader2 className="animate-spin" /></Button>
          : <ClientOnly><Suspense fallback={<Button className="h-12 w-full" variant="outline" disabled><Loader2 className="animate-spin" /></Button>}>
              <LinkCheckout key={express.data.clientSecret} {...express.data} /></Suspense></ClientOnly>}
      </div>
    </div>
    {footer && <div className="mt-3">{footer}</div>}
  </section>;
}

const TYPE_LABEL: Record<string, string> = { crawl: "Transcripts", test_grant: "Bonus", subscription: "Monthly plan", topup: "Top-up", referral: "Referral bonus", bonus: "Bonus" };

function Ledger() {
  const ledger = useQuery(ledgerOptions);
  return <section className="mt-10">
    <h2 className="text-lg font-semibold">Credit history</h2>
    {ledger.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      : ledger.isError ? <p role="alert" className="mt-3 text-sm text-destructive">Unable to load credit history.</p>
      : !ledger.data?.length ? <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
      : <div className="mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="p-2">Date</th><th className="p-2">Event</th><th className="p-2 text-right">Credits added</th><th className="p-2 text-right">Credits used</th><th className="p-2 text-right">Free used</th></tr>
          </thead>
          <tbody>{ledger.data.map((r) => <tr key={r.id} className="border-t">
            <td className="whitespace-nowrap p-2 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</td>
            <td className="p-2"><span className="font-medium">{TYPE_LABEL[r.type] ?? r.type}</span>{r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}</td>
            <td className="p-2 text-right font-mono text-success">{r.delta > 0 ? `+${r.delta}` : ""}</td>
            <td className="p-2 text-right font-mono">{r.delta < 0 ? r.delta : ""}</td>
            <td className="p-2 text-right font-mono text-muted-foreground">{r.free_used > 0 ? r.free_used : ""}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
