export { formatTimestamp } from "./captions";
export type Row = {
  id: string;
  title: string;
  publish_date: string | null;
  views: number | null;
  duration_seconds: number | null;
  status: string;
  status_detail: string | null;
  caption_lang: string | null;
  word_count: number;
  transcript?: string | null;
};

export const STATUS_LABEL: Record<string, string> = {
  ok: "Transcript",
  no_captions: "No captions available",
  unavailable: "Video unavailable",
  failed: "Failed after 3 tries",
  pending: "Pending",
};

export function fmtDuration(s: number | null) {
  if (s == null || !Number.isFinite(s)) return "—";
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
}

const record = (r: Row) => ({
  video_id: r.id,
  url: `https://www.youtube.com/watch?v=${r.id}`,
  title: r.title,
  publish_date: r.publish_date?.slice(0, 10) ?? "",
  views: r.views ?? "",
  duration: fmtDuration(r.duration_seconds),
  duration_seconds: r.duration_seconds ?? "",
  status: STATUS_LABEL[r.status] ?? r.status,
  caption_language: r.caption_lang ?? "",
  transcript: r.transcript ?? "",
});

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(rows: Row[]) {
  const recs = rows.map(record);
  const keys = Object.keys(recs[0] ?? record({ id: "", title: "", publish_date: null, views: null, duration_seconds: null, status: "", status_detail: null, caption_lang: null, word_count: 0 }));
  return "\uFEFF" + [keys.join(","), ...recs.map((r) => keys.map((k) => csvCell((r as any)[k])).join(","))].join("\r\n");
}

export const toJSON = (rows: Row[]) => JSON.stringify(rows.map(record), null, 2);

export function toMarkdown(rows: Row[], heading: string) {
  const out = [`# ${heading}`, "", `${rows.length} videos`, ""];
  for (const r of rows.map(record)) {
    out.push(`## [${r.title.replace(/[[\]]/g, "")}](${r.url})`, "");
    out.push(`- **Published:** ${r.publish_date || "—"}`, `- **Views:** ${r.views === "" ? "—" : Number(r.views).toLocaleString("en-US")}`, `- **Duration:** ${r.duration}`, `- **Status:** ${r.status}`, "");
    if (r.transcript) out.push(r.transcript, "");
    else out.push(`_${r.status}_`, "");
  }
  return out.join("\n");
}

export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
