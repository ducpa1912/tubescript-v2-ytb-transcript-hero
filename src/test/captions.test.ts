import { describe, expect, it } from "vitest";
import { normalizeCues, parseCaptionXml, refreshCharge, toSubtitle } from "../lib/captions";
import { collectionIdPattern, collectionUrl, isKnownPage } from "../lib/collections";

describe("caption parsing and formats", () => {
  it("preserves legacy full text and second-based timing", () => {
    expect(parseCaptionXml('<text start="12.4" dur="3.1">Hello &amp; world</text>')).toEqual({ transcript: "Hello & world", cues: [{ start: 12.4, dur: 3.1, text: "Hello & world" }] });
  });
  it("reads format 3 millisecond offsets and segments", () => {
    expect(parseCaptionXml('<p t="1000" d="2400"><s>Hello</s> world</p>').cues).toEqual([{ start: 1, dur: 2.4, text: "Hello world" }]);
  });
  it("does not invent timestamps for text-only captions", () => {
    expect(parseCaptionXml('<text>Old text</text>')).toEqual({ transcript: "Old text", cues: [] });
    expect(normalizeCues([{ start: -1, dur: 2, text: "bad" }, { start: 1, dur: 0, text: "bad" }])).toEqual([]);
  });
  const cues = [{ start: 3599.5, dur: 1.25, text: "Across the hour" }];
  it("exports SRT with comma milliseconds", () => expect(toSubtitle(cues, "srt")).toBe("1\n00:59:59,500 --> 01:00:00,750\nAcross the hour\n"));
  it("exports VTT with header", () => expect(toSubtitle(cues, "vtt")).toBe("WEBVTT\n\n00:59:59.500 --> 01:00:00.750\nAcross the hour\n"));
  it("exports SBV with comma-separated timestamps", () => expect(toSubtitle(cues, "sbv")).toBe("00:59:59.500,01:00:00.750\nAcross the hour\n"));
});
describe("explicit timestamp refresh allowance", () => {
  it("uses the first 10 daily free units before paid credits", () => expect(refreshCharge(9, 500)).toEqual({ freeUsed: 1, creditUsed: 0 }));
  it("charges one credit after the free 10", () => expect(refreshCharge(10, 500)).toEqual({ freeUsed: 0, creditUsed: 1 }));
  it("rejects refresh without allowance", () => expect(refreshCharge(10, 0)).toBeNull());
});
describe("collection discovery", () => {
  it("opens saved playlists with list= rather than a channel URL", () => expect(collectionUrl("PL:PLabcdefghijk")).toBe("https://www.youtube.com/playlist?list=PLabcdefghijk"));
  it("allows playlist collection IDs in batch processing", () => expect(collectionIdPattern.test("PL:PLabcdefghijk")).toBe(true));
  it("stops only when a non-empty page contains exclusively known videos", () => {
    expect(isKnownPage(["a", "b"], new Set(["a", "b"]))).toBe(true);
    expect(isKnownPage(["a", "new"], new Set(["a", "b"]))).toBe(false);
    expect(isKnownPage([], new Set())).toBe(false);
  });
});