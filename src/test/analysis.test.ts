import { describe, expect, it } from "vitest";
import { ANALYSIS_COST, analysisDebit, buildSegments, isFreeModel, validateAnalysis } from "@/lib/analysis";

describe("video analysis pricing", () => {
  it("Read is free and does not consume transcript allowance or wallet credits", () => {
    expect(ANALYSIS_COST.read).toBe(0); expect(analysisDebit("read", 0, false, true)).toBe(0);
  });
  it("Watch charges exactly 10 credits per delivered video", () => {
    expect(ANALYSIS_COST.watch).toBe(10); expect(analysisDebit("watch", 10, false, true)).toBe(10);
    expect(() => analysisDebit("watch", 9, false, true)).toThrow("Insufficient");
  });
  it("never charges failed deliveries or already unlocked analyses", () => {
    expect(analysisDebit("watch", 0, false, false)).toBe(0);
    expect(analysisDebit("watch", 0, true, true)).toBe(0);
  });
  it("requires provider-confirmed zero input and output prices for free text routing", () => {
    expect(isFreeModel({ id: "fake:free" })).toBe(false);
    expect(isFreeModel({ id: "free", pricing: { prompt: "0", completion: "0" } })).toBe(true);
    expect(isFreeModel({ id: "paid:free", pricing: { prompt: "0", completion: "0.001" } })).toBe(false);
  });
});
describe("analysis anchors", () => {
  it("uses only caption timestamps and stable segment IDs", () => {
    const segments = buildSegments("", Array.from({ length: 10 }, (_, i) => ({ start: i * 5, dur: 5, text: `Sentence ${i}.` })));
    expect(segments.map((s) => s.start)).toEqual([0, 20, 40]);
    expect(segments.map((s) => s.id)).toEqual(["s01", "s02", "s03"]);
    expect(segments.at(-1)?.end).toBe(50);
  });
  it("does not fabricate timestamps for legacy text", () => {
    expect(buildSegments("An untimed transcript.", [])[0]).toEqual({ id: "s01", start: null, end: null, text: "An untimed transcript." });
  });
  it("rejects model-invented anchors and Watch without visual observations", () => {
    const segments = buildSegments("Words", []);
    const result = { summary: "Summary", thesis: "Thesis", hook: "", structure: [], tone: "", claims: [], mentalModels: [], intent: "", cta: "", keyMoments: [{ segmentId: "s99", label: "Fake" }] };
    expect(() => validateAnalysis(result, segments, "read")).toThrow("unknown segment");
    expect(() => validateAnalysis({ ...result, keyMoments: [] }, segments, "watch")).toThrow("cover every segment");
  });
});