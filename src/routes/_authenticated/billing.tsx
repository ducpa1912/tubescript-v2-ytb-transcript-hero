import { createFileRoute, Link, ClientOnly } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { CreditCard, Loader2, Settings, Zap } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { checkPayment, createCheckout, getBilling, openBillingPortal } from "@/lib/billing.functions";
import { getAccount } from "@/lib/account.functions";

const LinkCheckout = lazy(() => import("@/components/link-checkout"));
const billingOptions = queryOptions({ queryKey: ["billing"], queryFn: () => getBilling() });
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
  const checkout = useServerFn(createCheckout);
  const portal = useServerFn(openBillingPortal);
  const verify = useServerFn(checkPayment);
  const { session_id } = Route.useSearch();
  const payment = useQuery({ queryKey: ["payment", session_id], enabled: !!session_id,
    queryFn: () => session_id ? verify({ data: { sessionId: session_id } }) : null,
    refetchInterval: (q) => q.state.data?.delivered ? false : 3000 });
  useEffect(() => { if (payment.data?.delivered) { void queryClient.invalidateQueries({ queryKey: ["account"] }); void queryClient.invalidateQueries({ queryKey: ["billing"] }); } }, [payment.data?.delivered, queryClient]);
  const [product, setProduct] = useState<"monthly" | "topup">("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [express, setExpress] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  async function pay(link: boolean) {
    setBusy(link ? "link" : "standard"); setError(null);
    try {
      const res = await checkout({ data: { product, express: link } });
      if (link && res.clientSecret && res.publishableKey) setExpress({ clientSecret: res.clientSecret, publishableKey: res.publishableKey });
      else if (res.url) window.location.assign(res.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Checkout unavailable."); }
    finally { setBusy(null); }
  }
  const disabled = !billing.data.checkoutReady || !!busy || (product === "topup" ? !billing.data.subscribed : billing.data.subscribed);
  return <main className="mx-auto min-h-screen max-w-2xl px-4 py-10">
    <Link to="/projects" className="text-sm text-muted-foreground hover:text-foreground">← Your projects</Link>
    <h1 className="mt-6 text-3xl font-semibold">Credits & billing</h1>
    <p className="mt-3 font-mono text-sm text-muted-foreground">{account.data?.credits ?? "—"} credits · {account.data?.usedToday ?? "—"}/10 free today</p>
    {session_id && <p role="status" className="mt-4 text-sm">{payment.isError ? "Unable to confirm payment. Please refresh or contact support." : payment.data?.delivered ? "Payment confirmed — 500 credits added." : payment.data?.paid ? "Payment received. Waiting for your credits…" : "Checking payment…"}</p>}
    <div className="mt-8 grid grid-cols-2 gap-2" role="group" aria-label="Purchase type">
      <Button variant={product === "monthly" ? "default" : "outline"} onClick={() => { setProduct("monthly"); setExpress(null); }}>Monthly plan</Button>
      <Button variant={product === "topup" ? "default" : "outline"} onClick={() => { setProduct("topup"); setExpress(null); }}>Credit top-up</Button>
    </div>
    <section className="mt-6 border-y py-6">
      <h2 className="text-xl font-semibold">{product === "monthly" ? "$5 / month" : "$5 one-time"}</h2>
      <p className="mt-2 text-muted-foreground">{product === "monthly" ? "500 transcripts each month + 10 free every day" : "500 additional transcript credits"}</p>
      {product === "topup" && !billing.data.subscribed && <p className="mt-3 text-sm text-muted-foreground">An active monthly subscription is required for top-ups.</p>}
      {!billing.data.checkoutReady && <p role="status" className="mt-3 text-sm text-warning">Payments are awaiting final Stripe setup.</p>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Button disabled={disabled} onClick={() => void pay(false)}><CreditCard />{busy === "standard" ? <Loader2 className="animate-spin" /> : "Standard checkout"}</Button>
        <Button variant="outline" disabled={disabled || !billing.data.linkReady} onClick={() => void pay(true)}><Zap />{busy === "link" ? <Loader2 className="animate-spin" /> : "Link express checkout"}</Button>
      </div>
      {express && <div className="mt-4"><ClientOnly><Suspense fallback={<p className="text-sm">Loading Link…</p>}><LinkCheckout key={express.clientSecret} {...express} /></Suspense></ClientOnly></div>}
      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    </section>
    {billing.data.status !== "none" && <Button variant="ghost" className="mt-4" disabled={!!busy} onClick={async () => { setBusy("portal"); setError(null); try { const res = await portal(); window.location.assign(res.url); } catch { setError("Billing management is unavailable. Please try again."); } finally { setBusy(null); } }}><Settings />Manage subscription</Button>}
  </main>;
}