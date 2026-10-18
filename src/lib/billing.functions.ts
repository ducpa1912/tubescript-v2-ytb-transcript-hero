import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BILLING } from "./billing";

export const getBilling = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.from("billing_accounts").select("subscription_status").eq("user_id", context.userId).maybeSingle();
  if (error) throw new Error("Unable to load billing.");
  return { subscribed: ["active", "trialing"].includes(data?.subscription_status ?? ""), status: data?.subscription_status ?? "none",
    checkoutReady: !!process.env["STRIPE_SECRET_KEY"] && !!process.env["STRIPE_WEBHOOK_SECRET"],
    linkReady: !!process.env["STRIPE_PUBLISHABLE_KEY"] };
});

export const createCheckout = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ product: z.enum(["monthly", "topup"]), express: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env["STRIPE_SECRET_KEY"];
    const publishableKey = process.env["STRIPE_PUBLISHABLE_KEY"];
    if (!key || !process.env["STRIPE_WEBHOOK_SECRET"]) throw new Error("Payments are awaiting final Stripe setup.");
    if (data.express && (!publishableKey || publishableKey.startsWith("pk_test_") !== key.startsWith("sk_test_"))) throw new Error("Link is awaiting a matching Stripe publishable key.");
    const { stripeClient } = await import("./billing.server");
    const stripe = stripeClient(key);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: account, error } = await context.supabase.from("billing_accounts").select("*").eq("user_id", context.userId).maybeSingle();
    if (error) throw new Error("Unable to load billing.");
    let customerId = account?.customer_id;
    if (!customerId) {
      const email = typeof context.claims?.email === "string" ? context.claims.email : undefined;
      const customer = await stripe.customers.create({ email, metadata: { tubescript_user_id: context.userId } }, { idempotencyKey: `tubescript-customer-${context.userId}` });
      customerId = customer.id;
      const { error: saveError } = await db.from("billing_accounts").upsert({ user_id: context.userId, customer_id: customerId }, { onConflict: "user_id", ignoreDuplicates: true });
      if (saveError) throw new Error("Unable to save billing account.");
    }
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    const active = subscriptions.data.some((s) => ["active", "trialing", "past_due"].includes(s.status) && s.items.data.some((i) => i.price.id === BILLING.monthly.priceId));
    if (data.product === "monthly" && active) throw new Error("You already have a subscription. Manage it below.");
    if (data.product === "topup" && !subscriptions.data.some((s) => s.status === "active" && s.items.data.some((i) => i.price.id === BILLING.monthly.priceId))) throw new Error("Subscribe before purchasing additional credits.");
    const origin = new URL(getRequest().url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: data.product === "monthly" ? "subscription" : "payment", ui_mode: data.express ? "elements" : "hosted_page",
      customer: customerId, client_reference_id: context.userId,
      line_items: [{ price: BILLING[data.product].priceId, quantity: 1 }], payment_method_types: ["card", "link"],
      automatic_tax: { enabled: true },
      ...(data.product === "monthly" ? { subscription_data: { metadata: { tubescript_user_id: context.userId }, billing_mode: { type: "flexible" as const } } } : {}),
      ...(data.express ? { return_url: `${origin}/billing?session_id={CHECKOUT_SESSION_ID}` }
        : { success_url: `${origin}/billing?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin}/billing` }),
    });
    return { url: session.url, clientSecret: session.client_secret, publishableKey: data.express ? publishableKey : null };
  });

export const openBillingPortal = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data } = await context.supabase.from("billing_accounts").select("customer_id").eq("user_id", context.userId).maybeSingle();
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!data || !key) throw new Error("No billing account found.");
  const { stripeClient } = await import("./billing.server");
  const session = await stripeClient(key).billingPortal.sessions.create({ customer: data.customer_id, return_url: `${new URL(getRequest().url).origin}/billing` });
  return { url: session.url };
});

export const checkPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ sessionId: z.string().regex(/^cs_[a-zA-Z0-9_]+$/).max(255) }).parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env["STRIPE_SECRET_KEY"];
    if (!key) throw new Error("Payments unavailable.");
    const { stripeClient } = await import("./billing.server");
    const session = await stripeClient(key).checkout.sessions.retrieve(data.sessionId);
    if (session.client_reference_id !== context.userId) throw new Error("Payment not found.");
    const reference = session.mode === "subscription" ? (typeof session.invoice === "string" ? session.invoice : session.invoice?.id) : session.id;
    const { data: saved } = await context.supabase.from("payment_fulfillments").select("reference_id").eq("reference_id", reference ?? "").maybeSingle();
    return { paid: session.payment_status === "paid", delivered: !!saved };
  });