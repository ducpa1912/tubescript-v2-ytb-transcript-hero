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
- YouTube extraction is keyless and lives in `src/lib/youtube.server.ts` (innertube ANDROID player for captions, WEB player for metadata, Videos-tab browse continuations for discovery) — official APIs need keys the product forbids.
- Crawls are a DB-backed queue (`videos.status = 'pending'`) drained by the browser calling `processBatch` repeatedly — each call is its own Worker invocation, staying within the 6-outbound-connection cap and time limits.
- `videos`/`channels` are public read-only via RLS; all writes go through server functions using the admin client — the tool has no sign-in.
- Reasoning logs for each workstream live in `/logs/*.md`.

## V2 auth and monetization
- Single-video scans stay public; channel crawls are server-gated in `startScan` (bearer check), never by UI alone — the RPC endpoint is directly callable.
- Quota unit is one video transcript: first 10/day free for signed-in users (`daily_usage`), then 1 credit per video from `wallets`; every credit change appends to `credit_ledger` (append-only). Entitlements are checked in `processBatch`, which requires auth.
- Channel crawls are saved as `projects` (unique per user+channel) so users can resume or update later; crawled transcripts are permanent — never delete rows when a source video goes private/deleted.
- Profile rows are created lazily by server functions (upsert) — no triggers on `auth.users`.
