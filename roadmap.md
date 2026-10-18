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
- [ ] Finalize Stripe publishable key + webhook signing secret
- [ ] Test full payment flow (requires Stripe test credentials and configured webhook)
- [x] Explicit per-row/bulk cached transcript unlock controls

## Blocked / external
- GitHub repo connection: user performs in Lovable UI
- Stripe activation: publishable key, webhook endpoint configuration/signing secret; test-mode credentials needed before payment verification
