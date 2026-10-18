# Tubescript V2 — implementation status

## Built
- Google sign-in; public single-video extraction; signed-in channel crawls; 10 free transcripts/day.
- Saved projects, resume, and check for new videos.
- Shared metadata and deduplicated transcripts; per-user unlocks; latest metadata with archived history.
- Data API / keyless discovery; English captions with creator tracks preferred; direct extraction and Decodo fallback.
- Paced batches, virtualized searchable/sortable results, CSV/JSON/Markdown exports, owner-readable pipeline logs.
- Existing Atlas Stripe connection, $5/month 500-credit product and $5/500 top-up product.
- Standard hosted Stripe Checkout and separate genuine Link Express Checkout Element.
- Billing page, subscriber-only top-ups, subscription management portal, payment-return status.
- Signature-verified webhook, idempotent monthly-invoice/top-up credit grants; transaction-safe crawl debit.
- Per-row and bulk cached transcript unlocks using free allowance first, then credits.

## Awaiting external setup
- Matching Stripe publishable key and webhook signing secret.
- Configure webhook events: checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted.
- Verify both checkout paths with Stripe test credentials and a real signed-in test purchase before launch.
- Private GitHub connection and production publishing/domain decisions remain user actions.

## Remaining implementation
- Dedicated metadata-only refresh controls and wider extraction gauntlet / Decodo response verification.

## Future ideas (not part of payment delivery)
- Transcript AI summaries, chapters and questions.
- Global transcript search; optional language expansion.
- Sister tool for competitor blog / long-form SEO extraction.

## Technical notes
- Server functions authorize billing; browser amounts/return parameters cannot award credits.
- Webhook fulfillment checks provider records and expected prices; each invoice or session grants at most once.
- Link visibility depends on Stripe eligibility and browser support; standard checkout stays separate.