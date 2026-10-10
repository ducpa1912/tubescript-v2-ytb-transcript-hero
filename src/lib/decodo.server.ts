// Decodo Web Data API fallback (https://data.decodo.com/v1/scrape). Used only when DECODO_API_KEY is set
// and YouTube blocks our direct requests. Responses are parsed defensively: payload shapes vary by target.

const ENDPOINT = "https://data.decodo.com/v1/scrape";

export const decodoEnabled = () => !!process.env["DECODO_API_KEY"];

async function scrape(target: string, query: string, extra: Record<string, unknown> = {}): Promise<any | null> {
  const key = process.env["DECODO_API_KEY"];
  if (!key) return null;
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ target, query, ...extra }),
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`Decodo ${target} HTTP ${r.status}`);
  }
  const j: any = await r.json();
  let c = j?.results?.[0]?.content ?? j?.content ?? j;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { /* keep string */ } }
  return c;
}

function findArray(o: any, pred: (x: any) => boolean, depth = 0): any[] | null {
  if (!o || typeof o !== "object" || depth > 8) return null;
  if (Array.isArray(o)) {
    if (o.length && pred(o[0])) return o;
    for (const x of o) { const f = findArray(x, pred, depth + 1); if (f) return f; }
    return null;
  }
  for (const k in o) { const f = findArray(o[k], pred, depth + 1); if (f) return f; }
  return null;
}

/** English transcript via youtube_subtitles. Returns null when no English track is available. */
export async function decodoSubtitles(videoId: string): Promise<{ transcript: string; lang: string } | null> {
  const c = await scrape("youtube_subtitles", videoId, { language_code: "en" });
  if (!c) return null;
  const lang = String(c.language_code ?? c.lang ?? "en");
  if (!/^en/i.test(lang)) return null;
  const events = findArray(c, (x) => x && typeof x === "object" && Array.isArray(x.segs));
  let text = "";
  if (events) {
    text = events.map((e: any) => e.segs.map((s: any) => s.utf8 ?? "").join("")).join(" ");
  } else if (typeof c === "string") {
    text = c;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const auto = /asr|auto/i.test(String(c.kind ?? c.type ?? ""));
  return { transcript: text, lang: "en" + (auto ? " (auto)" : "") };
}

/** Exact title/views/duration/date via youtube_metadata. */
export async function decodoMetadata(videoId: string): Promise<{ title?: string; views?: number; durationSeconds?: number; publishDate?: string } | null> {
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
