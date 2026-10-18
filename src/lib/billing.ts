export const BILLING = {
  monthly: { priceId: "price_1URytG2ObzN7GTjtKLsmkRtq", amount: 500, credits: 500 },
  topup: { priceId: "price_1URxLX2ObzN7GTjtFIKtVzrP", amount: 500, credits: 500 },
} as const;

export function paidTopup(session: { mode: string | null; payment_status: string; client_reference_id: string | null }, lines: { price: { id: string } | null; quantity: number | null }[]) {
  return session.mode === "payment" && session.payment_status === "paid" && !!session.client_reference_id
    && lines.length === 1 && lines[0]?.price?.id === BILLING.topup.priceId && lines[0]?.quantity === 1;
}