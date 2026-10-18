import { describe, expect, it } from "vitest";
import { BILLING, paidTopup } from "@/lib/billing";

describe("Tubescript billing", () => {
  it("monthly costs $5 and delivers 500 transcripts", () => { expect(BILLING.monthly.amount).toBe(500); expect(BILLING.monthly.credits).toBe(500); });
  it("top-up costs $5 and delivers 500 transcripts", () => { expect(BILLING.topup.amount).toBe(500); expect(BILLING.topup.credits).toBe(500); });
  it("does not fulfill unpaid, wrong-price, duplicate-quantity, or subscription sessions as topups", () => {
    const session = { mode: "payment", payment_status: "paid", client_reference_id: "user" };
    const lines = [{ price: { id: BILLING.topup.priceId }, quantity: 1 }];
    expect(paidTopup(session, lines)).toBe(true);
    expect(paidTopup({ ...session, payment_status: "unpaid" }, lines)).toBe(false);
    expect(paidTopup({ ...session, mode: "subscription" }, lines)).toBe(false);
    expect(paidTopup(session, [{ price: { id: "wrong" }, quantity: 1 }])).toBe(false);
    expect(paidTopup(session, [{ price: { id: BILLING.topup.priceId }, quantity: 2 }])).toBe(false);
    expect(paidTopup({ ...session, client_reference_id: null }, lines)).toBe(false);
  });
});