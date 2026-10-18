import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: { handlers: { POST: async ({ request }) => {
    const key = process.env["STRIPE_SECRET_KEY"];
    const secret = process.env["STRIPE_WEBHOOK_SECRET"];
    if (!key || !secret) return new Response("Payments not configured", { status: 503 });
    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("Missing signature", { status: 400 });
    if (Number(request.headers.get("content-length") ?? 0) > 1048576) return new Response("Payload too large", { status: 413 });
    const body = await request.text();
    if (body.length > 1048576) return new Response("Payload too large", { status: 413 });
    const { stripeClient, fulfillEvent } = await import("@/lib/billing.server");
    const stripe = stripeClient(key);
    let event;
    try { event = await stripe.webhooks.constructEventAsync(body, signature, secret); }
    catch { return new Response("Invalid signature", { status: 400 }); }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await fulfillEvent(stripe, supabaseAdmin, event);
      return Response.json({ received: true });
    } catch { return new Response("Payment processing failed; retry required", { status: 500 }); }
  } } },
});