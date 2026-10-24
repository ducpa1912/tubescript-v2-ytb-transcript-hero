/** Intent & Approach search: matches the Read analysis (intent, thesis, hook, tone, structure, models, claims), never the transcript. */
export function intentText(result: unknown): string {
  let r: any = result;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { return r.toLowerCase(); } }
  if (!r || typeof r !== "object") return "";
  const parts: unknown[] = [r.intent, r.thesis, r.summary, r.cta, r.hook?.prose, r.tone?.primary, r.tone?.arc, r.mood?.primary, r.delivery,
    ...(r.structure ?? []).flatMap((s: any) => [s?.label, s?.explanation]),
    ...(r.mentalModels ?? []), ...(r.claims ?? []).map((c: any) => c?.claim),
    ...(r.keyMoments ?? []).flatMap((k: any) => [k?.label, k?.why])];
  return parts.filter((p) => typeof p === "string" && p).join(" \u2022 ").toLowerCase();
}
/** Every word of the query must appear; returns a short snippet around the first hit. */
export function matchIntent(text: string, query: string): string | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !words.every((w) => text.includes(w))) return null;
  const i = text.indexOf(words[0]!);
  return (i > 40 ? "…" : "") + text.slice(Math.max(0, i - 40), i + 100).trim() + "…";
}
