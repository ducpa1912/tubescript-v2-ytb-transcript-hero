import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverPlaylist, parseInput } from "../lib/youtube.server";

afterEach(() => vi.unstubAllGlobals());
describe("playlist discovery", () => {
  it("uses list= as the collection even on watch URLs", () => {
    expect(parseInput("https://www.youtube.com/watch?v=PRDtEyC5X1U&list=PLabcdefghijk")).toEqual({ kind: "playlist", playlistId: "PLabcdefghijk", url: "https://www.youtube.com/playlist?list=PLabcdefghijk" });
  });
  it("rejects lookalike YouTube hosts", () => expect(() => parseInput("https://evilyoutube.com/playlist?list=PLabcdefghijk")).toThrow());
  it("follows keyless playlist continuations and deduplicates videos", async () => {
    const video = (id: string) => ({ playlistVideoRenderer: { videoId: id, title: { simpleText: id }, lengthText: { simpleText: "10:30" } } });
    const continuation = { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "next" } } } };
    const data = { metadata: { playlistMetadataRenderer: { title: "My playlist" } }, contents: { items: [video("PRDtEyC5X1U"), continuation] } };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(`var ytInitialData = ${JSON.stringify(data)};`))
      .mockResolvedValueOnce(Response.json({ items: [video("PRDtEyC5X1U"), video("Ph0X2obck4w")] }));
    vi.stubGlobal("fetch", fetch);
    const result = await discoverPlaylist("PLabcdefghijk");
    expect(result.channel.channelId).toBe("PL:PLabcdefghijk");
    expect(result.videos.map((v) => v.id)).toEqual(["PRDtEyC5X1U", "Ph0X2obck4w"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not silently accept a failed continuation", async () => {
    const data = { contents: { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: "next" } } } } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(`var ytInitialData = ${JSON.stringify(data)};`)).mockResolvedValueOnce(new Response("", { status: 403 })));
    await expect(discoverPlaylist("PLabcdefghijk")).rejects.toThrow("Playlist discovery HTTP 403");
  });
});