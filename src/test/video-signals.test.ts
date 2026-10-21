import { describe, expect, it } from "vitest";
import { parseVideoSignals } from "@/lib/youtube.server";

describe("public video signals", () => {
  it("extracts measured replay heat and chapter anchors, rejecting invalid buckets", () => {
    const data = { macroMarkersListEntity: { markersList: { markerType: "MARKER_TYPE_HEATMAP", markers: [
      { startMillis: 628600, intensityScoreNormalized: 1 }, { startMillis: -1, intensityScoreNormalized: 0.5 }, { startMillis: 1, intensityScoreNormalized: 2 },
    ] } }, chapterRenderer: { timeRangeStartMillis: 10000, title: { simpleText: "Intro" } } };
    expect(parseVideoSignals(`var ytInitialData = ${JSON.stringify(data)};`)).toEqual({ heatMoments: [{ startMs: 628600, intensity: 1 }], chapters: [{ startS: 10, title: "Intro" }] });
  });
  it("returns no made-up heatmap for missing or malformed payloads", () => {
    expect(parseVideoSignals("No heatmap")).toEqual({ heatMoments: [], chapters: [] });
    expect(parseVideoSignals("var ytInitialData = {broken}")).toEqual({ heatMoments: [], chapters: [] });
  });
});