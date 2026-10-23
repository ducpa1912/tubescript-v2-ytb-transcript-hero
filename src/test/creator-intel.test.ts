import { describe, expect, it } from "vitest";
import { detectRetention } from "@/lib/retention";
import { scoreChannel, retrieve } from "@/lib/channel";

describe("retention deconstructor", () => {
  const heat = [0.3, 0.3, 0.9, 0.3, 0.3, 0.6, 0.2, 0.3].map((intensity, i) => ({ startMs: i * 10000, intensity }));
  it("flags a spike at least 0.15 above the median", () => {
    const { spikes } = detectRetention(heat);
    expect(spikes.map((s) => s.startS)).toContain(20);
  });
  it("flags a drop of at least 0.12 as a drop", () => {
    const { drops } = detectRetention(heat);
    expect(drops.some((d) => d.startS === 50 && d.endS === 60)).toBe(true);
  });
  it("ignores flat replay graphs", () => {
    const flat = detectRetention([0.5, 0.5, 0.5].map((intensity, i) => ({ startMs: i * 1000, intensity })));
    expect(flat.spikes).toHaveLength(0);
    expect(flat.drops).toHaveLength(0);
  });
});

describe("channel hit vs flop scoring", () => {
  const old = "2025-01-01";
  const now = new Date("2026-10-22").getTime();
  const base = (id: string, views: number, publish_date = old) => ({ id, title: id, views, publish_date, duration_seconds: 600 });
  it("hit is ≥2x median, flop ≤0.5x median", () => {
    const s = scoreChannel([base("a", 100), base("b", 100), base("c", 100), base("d", 200), base("e", 50)], now);
    expect(s.medianViews).toBe(100);
    expect(s.videos.find((v) => v.id === "d")?.label).toBe("hit");
    expect(s.videos.find((v) => v.id === "e")?.label).toBe("flop");
  });
  it("videos under 14 days old are never labelled flops", () => {
    const s = scoreChannel([base("a", 100), base("b", 100), base("n", 10, "2026-10-15")], now);
    expect(s.videos.find((v) => v.id === "n")?.label).toBe("new");
  });
  it("retrieves the chunk that matches the question", () => {
    const r = retrieve("pricing strategy", [{ ...base("x", 1), transcript: "we talk about pricing strategy here" }, { ...base("y", 1), transcript: "cooking pasta" }]);
    expect(r[0]?.videoId).toBe("x");
  });
});
