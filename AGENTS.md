<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Tubescript architecture
- YouTube discovery uses Data API UULF when configured, else keyless Videos-tab continuations; fresh captions always use Decodo Web Data API; shared cached transcripts bypass extraction.
- Crawls are a DB-backed queue (`videos.status = 'pending'`) drained by the browser calling `processBatch` repeatedly — each call is its own Worker invocation, staying within the 6-outbound-connection cap and time limits.
- `videos`/`channels` hold public metadata only; transcript text lives once per video in `video_transcripts`, readable only via a `user_video_unlocks` row — so a video is extracted once and shared, while access stays per-user. All writes go through server functions using the admin client.
- Previous metadata is archived to `video_metadata_history` by a DB trigger on change — the UI shows only the latest values.
- Discovery duplicate-ignores new inserts and metadata-only patches existing rows; never insert partial existing rows or reset extraction state.
- Reasoning logs for each workstream live in `/logs/*.md`.

## V2 auth and monetization
- Single-video scans stay public; channel crawls are server-gated in `startScan` (bearer check), never by UI alone — the RPC endpoint is directly callable.
- Quota unit is one video transcript: first 10/day free for signed-in users (`daily_usage`), then 1 credit per video from `wallets`; every credit change appends to `credit_ledger` (append-only). Entitlements are checked in `processBatch`, which requires auth.
- Channel crawls are saved as `projects` (unique per user+channel) so users can resume or update later; crawled transcripts are permanent — never delete rows when a source video goes private/deleted.
- Profile rows are created lazily by server functions (upsert) — no triggers on `auth.users`.
- Metadata is latest-wins but never blank-wins: newer non-empty title/views/duration/date replace old values (rounded listing views refresh at most daily), empty values never overwrite; transcripts are never re-fetched or replaced — YouTube often blocks mid-crawl and partial data must survive.
- Quota is charged only for delivered transcripts (fresh or from the shared cache); no-caption/failed videos are free.
- Decodo Web Data API (`src/lib/decodo.server.ts`) is the required primary source for fresh captions, retries and timestamp enrichment; surface configuration/provider failures as retryable errors rather than missing captions, and keep credentials server-only.
- Transcripts are English-only (creator track preferred over auto-generated) — non-English-only videos resolve as no captions.
- Pipeline events (discovery/transcript/billing + route taken) are appended to `pipeline_logs` via admin client, owner-readable only; logging failures never break crawls.
- Stripe billing uses authenticated server functions, a separate Elements-based Link checkout, and a signature-verified public webhook; paid invoice/session IDs are deduplicated inside the same database transaction that updates wallets and appends the ledger.
- Transcript unlocks and payment grants share a per-user transaction lock; never replace a wallet balance using a stale application read, because simultaneous payments and crawls can lose credits.
- Explicit cached-transcript unlock controls use the same database delivery function as crawls, so already-unlocked or missing transcripts cannot be charged again.

## Transcript evolution and collections
- Timed captions live in immutable video_caption_cues with separate per-user caption unlocks; legacy timestamp refreshes never update transcript text and are charged atomically only after cues exist.
- Playlist IDs use the PL: prefix in saved collections; collection_videos owns ordered membership so one global video is never reassigned from its channel by playlist discovery.
- Incremental channel discovery stops on a fully known page rather than a timestamp cutoff, because undated or backdated uploads must not be missed; count persisted membership, not only returned pages.
- Caption parsing and subtitle serialization live in client-safe captions.ts; authenticated timestamp enrichment lives in captions.functions.ts.

## Video analysis
- Watch atomically replaces its current cache and child moments under a generation token; preserve unlocks and wallet-lock delivery to prevent repeat charges. Transcript text/cues never change.
- Old Watch output remains a string until successful refresh replaces it. Format markers describe shape, not prompt history; only validated moments publish, diagnostics stay owner-only.
- Client-safe watch.ts validates moments; watch-evidence.tsx separates picture, effects and voice from wording tone.
- Internal analysis_settings govern providers; no end-user settings UI. Read uses verified zero-cost models; Watch uses genuine video input and never Read output.
- Browser jobs run three concurrent independent invocations with generation leases and a 100s provider budget. Cooldowns key provider:model; terminal denials stop retries.
- Caption facts measure speech, not cuts/B-roll; replay heat is not retention.

## Creator intelligence
- Retention spikes/drops are computed client-side from cached replay heat in `retention.ts` (no extra AI call); always label it replay interest, not retention.
- Channel Brain briefs (`channel_briefs`) and generated scripts are per-user and built only from that user's unlocked transcripts; channel-level AI uses the free-only `routeText` cascade so it can never cost money silently.
