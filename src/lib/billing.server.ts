import Stripe from "stripe";
import { BILLING, paidTopup } from "./billing";

export function stripeClient(key: string) {
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

/** True when both keys belong to the same Stripe mode (test vs live), for sk_/rk_/pk_ keys. */
export function sameStripeMode(secretKey: string, publishableKey: string) {
  return secretKey.includes("_test_") === publishableKey.includes("_test_");
}

type Db = typeof import("@/integrations/supabase/client.server").supabaseAdmin;
function checked(error: { message: string } | null) { if (error) throw new Error(error.message); }

export async function syncSubscription(db: Db, subscription: Stripe.Subscription) {
  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const { error } = await db.from("billing_accounts").update({ subscription_id: subscription.id,
    subscription_status: subscription.status, updated_at: new Date().toISOString() }).eq("customer_id", customer);
  checked(error);
}

/** Grants a paid top-up session. Idempotent: the RPC dedupes on session ID. */
export async function fulfillTopupSession(stripe: Stripe, db: Db, sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.mode !== "payment") return false;
  const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 2 });
  if (!paidTopup(session, lines.data) || !session.client_reference_id) return false;
  const { error } = await db.rpc("fulfill_stripe_credits", { _user: session.client_reference_id, _reference: session.id, _type: "stripe_topup" });
  checked(error);
  return true;
}

/** Grants a paid subscription invoice. Idempotent: the RPC dedupes on invoice ID. */
export async function fulfillInvoice(stripe: Stripe, db: Db, invoiceId: string) {
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subId = invoice.parent?.subscription_details?.subscription;
  if (!subId || invoice.status !== "paid" || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason ?? "")) return false;
  const subscription = await stripe.subscriptions.retrieve(typeof subId === "string" ? subId : subId.id);
  const userId = subscription.metadata["tubescript_user_id"];
  if (!userId || !subscription.items.data.some((item) => item.price.id === BILLING.monthly.priceId)) return false;
  await syncSubscription(db, subscription);
  const { error } = await db.rpc("fulfill_stripe_credits", { _user: userId, _reference: invoiceId, _type: "stripe_subscription" });
  checked(error);
  return true;
}

export async function fulfillEvent(stripe: Stripe, db: Db, event: Stripe.Event) {
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await fulfillTopupSession(stripe, db, event.data.object.id);
  }
  if (event.type === "invoice.paid") {
    const invoiceId = event.data.object.id;
    if (!invoiceId) throw new Error("Missing invoice ID");
    await fulfillInvoice(stripe, db, invoiceId);
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted" || event.type === "customer.subscription.created") {
    // Read latest state so delayed events cannot overwrite a newer cancellation.
    await syncSubscription(db, await stripe.subscriptions.retrieve(event.data.object.id));
  }
}
