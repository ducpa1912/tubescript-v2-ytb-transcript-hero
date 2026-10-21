import { describe, expect, it } from "vitest";
import { ANALYSIS_COST, analysisDebit, analysisFailureStatus, analysisResultSchema, buildSegments, computeVideoFacts, isFreeModel, validateAnalysis } from "@/lib/analysis";

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
    expect(() => validateAnalysis({ ...result, keyMoments: [] }, segments, "watch")).toThrow("no observations");
  });
});

describe("analysis hardening", () => {
  const base = { summary: "Summary", thesis: "Thesis" };
  const segments = Array.from({ length: 16 }, (_, i) => ({ id: `s${i + 1}`, start: i * 10, end: (i + 1) * 10, text: "two words" }));
  const observation = (segmentId: string) => ({ segmentId, seen: "A picture", heard: "Speech", mismatch: null });
  it("normalizes null optional text and preserves legacy hook/tone/text", () => {
    const result = analysisResultSchema.parse({ ...base, hook: "Old hook", tone: "Calm", cta: null, visualNarrative: "Old visual", onScreenText: ["Legacy label"], observations: [{ segmentId: "s1", seen: null, heard: null, mismatch: null }] });
    expect(result.hook.prose).toBe("Old hook"); expect(result.tone.primary).toBe("Calm");
    expect(result.hook.attributes.question).toBe(0); expect(result.visual_narrative).toBe("Old visual");
    expect(result.observations[0]).toEqual({ segmentId: "s1", seen: "", heard: "", mismatch: "" });
    expect(result.onScreenText[0]).toEqual({ text: "Legacy label" }); expect(result.cta).toBe("");
    expect(() => analysisResultSchema.parse({ ...base, hook: { attributes: { question: 1.1 } } })).toThrow();
  });
  it("preserves 14/16 coverage and fills only missing observations in segment order", () => {
    const result = validateAnalysis({ ...base, observations: segments.slice(0, 14).reverse().map((s) => observation(s.id)) }, segments, "watch");
    expect(result.observations.map((o) => o.segmentId)).toEqual(segments.map((s) => s.id));
    expect(result.observations[15]).toEqual({ segmentId: "s16", seen: "", heard: "", mismatch: "" });
  });
  it("rejects severe missing coverage, duplicates and unknown on-screen anchors", () => {
    const many = Array.from({ length: 47 }, (_, i) => ({ id: `s${i}`, start: i, end: i + 1, text: "Word" }));
    expect(() => validateAnalysis({ ...base, observations: many.slice(0, 2).map((s) => observation(s.id)) }, many, "watch")).toThrow("2/47");
    expect(() => validateAnalysis({ ...base, observations: [observation("s1"), observation("s1")] }, segments, "watch")).toThrow("duplicate");
    expect(() => validateAnalysis({ ...base, onScreenText: [{ segmentId: "fake", text: "Label" }] }, segments, "watch")).toThrow("unknown segment");
  });
  it("computes caption facts without claiming visual cuts and merges overlapping speech", () => {
    const facts = computeVideoFacts([{ id: "s1", start: 0, end: 20, text: "one two" }, { id: "s2", start: 10, end: 40, text: "three four" }], 60, 2);
    expect(facts).toMatchObject({ durationS: 60, medianSegmentS: 25, transcriptSegmentsPerMin: 2, wordsTotal: 4, wordsPerMin: 4, speechTimePct: 67, longSegmentCount: 2, chapterCount: 2 });
    expect(facts).not.toHaveProperty("cutsPerMin"); expect(computeVideoFacts([]).wordsPerMin).toBe(0);
  });
  it("stops automatic retries at three attempts and immediately on terminal failures", () => {
    expect(analysisFailureStatus(1)).toBe("pending"); expect(analysisFailureStatus(2)).toBe("pending");
    expect(analysisFailureStatus(3)).toBe("failed"); expect(analysisFailureStatus(1, true)).toBe("failed");
  });
});