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
- [ ] Apply five analysis reliability fixes: verified free cascade, timeout cooldowns/budget, null safety, bounded coverage and terminal retry handling.
- [ ] Add hundredth-second anchors, distinct caveat callouts and independent expanded Watch schema/prompt with code-derived facts/replay heatmap.
- [ ] Run regression tests and verify the updated signed-in analysis view.
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
