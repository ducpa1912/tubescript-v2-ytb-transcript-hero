import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDecodoSubtitles } from "../lib/decodo.server";
import { extractVideo } from "../lib/youtube.server";

const track = (text: string) => ({ events: [
  { tStartMs: 0, dDurationMs: 9000, id: 1 },
  { tStartMs: 320, dDurationMs: 5680, segs: [{ utf8: text }] },
] });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Decodo caption extraction", () => {
  it("parses actual auto-generated track shape despite leading window events", () => {
    expect(parseDecodoSubtitles({ auto_generated: { en: track("I'm a TV cameraman") } })).toEqual({
      transcript: "I'm a TV cameraman", lang: "en (auto)", cues: [{ start: 0.32, dur: 5.68, text: "I'm a TV cameraman" }],
    });
  });
  it("prefers uploaded English over automatic English", () => {
    expect(parseDecodoSubtitles({ uploader_provided: { en: track("Creator") }, auto_generated: { en: track("Automatic") } })?.transcript).toBe("Creator");
  });
  it("never delivers non-English tracks", () => {
    expect(parseDecodoSubtitles({ manual: { fr: track("Bonjour") } })).toBeNull();
  });
  it("does not label an unrecognized provider response as missing captions", () => {
    expect(() => parseDecodoSubtitles({ unexpected: true })).toThrow("unrecognized");
  });
  it("routes fresh extraction only to Decodo, including metadata", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    const request = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ results: [{ status_code: 200, content: body.target === "youtube_subtitles"
        ? { auto_generated: { en: track("Delivered") } } : { title: "Video", view_count: 42, duration: 20 } }] }));
    });
    vi.stubGlobal("fetch", request);
    const result = await extractVideo("fXDc02qHAhY");
    expect(result.status).toBe("ok");
    expect(result.transcript).toBe("Delivered");
    expect(result.route).toBe("decodo_subtitles+metadata");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([url]) => url === "https://data.decodo.com/v1/scrape")).toBe(true);
  });
  it("requires Decodo configuration rather than falling back to direct YouTube", async () => {
    vi.stubEnv("DECODO_API_KEY", "");
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(extractVideo("fXDc02qHAhY")).rejects.toThrow("not configured");
    expect(request).not.toHaveBeenCalled();
  });
  it("tries uploaded English first and falls back to auto on a missing track", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    const origins: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (body.target === "youtube_metadata") return new Response(JSON.stringify({ content: {} }));
      origins.push(body.subtitle_origin);
      return body.subtitle_origin === "uploader_provided" ? new Response(JSON.stringify({ results: [{ status_code: 200, content: {} }] }))
        : new Response(JSON.stringify({ content: { auto_generated: { en: track("Auto fallback") } } }));
    }));
    expect((await extractVideo("fXDc02qHAhY")).transcript).toBe("Auto fallback");
    expect(origins).toEqual(["uploader_provided", "auto_generated"]);
  });
  it("surfaces upstream failures even when Decodo HTTP status is 200", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ status_code: 503, content: {} }] }))));
    await expect(extractVideo("fXDc02qHAhY")).rejects.toThrow("upstream HTTP 503");
  });
});