// Keyless YouTube extractor. Pure fetch — safe for the Worker runtime.
// Discovery: channel /videos tab (ytInitialData) + innertube browse continuations, RSS feed as cross-check.
// Metadata: innertube WEB player (microformat). Captions: innertube ANDROID player -> timedtext XML.
import { parseCaptionXml, type Cue } from "./captions";
import { isKnownPage } from "./collections";
import { decodoEnabled, decodoMetadata, decodoSubtitles } from "./decodo.server";
import type { HeatMoment } from "./analysis";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const WEB_VERSION_FALLBACK = "2.20261001.01.00";
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "US" };
const IOS_CLIENT = { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" };
const IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

export type DiscoveredVideo = { id: string; title: string; durationSeconds?: number | null; views?: number | null; publishDate?: string | null };

/** YouTube refused to serve this video to our server. Carries whatever metadata did come through. */
export class BotCheckError extends Error {
  constructor(reason: string, public partial: VideoResult) {
    super(`BOT_CHECK: ${reason}`);
  }
}

const BLOCK_STATUSES = new Set(["LOGIN_REQUIRED", "AGE_CHECK_REQUIRED", "CONTENT_CHECK_REQUIRED"]);
const BLOCK_MESSAGE = /not a bot|sign in|log ?in|confirm your age|age[- ]restricted|unusual traffic|captcha/i;

/** Explicit status/message for a YouTube access wall (login, bot check, age gate), or null. */
export function accessBlock(responses: any[]): string | null {
  for (const p of responses) {
    const status = String(p?.playabilityStatus?.status ?? "");
    const reason = String(p?.playabilityStatus?.reason ?? p?.playabilityStatus?.messages?.join(" ") ?? "");
    if (BLOCK_STATUSES.has(status) || BLOCK_MESSAGE.test(reason)) return `${status || "BLOCKED"}${reason ? `: ${reason}` : ""}`;
  }
  return null;
}

/** "1:02:03" / "12:34" -> seconds. */
export function parseDuration(s: string | null | undefined): number | null {
  const m = (s ?? "").trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
}

/** "1,234 views" / "1.2K views" / "No views" -> number. */
export function parseViews(s: string | null | undefined): number | null {
  const t = (s ?? "").trim();
  if (/^no views/i.test(t)) return 0;
  const m = t.match(/^([\d.,]+)\s*([KMB])?\s*(views?)?$/i);
  if (!m) return null;
  const n = Number((m[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

function stringsIn(node: any, out: string[] = [], depth = 0): string[] {
  if (depth > 30 || node == null) return out;
  if (typeof node === "string") { out.push(node); return out; }
  if (Array.isArray(node)) { for (const x of node) stringsIn(x, out, depth + 1); return out; }
  if (typeof node === "object") for (const k of Object.keys(node)) {
    if (k === "text" || k === "content" || k === "simpleText" || typeof node[k] === "object") stringsIn(node[k], out, depth + 1);
  }
  return out;
}
export type ChannelInfo = { channelId: string; title: string; handle: string | null; thumbnail: string | null };
export type VideoResult = {
  id: string;
  title: string;
  publishDate: string | null;
  views: number | null;
  durationSeconds: number | null;
  isShort: boolean;
  status: "ok" | "no_captions" | "unavailable";
  captionLang: string | null;
  transcript: string | null;
  cues?: Cue[];
  statusDetail: string | null;
  /** Which extraction path produced this result (for pipeline logs). */
  route?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with exponential backoff + jitter on 429/5xx and network errors. */
export async function fetchRetry(url: string, init: RequestInit = {}, attempts = 5): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(init.headers || {}) },
      });
      if (res.status !== 429 && res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
      const ra = Number(res.headers.get("retry-after"));
      await res.body?.cancel();
      await sleep(ra > 0 ? ra * 1000 : Math.min(16000, 500 * 2 ** i) + Math.random() * 400);
    } catch (e) {
      lastErr = e;
      await sleep(Math.min(16000, 500 * 2 ** i) + Math.random() * 400);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function extractJsonAfter(html: string, marker: string): any | null {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf("{", i);
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
    }
  }
  return null;
}

function* walk(o: any, key: string): Generator<any> {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { for (const x of o) yield* walk(x, key); return; }
  for (const k in o) {
    if (k === key) yield o[k];
    yield* walk(o[k], key);
  }
}

const textOf = (t: any): string => t?.simpleText ?? (t?.runs || []).map((r: any) => r.text).join("") ?? t?.content ?? "";

/** Public replay intensity is not audience retention. Never invent missing markers. */
export function parseVideoSignals(html: string): { heatMoments: HeatMoment[]; chapters: { startS: number; title: string }[] } {
  const data = extractJsonAfter(html, "var ytInitialData") ?? extractJsonAfter(html, 'window["ytInitialData"]') ?? extractJsonAfter(html, "ytInitialData =");
  const heat = new Map<number, HeatMoment>();
  for (const list of walk(data, "markersList")) {
    if (list?.markerType !== "MARKER_TYPE_HEATMAP") continue;
    for (const marker of list.markers ?? []) {
      const startMs = Number(marker.startMillis), intensity = Number(marker.intensityScoreNormalized);
      if (Number.isFinite(startMs) && startMs >= 0 && Number.isFinite(intensity) && intensity >= 0 && intensity <= 1) heat.set(startMs, { startMs, intensity });
    }
  }
  // Older watch-page payloads use heatMarkerRenderer instead.
  for (const marker of walk(data, "heatMarkerRenderer")) {
    const startMs = Number(marker.timeRangeStartMillis), intensity = Number(marker.heatMarkerIntensityScoreNormalized);
    if (Number.isFinite(startMs) && startMs >= 0 && Number.isFinite(intensity) && intensity >= 0 && intensity <= 1) heat.set(startMs, { startMs, intensity });
  }
  const chapters = new Map<number, { startS: number; title: string }>();
  for (const chapter of walk(data, "chapterRenderer")) {
    const startS = Number(chapter.timeRangeStartMillis) / 1000, title = textOf(chapter.title);
    if (Number.isFinite(startS) && startS >= 0 && title) chapters.set(startS, { startS, title });
  }
  for (const list of walk(data, "macroMarkersListRenderer")) {
    for (const item of list?.contents ?? []) {
      const marker = item.macroMarkersListItemRenderer;
      const startS = Number(marker?.onTap?.watchEndpoint?.startTimeSeconds), title = textOf(marker?.title);
      if (Number.isFinite(startS) && startS >= 0 && title) chapters.set(startS, { startS, title });
    }
  }
  return { heatMoments: [...heat.values()].sort((a, b) => a.startMs - b.startMs).slice(0, 200), chapters: [...chapters.values()].sort((a, b) => a.startS - b.startS).slice(0, 200) };
}

export async function extractVideoSignals(videoId: string) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1" }, signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) { await response.body?.cancel(); return { heatMoments: [], chapters: [] }; }
    return parseVideoSignals(await response.text());
  } catch { return { heatMoments: [], chapters: [] }; }
}

export type ParsedInput = { kind: "video"; videoId: string } | { kind: "channel"; url: string } | { kind: "playlist"; url: string; playlistId: string };

export function parseInput(raw: string): ParsedInput {
  const s = raw.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return { kind: "video", videoId: s };
  if (/^UC[A-Za-z0-9_-]{22}$/.test(s)) return { kind: "channel", url: `https://www.youtube.com/channel/${s}` };
  if (/^@[\w.-]+$/.test(s)) return { kind: "channel", url: `https://www.youtube.com/${s}` };
  let u: URL;
  try { u = new URL(s.startsWith("http") ? s : `https://${s}`); } catch { throw new Error("That doesn't look like a YouTube link."); }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1, 12);
    if (id.length === 11) return { kind: "video", videoId: id };
  }
  if (host !== "youtube.com") throw new Error("Only youtube.com links are supported.");
  const playlistId = u.searchParams.get("list");
  if (playlistId && /^[\w-]{10,150}$/.test(playlistId)) return { kind: "playlist", playlistId, url: `https://www.youtube.com/playlist?list=${playlistId}` };
  const v = u.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { kind: "video", videoId: v };
  const m = u.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
  if (m) return { kind: "video", videoId: m[2] ?? "" };
  const c = u.pathname.match(/^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)/);
  if (c) return { kind: "channel", url: `https://www.youtube.com/${decodeURIComponent(c[1] ?? "")}` };
  throw new Error("Paste a channel URL (youtube.com/@name) or a video URL.");
}

/** Discover every long-form video on a channel's Videos tab (Shorts live on a separate tab and are excluded). */
export async function discoverChannel(channelUrl: string, maxPages = 200, known: ReadonlySet<string> = new Set()): Promise<{ channel: ChannelInfo; videos: DiscoveredVideo[] }> {
  const res = await fetchRetry(`${channelUrl.replace(/\/$/, "")}/videos?hl=en`, { headers: { Cookie: "CONSENT=YES+1" } });
  if (res.status === 404) throw new Error("Channel not found.");
  const html = await res.text();
  const data = extractJsonAfter(html, "var ytInitialData") ?? extractJsonAfter(html, 'window["ytInitialData"]');
  if (!data) throw new Error("Couldn't read the channel page.");
  const meta = data.metadata?.channelMetadataRenderer ?? {};
  const channelId: string = meta.externalId ?? html.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
  if (!channelId) throw new Error("Couldn't identify the channel.");
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? WEB_VERSION_FALLBACK;
  const channel: ChannelInfo = {
    channelId,
    title: meta.title ?? "Unknown channel",
    handle: (meta.vanityChannelUrl as string | undefined)?.split("/").pop() ?? null,
    thumbnail: meta.avatar?.thumbnails?.at(-1)?.url ?? null,
  };

  const seen = new Map<string, DiscoveredVideo>();
  const collect = (node: any): string | null => {
    for (const v of walk(node, "videoRenderer")) {
      if (v?.videoId && !seen.has(v.videoId)) {
        seen.set(v.videoId, {
          id: v.videoId, title: textOf(v.title),
          durationSeconds: parseDuration(textOf(v.lengthText)),
          views: parseViews(textOf(v.viewCountText)),
        });
      }
    }
    // Newer lockupViewModel layout: duration sits in a thumbnail badge, views in a metadata row.
    for (const l of walk(node, "lockupViewModel")) {
      const id = l?.contentId;
      if (id && l.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && !seen.has(id)) {
        const title = l?.metadata?.lockupMetadataViewModel?.title?.content ?? "";
        const strings = stringsIn(l).filter((s) => s !== title);
        const dur = strings.map(parseDuration).find((n) => n != null) ?? null;
        const views = strings.filter((s) => /views?$/i.test(s) || /^[\d.,]+\s*[KMB]?$/i.test(s.trim())).map(parseViews).find((n) => n != null) ?? null;
        seen.set(id, { id, title, durationSeconds: dur, views });
      }
    }
    let token: string | null = null;
    for (const c of walk(node, "continuationItemRenderer")) {
      const t = c?.continuationEndpoint?.continuationCommand?.token;
      if (t) token = t;
    }
    return token;
  };

  // Only parse the selected (Videos) tab, not sidebars.
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  const selected = tabs.find((t: any) => t.tabRenderer?.selected) ?? data;
  let token = collect(selected);
  let pages = 0;
  while (token && pages++ < maxPages && !isKnownPage([...seen.keys()], known)) {
    const r = await fetchRetry(`https://www.youtube.com/youtubei/v1/browse?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } }, continuation: token }),
    });
    if (!r.ok) throw new Error(`Discovery HTTP ${r.status}`);
    const j = await r.json();
    token = collect(j.onResponseReceivedActions ?? j);
    await sleep(150 + Math.random() * 150);
  }

  if (token && pages >= maxPages) throw new Error("Discovery page limit reached; please retry.");

  // Cross-check with RSS feed (latest 15) so freshly published videos are never missed.
  try {
    const f = await fetchRetry(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (f.ok) {
      const xml = await f.text();
      for (const e of xml.split("<entry>").slice(1)) {
        const id = e.match(/<yt:videoId>([^<]+)</)?.[1];
        const link = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? "";
        if (!id || link.includes("/shorts/")) continue;
        const publishDate = e.match(/<published>([^<]+)</)?.[1] ?? null;
        const v = e.match(/<media:statistics views="(\d+)"/)?.[1];
        const prev = seen.get(id);
        seen.set(id, {
          id,
          title: prev?.title || decodeXml(e.match(/<title>([^<]*)</)?.[1] ?? ""),
          durationSeconds: prev?.durationSeconds ?? null,
          views: v != null ? Number(v) : prev?.views ?? null, // feed views are exact
          publishDate,
        });
      }
    }
  } catch { /* feed is best-effort */ }

  return { channel, videos: [...seen.values()] };
}

function decodeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}


async function player(videoId: string, client: Record<string, unknown>, ua?: string) {
  const r = await fetchRetry("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(ua ? { "User-Agent": ua } : {}) },
    body: JSON.stringify({ videoId, context: { client }, contentCheckOk: true, racyCheckOk: true }),
  });
  if (!r.ok) throw new Error(`player HTTP ${r.status}`);
  return r.json() as Promise<any>;
}

/** Fetch metadata + English transcript for one video. Falls back to Decodo (if configured) when YouTube blocks us. */
export async function extractVideo(videoId: string, knownTitle?: string | null): Promise<VideoResult> {
  try {
    return { ...(await extractDirect(videoId, knownTitle)), route: "youtube_direct" };
  } catch (e) {
    if (!decodoEnabled()) throw e;
    const partial: VideoResult = e instanceof BotCheckError ? e.partial : {
      id: videoId, title: knownTitle ?? "", publishDate: null, views: null, durationSeconds: null,
      isShort: false, status: "no_captions", captionLang: null, transcript: null, statusDetail: null,
    };
    try {
      const [meta, subs] = await Promise.all([
        partial.title && partial.views != null && partial.durationSeconds != null ? null : decodoMetadata(videoId).catch(() => null),
        decodoSubtitles(videoId),
      ]);
      const base: VideoResult = {
        ...partial,
        title: partial.title || meta?.title || knownTitle || "",
        views: partial.views ?? meta?.views ?? null,
        durationSeconds: partial.durationSeconds ?? meta?.durationSeconds ?? null,
        publishDate: partial.publishDate ?? meta?.publishDate ?? null,
      };
      const route = meta ? "decodo_subtitles+metadata" : "decodo_subtitles";
      if (!subs) return { ...base, route, status: "no_captions", statusDetail: "No English subtitles available" };
      return { ...base, route, status: "ok", captionLang: subs.lang, transcript: subs.transcript, cues: subs.cues, statusDetail: null };
    } catch {
      throw e; // keep original (retryable) error
    }
  }
}

async function extractDirect(videoId: string, knownTitle?: string | null): Promise<VideoResult> {
  const [web, first] = await Promise.all([
    player(videoId, { clientName: "WEB", clientVersion: WEB_VERSION_FALLBACK, hl: "en", gl: "US" }).catch(() => null),
    player(videoId, ANDROID_CLIENT, "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip").catch(() => null),
  ]);
  let android = first;
  const hasTracks = (p: any) => (p?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).length > 0;
  if (!hasTracks(android)) {
    const ios = await player(videoId, IOS_CLIENT, IOS_UA).catch(() => null);
    if (ios && (hasTracks(ios) || !android?.videoDetails)) android = ios;
  }
  const vd = android?.videoDetails ?? web?.videoDetails ?? {};
  const mf = web?.microformat?.playerMicroformatRenderer ?? {};
  const base: VideoResult = {
    id: videoId,
    title: vd.title || textOf(mf.title) || knownTitle || "",
    publishDate: mf.publishDate ?? mf.uploadDate ?? null,
    views: vd.viewCount != null ? Number(vd.viewCount) : mf.viewCount != null ? Number(mf.viewCount) : null,
    durationSeconds: vd.lengthSeconds != null ? Number(vd.lengthSeconds) : mf.lengthSeconds != null ? Number(mf.lengthSeconds) : null,
    isShort: false,
    status: "no_captions",
    captionLang: null,
    transcript: null,
    statusDetail: null,
  };
  const blocked = accessBlock([android, web]);
  if (!vd.videoId && !mf.title) {
    const reason = android?.playabilityStatus?.reason ?? web?.playabilityStatus?.reason ?? "Video unavailable";
    if (blocked || (!android && !web)) throw new BotCheckError(blocked ?? reason, base);
    return { ...base, status: "unavailable", statusDetail: reason };
  }
  const tracks: any[] = android?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    // A login/bot wall hides caption tracks; it is not proof that captions don't exist.
    if (blocked) throw new BotCheckError(blocked, base);
    const s = android?.playabilityStatus?.status;
    const reason = android?.playabilityStatus?.reason ?? "";
    return { ...base, statusDetail: s && s !== "OK" ? reason || s : "No captions available" };
  }
  // English only: creator-uploaded English first, then auto-generated English. Other languages are ignored.
  const english = tracks.filter((t) => /^en\b|^en-/i.test(String(t.languageCode)));
  if (!english.length) return { ...base, statusDetail: "No English subtitles available" };
  const track = english.find((t) => t.kind !== "asr") ?? english[0];
  try {
    const r = await fetchRetry(track.baseUrl.replace(/&fmt=[^&]*/, ""));
    const xml = await r.text();
    const { transcript: text, cues } = parseCaptionXml(xml);
    if (!text) return { ...base, statusDetail: "Caption track was empty" };
    return { ...base, status: "ok", captionLang: "en" + (track.kind === "asr" ? " (auto)" : ""), transcript: text, cues };
  } catch (e) {
    throw new Error(`Caption download failed: ${(e as Error).message}`);
  }
}

/** Run tasks with a fixed concurrency pool (Worker outbound cap is 6). */
export async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx] as T);
      }
    }),
  );
  return out;
}

// ---------- Stage 1 (optional): official YouTube Data API discovery ----------
// Used only when YOUTUBE_API_KEY is configured; otherwise the keyless discovery above runs.
// Uses the "UULF" playlist (long-form uploads only), so Shorts and live streams stay excluded.

function isoDuration(s: string | undefined): number | null {
  const m = (s ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
}

async function dataApi(path: string, params: Record<string, string>, key: string): Promise<any> {
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetchRetry(`https://www.googleapis.com/youtube/v3/${path}?${qs}`, {}, 3);
  if (!r.ok) throw new Error(`YouTube Data API ${path} HTTP ${r.status}`);
  return r.json();
}

export async function discoverChannelViaApi(channelUrl: string, key: string, known: ReadonlySet<string> = new Set()): Promise<{ channel: ChannelInfo; videos: DiscoveredVideo[] }> {
  const path = new URL(channelUrl).pathname;
  const params: Record<string, string> = { part: "snippet,contentDetails" };
  const id = path.match(/channel\/(UC[\w-]{22})/)?.[1];
  const handle = path.match(/^\/(@[^/]+)/)?.[1];
  const user = path.match(/^\/user\/([^/]+)/)?.[1];
  if (id) params['id'] = id; else if (handle) params['forHandle'] = handle; else if (user) params['forUsername'] = user;
  else throw new Error("Unsupported channel URL for API discovery");
  const ch = (await dataApi("channels", params, key)).items?.[0];
  if (!ch) throw new Error("Channel not found.");
  const channelId: string = ch.id;
  const channel: ChannelInfo = {
    channelId,
    title: ch.snippet?.title ?? "Unknown channel",
    handle: ch.snippet?.customUrl ?? null,
    thumbnail: ch.snippet?.thumbnails?.high?.url ?? ch.snippet?.thumbnails?.default?.url ?? null,
  };

  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 100; i++) {
    const p: Record<string, string> = { part: "contentDetails", playlistId: `UULF${channelId.slice(2)}`, maxResults: "50" };
    if (pageToken) p['pageToken'] = pageToken;
    let j: any;
    j = await dataApi("playlistItems", p, key);
    for (const it of j.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = j.nextPageToken;
    if (!pageToken || isKnownPage((j.items ?? []).map((it: any) => it.contentDetails?.videoId).filter(Boolean), known)) { pageToken = undefined; break; }
  }

  if (pageToken) throw new Error("Discovery page limit reached.");
  const videos: DiscoveredVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await dataApi("videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: "50" }, key);
    const byId = new Map<string, any>((j.items ?? []).map((v: any) => [v.id, v]));
    for (const vid of ids.slice(i, i + 50)) {
      const v = byId.get(vid);
      videos.push({
        id: vid,
        title: v?.snippet?.title ?? "",
        publishDate: v?.snippet?.publishedAt ?? null,
        durationSeconds: isoDuration(v?.contentDetails?.duration),
        views: v?.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
      });
    }
  }
  return { channel, videos };
}

/** Playlist membership is separate from a video's original channel. */
export async function discoverPlaylist(playlistId: string, key?: string) {
  const collectionId = `PL:${playlistId}`;
  const seen = new Map<string, DiscoveredVideo>();
  let title = "YouTube playlist";
  if (key) {
    const meta = await dataApi("playlists", { part: "snippet", id: playlistId }, key);
    if (!meta.items?.length) throw new Error("Playlist not found or private.");
    title = meta.items[0].snippet?.title ?? title;
    let token: string | undefined;
    for (let page = 0; page < 200; page++) {
      const result = await dataApi("playlistItems", { part: "snippet,contentDetails", playlistId, maxResults: "50", ...(token ? { pageToken: token } : {}) }, key);
      for (const item of result.items ?? []) {
        const id = item.contentDetails?.videoId;
        if (id) seen.set(id, { id, title: item.snippet?.title ?? "" });
      }
      token = result.nextPageToken;
      if (!token) break;
      if (page === 199) throw new Error("Playlist page limit reached.");
    }
  } else {
    const response = await fetchRetry(`https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}&hl=en`);
    const html = await response.text();
    const data = extractJsonAfter(html, "var ytInitialData") ?? extractJsonAfter(html, 'window["ytInitialData"]');
    if (!data) throw new Error("Could not read playlist; it may be private.");
    title = textOf(data.header?.playlistHeaderRenderer?.title) || data.metadata?.playlistMetadataRenderer?.title || title;
    const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? WEB_VERSION_FALLBACK;
    const collect = (node: any) => {
      for (const video of walk(node, "playlistVideoRenderer")) {
        if (video.videoId && !video.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url?.includes("/shorts/"))
          seen.set(video.videoId, { id: video.videoId, title: textOf(video.title), durationSeconds: parseDuration(textOf(video.lengthText)) });
      }
      for (const item of walk(node, "continuationItemRenderer")) {
        const token = item.continuationEndpoint?.continuationCommand?.token;
        if (token) return token as string;
      }
      return null;
    };
    let token = collect(data.contents);
    for (let page = 0; token && page < 200; page++) {
      const response = await fetchRetry("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: version, hl: "en", gl: "US" } }, continuation: token }),
      });
      if (!response.ok) throw new Error(`Playlist discovery HTTP ${response.status}`);
      token = collect(await response.json());
      if (page === 199 && token) throw new Error("Playlist page limit reached.");
    }
  }
  if (!seen.size) throw new Error("No public videos found in this playlist.");
  return { channel: { channelId: collectionId, title, handle: null, thumbnail: null } as ChannelInfo, videos: [...seen.values()] };
}
