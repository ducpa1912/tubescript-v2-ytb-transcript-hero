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
