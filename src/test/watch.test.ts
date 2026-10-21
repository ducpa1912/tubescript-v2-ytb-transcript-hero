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
  it("rejects missing, duplicate and out-of-interval moments", () => {
    const base = { summary: "Summary" };
    expect(() => validateWatch({ ...base, moments: [moment] }, [...segments, { id: "s02", start: 140, end: 150, text: "Next" }])).toThrow("1/2");
    expect(() => validateWatch({ ...base, moments: [moment, moment] }, segments)).toThrow("duplicate");
    expect(() => validateWatch({ ...base, moments: [{ ...moment, at: 200 }] }, segments)).toThrow("outside");
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