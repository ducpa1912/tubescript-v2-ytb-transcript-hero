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
- [ ] Enable payments (Paddle recommended for US digital SaaS — awaiting user confirmation)
- [ ] Products: $5/mo = 500 transcripts + $5/500 top-up; webhook grants credits idempotently
- [ ] Upgrade/pricing UI on the quota-reached card + account page
- [ ] Project detail view: resume crawl, update with new videos
- [ ] Test full flow end-to-end (sign up → crawl → hit quota → pay → continue)

## Blocked / external
- GitHub repo connection: user performs in Lovable UI
- Live payments: requires the payments enablement form approval from the user
