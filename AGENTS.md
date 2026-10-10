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
- YouTube extraction lives in `src/lib/youtube.server.ts`: stage 1 discovery uses the official Data API (`UULF` long-form uploads playlist) only when `YOUTUBE_API_KEY` is set, else keyless Videos-tab continuations; stage 2 captions are always keyless innertube — the Data API cannot download third-party captions.
- Crawls are a DB-backed queue (`videos.status = 'pending'`) drained by the browser calling `processBatch` repeatedly — each call is its own Worker invocation, staying within the 6-outbound-connection cap and time limits.
- `videos`/`channels` hold public metadata only; transcript text lives once per video in `video_transcripts`, readable only via a `user_video_unlocks` row — so a video is extracted once and shared, while access stays per-user. All writes go through server functions using the admin client.
- Previous metadata is archived to `video_metadata_history` by a DB trigger on change — the UI shows only the latest values.
- Reasoning logs for each workstream live in `/logs/*.md`.

## V2 auth and monetization
- Single-video scans stay public; channel crawls are server-gated in `startScan` (bearer check), never by UI alone — the RPC endpoint is directly callable.
- Quota unit is one video transcript: first 10/day free for signed-in users (`daily_usage`), then 1 credit per video from `wallets`; every credit change appends to `credit_ledger` (append-only). Entitlements are checked in `processBatch`, which requires auth.
- Channel crawls are saved as `projects` (unique per user+channel) so users can resume or update later; crawled transcripts are permanent — never delete rows when a source video goes private/deleted.
- Profile rows are created lazily by server functions (upsert) — no triggers on `auth.users`.
- Metadata is latest-wins but never blank-wins: newer non-empty title/views/duration/date replace old values (rounded listing views refresh at most daily), empty values never overwrite; transcripts are never re-fetched or replaced — YouTube often blocks mid-crawl and partial data must survive.
- Quota is charged only for delivered transcripts (fresh or from the shared cache); no-caption/failed videos are free.
- Decodo Web Data API (`src/lib/decodo.server.ts`) is a paid fallback, called only after direct YouTube extraction is blocked and only when `DECODO_API_KEY` is set — keeps per-video cost near zero.
- Transcripts are English-only (creator track preferred over auto-generated) — non-English-only videos resolve as no captions.
