# src/lib rules
- Caption parsing and subtitle serialization live in client-safe captions.ts; authenticated timestamp enrichment lives in captions.functions.ts.

## Video analysis
- Watch atomically replaces its current cache and child moments under a generation token; preserve unlocks and wallet-lock delivery to prevent repeat charges. Transcript text/cues never change.
- Old Watch output remains a string until successful refresh replaces it. Format markers describe shape, not prompt history; only validated moments publish, diagnostics stay owner-only.
- Client-safe watch.ts validates moments; watch-evidence.tsx separates picture, effects and voice from wording tone.
- Internal analysis_settings govern providers; no end-user settings UI. Text (Read + Channel Brain) routes OpenCode Go first then an OpenRouter fallback; Watch routes OpenRouter Gemini first then OpenCode Zen, uses genuine video input and never Read output. Route lists live only in ai-router.server.ts.
- Browser jobs run three concurrent independent invocations with generation leases and a 100s provider budget. Cooldowns key provider:model; terminal denials stop retries.
- Caption facts measure speech, not cuts/B-roll; replay heat is not retention.

## Creator intelligence
- Retention spikes/drops are computed client-side from cached replay heat in `retention.ts` (no extra AI call); always label it replay interest, not retention.
- Channel Brain briefs (`channel_briefs`) and generated scripts are per-user and built only from that user's unlocked transcripts; channel-level AI uses the shared `routeText` text cascade.
- Channel intelligence stores validated structured JSON in the existing brief text column and renders deterministic Markdown for exports; legacy Markdown stays readable until a successful update. Quotes must match unlocked scripts, performance scores are descriptive publication-peer log-view anomalies, and sentiment/causal explanations remain evidence-labelled hypotheses.
