import { describe, expect, it } from "vitest";
import { accessBlock } from "@/lib/youtube.server";

describe("accessBlock", () => {
  it("treats LOGIN_REQUIRED as a block, not missing captions", () => {
    expect(accessBlock([{ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" } }])).toMatch(/^LOGIN_REQUIRED/);
  });
  it("detects bot-check messages even when status is OK", () => {
    expect(accessBlock([{ playabilityStatus: { status: "OK", reason: "Please sign in" } }])).not.toBeNull();
  });
  it("does not flag playable videos", () => {
    expect(accessBlock([{ playabilityStatus: { status: "OK" } }, null])).toBeNull();
  });
});
