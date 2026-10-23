import { describe, expect, it } from "vitest";
import { scoreChannel } from "@/lib/channel";
import { validateChannelDossier, dossierMarkdown } from "@/lib/channel-intelligence";

const now = Date.parse("2026-10-23");
const videos = Array.from({ length: 22 }, (_, i) => ({ id: `video${i}`, title: `Video ${i}`, views: i === 0 ? 100000 : 100 + i * 40, publish_date: "2026-08-01", duration_seconds: 600, transcript: "We feared losing our work. Here is a practical way to rebuild your skills." }));
const finding = { title: "Skills anxiety", finding: "A practical answer to uncertainty.", videoIds: ["video0"], confidence: "low" };
const evidence = { videoId: "video0", quote: "We feared losing our work.", significance: "Explicit fear framing." };
const autopsy = { videoId: "video0", verdict: "Practical relief may fit the audience.", publicationContext: "External events are unknown.", scriptArchitecture: "Fear followed by a practical payoff.", emotionalAppeal: "Fear to agency, inferred from wording.", audienceFit: "People seeking useful skills.", packaging: "Title evidence is limited.", comparisonVideoId: "video1", comparison: "Same publication date and duration.", evidence: [evidence], alternativeExplanations: ["Distribution is unknown."], experiment: "Compare relief and fear hooks on the next two uploads.", confidence: "low" };
const raw = () => ({ format: "channel-intelligence", overview: "Practical responses to uncertainty.", topics: [finding], audience: [{ segment: "Skills-focused viewers", need: "Agency", emotionalAppeal: "Relief is inferred, not observed sentiment.", evidence: [evidence], confidence: "low" }], voice: [finding], trends: [], opportunities: [], autopsies: [autopsy, { ...autopsy, videoId: "video1", comparisonVideoId: "video0", evidence: [{ ...evidence, videoId: "video1" }] }], limitations: ["No measured audience sentiment or click-through data."] });

describe("publication-peer performance", () => {
  it("scores against at most 20 other dated videos and flags a log-view breakout", () => {
    const v = scoreChannel(videos, now).videos[0];
    expect(v?.peerCount).toBe(20); expect(v?.performance).toBe("breakout"); expect(v?.peerZ).toBeGreaterThan(2);
  });
  it("does not infer statistical performance from missing publication dates", () => {
    const v = scoreChannel([{ ...videos[0], id: "undated", title: "Undated", views: 100000, publish_date: null, duration_seconds: 600 }, ...videos.slice(1)], now).videos[0];
    expect(v?.peerZ).toBeNull(); expect(v?.performance).toBe("insufficient");
  });
  it("never flags a recent video as an underperformer", () => {
    const recent = { id: "recent", title: "Recent", views: 1, publish_date: "2026-10-22", duration_seconds: 600 };
    expect(scoreChannel([recent, ...videos], now).videos[0]?.performance).toBe("new");
    expect(scoreChannel([{ ...recent, views: 1000000 }, ...videos], now).videos[0]?.label).toBe("new");
  });
  it("requires eight peers and nonzero variance", () => {
    expect(scoreChannel(videos.slice(0, 8), now).videos[0]?.peerZ).toBeNull();
    expect(scoreChannel(videos.map((v) => ({ ...v, views: 100 })), now).videos[0]?.peerZ).toBeNull();
  });
});
describe("contextual explanation ingestion", () => {
  it("accepts literal script evidence and produces readable export content", () => {
    const d = validateChannelDossier(raw(), scoreChannel(videos, now).videos);
    expect(dossierMarkdown(d, "Creator", videos)).toContain("We feared losing our work.");
  });
  it("rejects fabricated script quotes", () => {
    const r = raw(); r.autopsies[0].evidence = [{ ...evidence, quote: "An invented audience comment." }];
    expect(() => validateChannelDossier(r, scoreChannel(videos, now).videos)).toThrow("Unsupported transcript quote");
  });
  it("rejects unknown source videos and self-comparisons", () => {
    const r = raw(); r.autopsies[0].comparisonVideoId = "unknown";
    expect(() => validateChannelDossier(r, scoreChannel(videos, now).videos)).toThrow("Unknown channel source");
    r.autopsies[0].comparisonVideoId = "video0";
    expect(() => validateChannelDossier(r, scoreChannel(videos, now).videos)).toThrow("different comparator");
  });
});