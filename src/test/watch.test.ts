import { describe, expect, it } from "vitest";
import { shotCategorySchema, validateWatch, watchNeedsRefresh } from "@/lib/watch";

const segments = [{ id: "s01", start: 120, end: 140, text: "The diagram shows the process." }];
const moment = { segmentId: "s01", at: 120.35999999999999, what_is_seen: "A flow diagram connects three labeled steps.", shot_type: { slug: "process-diagram", label: "Process diagram" } };
describe("latest Watch ingestion", () => {
  it("synchronizes rich visual evidence at hundredth-second precision", () => {
    const result = validateWatch({ summary: "A process is illustrated.", moments: [moment] }, segments);
    expect(result.moments[0]?.at).toBe(120.36);
    expect(result.moments[0]?.start).toBe(120); expect(result.moments[0]?.end).toBe(140);
    expect(result.moments[0]?.voice_tone.stress).toBe("");
  });
  it("allows specific new categories instead of stacking other", () => {
    expect(shotCategorySchema.parse(moment.shot_type).slug).toBe("process-diagram");
    expect(() => shotCategorySchema.parse({ slug: "other", label: "Other" })).toThrow();
  });
  it("accepts a top-level array, clamps drift, drops duplicates and unknown anchors", () => {
    const r = validateWatch([{ ...moment, at: 200 }, moment, { ...moment, segmentId: "s99" }], segments);
    expect(r.moments.length).toBe(1);
    expect(r.moments[0]?.at).toBe(140);
  });
  it("still rejects results missing too many segments", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, start: i * 10, end: i * 10 + 10, text: "x" }));
    expect(() => validateWatch({ summary: "S", moments: [{ ...moment, segmentId: "s0", at: 1 }] }, many)).toThrow("1/10");
  });
  it("refreshes old format and only reuses a new result completed after the request", () => {
    const old = { watch_format: 0, created_at: "2026-10-21T07:00:00Z" };
    expect(watchNeedsRefresh(old)).toBe(true);
    const latest = { ...old, watch_format: 2 };
    expect(watchNeedsRefresh(latest)).toBe(false);
    expect(watchNeedsRefresh(latest, "2026-10-21T07:01:00Z")).toBe(true);
    expect(watchNeedsRefresh(latest, "2026-10-21T06:59:00Z")).toBe(false);
  });
});