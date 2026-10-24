import { describe, expect, it } from "vitest";
import { intentText, matchIntent } from "@/lib/intent-search";

describe("intent search", () => {
  const text = intentText({ intent: "Sell a course through fear of layoffs", hook: { prose: "Curiosity gap about AI" }, structure: [{ label: "Pattern interrupt", explanation: "" }] });
  it("matches analysis fields, not transcript", () => {
    expect(matchIntent(text, "curiosity gap")).not.toBeNull();
    expect(matchIntent(text, "pattern interrupt")).not.toBeNull();
  });
  it("requires every word", () => expect(matchIntent(text, "curiosity sponsorship")).toBeNull());
});
