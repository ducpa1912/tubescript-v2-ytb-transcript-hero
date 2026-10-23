# Tubescript V2 Roadmap

## Done
- [x] Old-project discovery preserves extraction state with separate new-video inserts and metadata-only updates (regression tests).
- [x] Google sign-in enabled on backend (managed) + /auth page + _authenticated layout
- [x] DB: profiles, projects, wallets, credit_ledger, daily_usage (RLS, grants applied)
- [x] Tier gating: visitors = video link only; channel crawls require sign-in (server-enforced in startScan)
- [x] Daily quota: first 10 videos/day free, then paid credits; enforced in processBatch

- [x] Phase 1: shared transcript store + per-user unlocks + latest-metadata refresh with history
- [x] Phase 2: two-stage pipeline (optional Data API listing → cached/keyless transcript extraction)

## Tasks
- [x] Embed Channel Brain in channel projects with saved-brief availability icons, publication-peer statistics and structured timing/script/emotional-appeal explanations; 13 focused tests passed.
- [ ] Verify live richer channel output and signed-in presentation: free models returned rate-limit/empty responses; local signed-in preview remains blank. Previous saved analysis is unchanged.
- [x] Reduce Decodo calls: YouTube-first fallback on blocks/missing data, skip complete metadata, use one subtitle request when the English origin is known; 29 regression checks passed.
- [ ] Consolidate unknown subtitle origins into one request: blocked by Decodo's documented one-origin contract; preserve creator-first fallback meanwhile.
- [x] Creator suite 1: Retention spike & drop deconstructor in the Watch tab + hook/retention technique playbook.
- [x] Creator suite 3: Channel Brain — channel analysis writes channel.md (topics, viewer profile, hits/flops, voice, trends, gaps), hits & flops list, chat with the whole library.
- [x] Creator suite 2: Script lab — Outlier Script Blueprint + 3 modes (replicate video/topic, clone creator style, fill trend gap from own channel.md).
- [ ] Verify Channel Brain, chat and Script lab signed-in in the app (preview hydration issue still blocks browser checks).
- [ ] Decide pricing for channel analysis / chat / scripts (currently free, free AI models only).
- [ ] Next 4: intent/approach search across every analysed transcript (meaning-based search, needs embeddings).
- [ ] Next 5: "Hit vs. Flop" A/B audit — side-by-side comparison of a top outlier vs a bottom performer.
- [x] Parse nested English Decodo tracks and window events; fresh captions, retries and timestamp enrichment now use YouTube-first with Decodo fallback.
- [ ] Verify Decodo extraction through the app: local Extract button stays disabled after entering a URL because the preview does not hydrate.
- [x] Build latest-only richer Watch moments, expandable categories, atomic refresh replacement and separate audiovisual presentation; preserve transcript data and existing unlocks. 37 focused regression checks passed.
- [ ] Verify latest Watch refresh end-to-end: signed-in browser attempt still renders a blank page while local client requests stall; no paid comparison runs created.
- [x] Apply five analysis reliability fixes: verified free cascade, timeout cooldowns/budget, null safety, bounded coverage and terminal retry handling.
- [x] Add hundredth-second anchors, distinct caveat callouts and independent expanded Watch schema/prompt with code-derived facts/replay heatmap.
- [x] Run regression tests: 46 passed; preview build OK; all four free IDs verified in live catalog.
- [ ] Verify updated signed-in analysis flow: preview stalls on client dependency requests; live Read helper cannot access the existing test transcript with the minted session.
- [x] Build two-tier analysis: free Read, 10-credit Watch, fixed caption segments, shared cache, atomic unlocks.
- [x] Build model settings, OpenCode/OpenRouter fallback routing, resumable batch queue and analysis viewer.
- [x] Verify analysis pricing and routing: 32 focused tests; real MiniMax OpenRouter Read response reports $0 cost; persisted real-video Read unlock and repeat unlock charged 0.
- [ ] Verify signed-in analysis UI and full queue flow (local browser dependencies still do not hydrate; two focused attempts, no UI success claimed).
- [ ] Verify Watch video ingestion and 10-credit delivery on a timed video (no existing unlocked videos have cached caption cues; Watch safely asks for timestamps and does not charge).
- [x] Priority 1: immutable timed-caption cache, explicit legacy enrichment, SRT/VTT/SBV per-video downloads and click-to-seek viewer.
- [x] Priority 2: incremental new-video checks, unlocked-transcript keyword search and resumable playlist scans.
- [x] Priority 1/2 regression checks: 25 tests passed; latest build OK.
- [ ] Signed-in timestamp delivery, seek/download and real playlist crawl verification (blocked by non-hydrating local preview dependency requests, even after cache recovery/restart).
- [x] English-only subtitles (creator uploads preferred over auto)
- [x] Decodo Web Data API fallback (subtitles + metadata) when YouTube blocks
- [x] YOUTUBE_API_KEY and DECODO_API_KEY saved as secrets
- [ ] Connect V2 to its own private GitHub repo (user action: + menu → GitHub → Connect)
- [x] Connect existing Atlas Stripe account; create monthly product and reuse existing $5 top-up
- [x] Standard hosted Checkout + genuine Link Express Checkout Element + billing page
- [x] Signed Stripe webhook; atomic idempotent 500-credit grants per paid top-up / monthly invoice
- [x] Atomic transcript quota/credit debit to avoid payment-versus-crawl races
- [x] Upgrade card + projects link to Credits & billing
- [x] Project resume and Check for new videos already implemented
- [x] Save Stripe publishable key securely
- [ ] Configure webhook endpoint and signing secret (requires publishing/external Stripe setup)
- [ ] Test full payment flow (requires Stripe test credentials and configured webhook)
- [x] Explicit per-row/bulk cached transcript unlock controls

## Blocked / external
- GitHub repo connection: user performs in Lovable UI
- Stripe activation: publishable key, webhook endpoint configuration/signing secret; test-mode credentials needed before payment verification
- Browser verification: local client dependency requests hang despite cache refresh; signed-in billing/unlock UI remains unverified
- Existing routing smoke tests: two document-shell mount tests fail; billing/discovery regression tests pass
