# Tubescript V2 Roadmap

## Tasks
- [ ] Connect V2 to its own private GitHub repo (user action in UI: + menu → GitHub → Connect)
- [ ] Enable payments (US seller; provider check run before enabling)
- [ ] Google sign-in + profiles table
- [ ] DB: projects (channel crawls owned by users), quota/ledger tables, RLS
- [ ] Access tiers: visitors = video link only; registered = channel link with 10/day quota
- [ ] Paid plan: $5/mo = 500 transcripts/month + $5/500 top-ups, granted via verified webhook
- [ ] Project view: resume crawl, update with new videos, transcript persistence
- [ ] Wire crawler entitlement checks into processBatch/startScan
- [ ] Test full flow end-to-end (sign up → crawl → hit quota → pay → continue)

## Blocked / external
- GitHub repo connection: user performs in Lovable UI
- Google OAuth: needs provider configuration via backend auth settings
- Live payments: requires the payments enablement form approval from the user
