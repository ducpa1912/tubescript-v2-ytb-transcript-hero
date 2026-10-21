import { normalizeCues, type Cue } from "./captions";
// Decodo is the primary caption source. Credentials stay server-side.

const ENDPOINT = "https://data.decodo.com/v1/scrape";

export const decodoEnabled = () => !!process.env["DECODO_API_KEY"];

async function scrape(target: string, query: string, extra: Record<string, unknown> = {}): Promise<any | null> {
  const key = process.env["DECODO_API_KEY"];
  if (!key) throw new Error("Decodo is not configured. Caption extraction requires DECODO_API_KEY.");
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ target, query, ...extra }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    if (r.status === 404 && target === "youtube_subtitles") return null;
    throw new Error(`Decodo ${target} HTTP ${r.status}`);
  }
  const j: any = await r.json();
  const result = j?.results?.[0];
  if (result?.status_code != null && Number(result.status_code) >= 400) {
    if (Number(result.status_code) === 404 && target === "youtube_subtitles") return null;
    throw new Error(`Decodo ${target} upstream HTTP ${result.status_code}`);
  }
  if (j?.error || result?.error) throw new Error(`Decodo ${target} could not complete extraction.`);
  let c = j?.results?.[0]?.content ?? j?.content ?? j;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { /* keep string */ } }
  return c;
}

function findArray(o: any, pred: (x: any) => boolean, depth = 0): any[] | null {
  if (!o || typeof o !== "object" || depth > 8) return null;
  if (Array.isArray(o)) {
    if (o.some(pred)) return o;
    for (const x of o) { const f = findArray(x, pred, depth + 1); if (f) return f; }
    return null;
  }
  for (const k in o) { const f = findArray(o[k], pred, depth + 1); if (f) return f; }
  return null;
}

/** English transcript via youtube_subtitles. Returns null when no English track is available. */
export async function decodoSubtitles(videoId: string): Promise<{ transcript: string; lang: string; cues: Cue[] } | null> {
  const uploaded = await scrape("youtube_subtitles", videoId, { language_code: "en", subtitle_origin: "uploader_provided" });
  const preferred = parseDecodoSubtitles(uploaded);
  if (preferred) return preferred;
  return parseDecodoSubtitles(await scrape("youtube_subtitles", videoId, { language_code: "en", subtitle_origin: "auto_generated" }));
}

/** Select an English creator track before auto tracks; window events need not contain text. */
export function parseDecodoSubtitles(c: any): { transcript: string; lang: string; cues: Cue[] } | null {
  if (!c) return null;
  const englishTrack = (tracks: any) => tracks && typeof tracks === "object"
    ? Object.entries(tracks).filter(([lang]) => /^en(?:$|[-_])/i.test(lang)).map(([, track]) => track) : [];
  const manual = englishTrack(c.uploader_provided ?? c.manual ?? c.manually_generated ?? c.subtitles ?? c.creator_uploaded);
  const automatic = englishTrack(c.auto_generated);
  const grouped = ["uploader_provided", "manual", "manually_generated", "subtitles", "creator_uploaded", "auto_generated"].some((key) => key in Object(c));
  const tracks = grouped ? [...manual.map((track) => ({ track, auto: false })), ...automatic.map((track) => ({ track, auto: true }))]
    : [{ track: c, auto: /asr|auto/i.test(String(c.kind ?? c.type ?? "")) }];
  for (const { track, auto } of tracks) {
  const lang = String(track?.language_code ?? track?.lang ?? "en");
  if (!/^en(?:$|[-_])/i.test(lang)) continue;
  const events = findArray(track, (x) => x && typeof x === "object" && Array.isArray(x.segs));
  let text = "";
  let cues: Cue[] = [];
  if (events) {
    const speech = events.filter((e: any) => Array.isArray(e.segs));
    cues = normalizeCues(speech.map((e: any) => ({ start: e.tStartMs / 1000, dur: e.dDurationMs / 1000, text: e.segs.map((s: any) => s.utf8 ?? "").join("") })));
    text = speech.map((e: any) => e.segs.map((s: any) => s.utf8 ?? "").join("")).join(" ");
  } else if (typeof track === "string") {
    text = track;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) continue;
  return { transcript: text, cues, lang: "en" + (auto ? " (auto)" : "") };
  }
  if (grouped || (c && typeof c === "object" && Array.isArray(c.events))) return null;
  throw new Error("Decodo returned an unrecognized caption response. Retry extraction.");
}

/** Exact title/views/duration/date via youtube_metadata. */
export async function decodoMetadata(videoId: string): Promise<{ title?: string | undefined; views?: number | undefined; durationSeconds?: number | undefined; publishDate?: string | undefined } | null> {
  const c = await scrape("youtube_metadata", videoId);
  if (!c || typeof c !== "object") return null;
  const d = String(c.upload_date ?? "");
  return {
    title: c.title || undefined,
    views: c.view_count != null ? Number(c.view_count) : undefined,
    durationSeconds: c.duration != null ? Number(c.duration) : undefined,
    publishDate: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d || undefined,
  };
}
