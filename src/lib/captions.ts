export type Cue = { start: number; dur: number; text: string };

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function normalizeCues(value: unknown): Cue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const start = Number(x.start), dur = Number(x.dur);
    return Number.isFinite(start) && start >= 0 && Number.isFinite(dur) && dur > 0 && typeof x.text === "string" && x.text.trim()
      ? [{ start, dur, text: x.text.trim() }] : [];
  }).sort((a, b) => a.start - b.start);
}

export function parseCaptionXml(xml: string): { transcript: string; cues: Cue[] } {
  const parts: string[] = [], cues: Cue[] = [];
  const re = /<(p|text)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[2] ?? "";
    const attr = (name: string) => attrs.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1];
    const text = decode(decode((m[3] ?? "").replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
    if (!text) continue;
    parts.push(text);
    const rawStart = attr(m[1] === "p" ? "t" : "start"), rawDur = attr(m[1] === "p" ? "d" : "dur");
    if (rawStart == null || rawDur == null) continue;
    const divisor = m[1] === "p" ? 1000 : 1;
    cues.push({ start: Number(rawStart) / divisor, dur: Number(rawDur) / divisor, text });
  }
  return { transcript: parts.join(" "), cues: normalizeCues(cues) };
}

export function subtitleTime(seconds: number, separator = ".") {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, length = 2) => String(n).padStart(length, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
}

export function toSubtitle(cues: Cue[], format: "srt" | "vtt" | "sbv") {
  const blocks = normalizeCues(cues).map((cue, i) => {
    const text = cue.text.replace(/-->/g, "→");
    if (format === "sbv") return `${subtitleTime(cue.start)},${subtitleTime(cue.start + cue.dur)}\n${text}`;
    const comma = format === "srt" ? "," : ".";
    return `${format === "srt" ? `${i + 1}\n` : ""}${subtitleTime(cue.start, comma)} --> ${subtitleTime(cue.start + cue.dur, comma)}\n${text}`;
  });
  return (format === "vtt" ? "WEBVTT\n\n" : "") + blocks.join("\n\n") + "\n";
}

export function refreshCharge(usedToday: number, credits: number) {
  if (usedToday < 10) return { freeUsed: 1, creditUsed: 0 };
  if (credits >= 1) return { freeUsed: 0, creditUsed: 1 };
  return null;
}