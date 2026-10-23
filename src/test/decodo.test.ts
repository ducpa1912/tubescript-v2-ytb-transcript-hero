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
  it("falls back on login required, fetching missing metadata and captions", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    const request = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (String(_url).startsWith("https://www.youtube.com/")) return new Response('var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED"}};');
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ results: [{ status_code: 200, content: body.target === "youtube_subtitles"
        ? { auto_generated: { en: track("Delivered") } } : { title: "Video", view_count: 42, duration: 20 } }] }));
    });
    vi.stubGlobal("fetch", request);
    const result = await extractVideo("fXDc02qHAhY");
    expect(result.status).toBe("ok");
    expect(result.transcript).toBe("Delivered");
    expect(result.route).toBe("youtube_direct→decodo_subtitles→decodo_metadata");
    expect(result.statusDetail).toContain("LOGIN_REQUIRED");
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("surfaces missing Decodo configuration after the direct attempt fails", async () => {
    vi.stubEnv("DECODO_API_KEY", "");
    const request = vi.fn(async () => new Response("blocked", { status: 403 })); vi.stubGlobal("fetch", request);
    await expect(extractVideo("fXDc02qHAhY")).rejects.toThrow("not configured");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("tries uploaded English first and falls back to auto on a missing track", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    const origins: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
      if (String(_url).startsWith("https://www.youtube.com/")) return new Response('var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED"}};');
      const body = JSON.parse(String(init.body));
      if (body.target === "youtube_metadata") return new Response(JSON.stringify({ content: {} }));
      origins.push(body.subtitle_origin);
      return body.subtitle_origin === "uploader_provided" ? new Response(JSON.stringify({ results: [{ status_code: 200, content: {} }] }))
        : new Response(JSON.stringify({ content: { auto_generated: { en: track("Auto fallback") } } }));
    }));
    expect((await extractVideo("fXDc02qHAhY")).transcript).toBe("Auto fallback");
    expect(origins).toEqual(["uploader_provided", "auto_generated"]);
  });
  it("uses no Decodo calls when direct captions and metadata succeed", async () => {
    vi.stubEnv("DECODO_API_KEY", "");
    const request = vi.fn(async (url: unknown) => String(url).includes("/watch?")
      ? new Response('var ytInitialPlayerResponse = ' + JSON.stringify({ videoDetails: { title: "Direct", viewCount: "0", lengthSeconds: "30" }, microformat: { playerMicroformatRenderer: { publishDate: "2026-10-01" } }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?v=fXDc02qHAhY" }] } } }) + ';')
      : new Response(JSON.stringify(track("Direct speech"))));
    vi.stubGlobal("fetch", request);
    const result = await extractVideo("fXDc02qHAhY");
    expect(result.transcript).toBe("Direct speech");
    expect(result.views).toBe(0);
    expect(result.route).toBe("youtube_direct");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("makes one Decodo call for an identified auto track and skips complete known metadata", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/watch?")) return new Response('var ytInitialPlayerResponse = ' + JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ kind: "asr", languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext" }] } } }) + ';');
      if (String(url).includes("/timedtext")) return new Response("");
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ content: { auto_generated: { en: track("Fallback") } } }));
    }));
    const result = await extractVideo("fXDc02qHAhY", { title: "Known", views: 0, durationSeconds: 30, publishDate: "2026-10-01" });
    expect(result.transcript).toBe("Fallback");
    expect(bodies).toEqual([{ target: "youtube_subtitles", query: "fXDc02qHAhY", language_code: "en", subtitle_origin: "auto_generated" }]);
    expect(result.viewsFetched).toBe(false);
  });
  it("only requests missing metadata when direct captions succeed", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    const bodies: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/watch?")) return new Response('var ytInitialPlayerResponse = ' + JSON.stringify({ captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext" }] } } }) + ';');
      if (String(url).includes("/timedtext")) return new Response(JSON.stringify(track("Keep captions")));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ content: { title: "Fetched", view_count: 7, duration: 30, upload_date: "20261001" } }));
    }));
    const result = await extractVideo("fXDc02qHAhY");
    expect(result.transcript).toBe("Keep captions");
    expect(result.publishDate).toBe("2026-10-01");
    expect(bodies.map((b) => b.target)).toEqual(["youtube_metadata"]);
  });
  it("surfaces upstream failures even when Decodo HTTP status is 200", async () => {
    vi.stubEnv("DECODO_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [{ status_code: 503, content: {} }] }))));
    await expect(extractVideo("fXDc02qHAhY")).rejects.toThrow("upstream HTTP 503");
  });
});