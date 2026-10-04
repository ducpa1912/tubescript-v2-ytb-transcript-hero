// Keyless YouTube extractor. Pure fetch — safe for the Worker runtime.
// Discovery: channel /videos tab (ytInitialData) + innertube browse continuations, RSS feed as cross-check.
// Metadata: innertube WEB player (microformat). Captions: innertube ANDROID player -> timedtext XML.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const WEB_VERSION_FALLBACK = "2.20261001.01.00";
const ANDROID_CLIENT = { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "US" };
const IOS_CLIENT = { clientName: "IOS", clientVersion: "20.10.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" };
const IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

export type DiscoveredVideo = { id: string; title: string; durationSeconds?: number | null; views?: number | null };

/** YouTube refused to serve this video to our server. Carries whatever metadata did come through. */
export class BotCheckError extends Error {
  constructor(reason: string, public partial: VideoResult) {
    super(`BOT_CHECK: ${reason}`);
  }
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
  const m = t.match(/^([\d.,]+)\s*([KMB])?\s*views?/i);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

function stringsIn(node: any, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || node == null) return out;
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
  statusDetail: string | null;
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

export type ParsedInput = { kind: "video"; videoId: string } | { kind: "channel"; url: string };

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
  if (!host.endsWith("youtube.com")) throw new Error("Only youtube.com links are supported.");
  const v = u.searchParams.get("v");
  if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return { kind: "video", videoId: v };
  const m = u.pathname.match(/^\/(shorts|live|embed)\/([A-Za-z0-9_-]{11})/);
  if (m) return { kind: "video", videoId: m[2]! };
  const c = u.pathname.match(/^\/(@[^/]+|channel\/UC[\w-]{22}|c\/[^/]+|user\/[^/]+)/);
  if (c) return { kind: "channel", url: `https://www.youtube.com/${decodeURIComponent(c[1]!)}` };
  throw new Error("Paste a channel URL (youtube.com/@name) or a video URL.");
}

/** Discover every long-form video on a channel's Videos tab (Shorts live on a separate tab and are excluded). */
export async function discoverChannel(channelUrl: string, maxPages = 200): Promise<{ channel: ChannelInfo; videos: DiscoveredVideo[] }> {
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
        const strings = stringsIn(l);
        const dur = strings.map(parseDuration).find((n) => n != null) ?? null;
        const views = strings.filter((s) => /views?$/i.test(s)).map(parseViews).find((n) => n != null) ?? null;
        seen.set(id, { id, title: l?.metadata?.lockupMetadataViewModel?.title?.content ?? "", durationSeconds: dur, views });
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
  while (token && pages++ < maxPages) {
    const r = await fetchRetry(`https://www.youtube.com/youtubei/v1/browse?prettyPrint=false${apiKey ? `&key=${apiKey}` : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } }, continuation: token }),
    });
    if (!r.ok) break;
    const j = await r.json();
    token = collect(j.onResponseReceivedActions ?? j);
    await sleep(150 + Math.random() * 150);
  }

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

function parseTimedText(xml: string): string {
  const parts: string[] = [];
  // format 3: <p t=".." d=".."> possibly with <s> children; legacy: <text start=..>
  const re = /<(p|text)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    let t = (m[2] ?? "").replace(/<[^>]+>/g, "");
    t = decodeXml(decodeXml(t)).replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  }
  return parts.join(" ");
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

/** Fetch metadata + full transcript for one video. Never throws for missing captions. */
export async function extractVideo(videoId: string, knownTitle?: string | null): Promise<VideoResult> {
  const [web, first] = await Promise.all([
    player(videoId, { clientName: "WEB", clientVersion: WEB_VERSION_FALLBACK, hl: "en", gl: "US" }).catch(() => null),
    player(videoId, ANDROID_CLIENT, "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip").catch(() => null),
  ]);
  // Fall back to the iOS client when Android is bot-checked or returns no caption tracks.
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
  if (!vd.videoId && !mf.title) {
    const reason = android?.playabilityStatus?.reason ?? web?.playabilityStatus?.reason ?? "Video unavailable";
    // YouTube blocking our server is temporary — retry later instead of marking the video unavailable.
    if (/not a bot|sign in to confirm/i.test(reason) || (!android && !web)) throw new BotCheckError(reason, base);
    return { ...base, status: "unavailable", statusDetail: reason };
  }
  const tracks: any[] = android?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) {
    const s = android?.playabilityStatus?.status;
    const reason = android?.playabilityStatus?.reason ?? "";
    // Metadata may have come through even though captions were blocked — hand it back so it's kept.
    if (/not a bot|sign in to confirm/i.test(reason)) throw new BotCheckError(reason, base);
    return { ...base, statusDetail: s && s !== "OK" ? reason || s : "No captions available" };
  }
  // Prefer: manual English > auto English > manual any > auto any
  const score = (t: any) => (t.kind === "asr" ? 0 : 2) + (String(t.languageCode).startsWith("en") ? 4 : 0);
  const track = [...tracks].sort((a, b) => score(b) - score(a))[0];
  try {
    const r = await fetchRetry(track.baseUrl.replace(/&fmt=[^&]*/, ""));
    const xml = await r.text();
    const text = parseTimedText(xml);
    if (!text) return { ...base, statusDetail: "Caption track was empty" };
    return { ...base, status: "ok", captionLang: track.languageCode + (track.kind === "asr" ? " (auto)" : ""), transcript: text };
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
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}
