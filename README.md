# Tubescript V1 - YTB Transcript Hero

I want you to build a clean, single-purpose web tool where I paste
a YouTube channel URL or video URL, and it extracts the full
transcript of every video (skip Shorts) along with metadata — title,
publish date, views, duration. The final output is a sortable,
searchable table with export to CSV/JSON/Markdown.

ZERO API KEYS REQUIRED — do not use YouTube Data API, GCP, Google
Cloud credentials, or Python/yt-dlp. Build it entirely on the
Lovable stack: React frontend with Lovable Cloud (PostgreSQL +
TypeScript/Deno Edge Functions).

Extraction architecture:
1. Channel & Video Discovery: Parse public channel feeds
   (/feeds/videos.xml?channel_id=...) and scrape the channel's
   public /videos tab HTML payload (ytInitialData) to discover video
   IDs without getting rate-limited.
2. Metadata & Transcripts: Parse video metadata and timedtext captions
   directly from public player data (ytInitialPlayerResponse) or
   direct calls to YouTube's timedtext endpoints using a TypeScript
   extractor.
3. Resilience & Batching: The crawl must handle channels with 500+
   videos without crashing. Never fire 500 concurrent requests.
   Process in paced asynchronous batches (e.g. 5–10 concurrent requests)
   with exponential backoff and jitter on HTTP 429s.
4. Status Handling: If a video legitimately lacks captions (creator
   disabled them, music-only, or auto-subs unavailable), tag it as
   "No captions available" rather than failing the crawl.
5. Storage & Caching: Persist channels and transcripts to the
   PostgreSQL database so previously scanned channels load instantly.

The UX must match the standard of carbon.now.sh — paste, click, done.
Single clean input, realtime progress tracker ("Parsed 42/310 videos..."),
virtualized table that remains butter-smooth at 1,000+ rows, and
instant client-side export to CSV, JSON, and Markdown.

Fan out sub-agents to tackle the extraction engine, the UI, and the
data pipeline individually. /loop on each one and have a separate
sub-agent act as a harsh critic testing against real YouTube channels.
If it misses videos, returns broken transcripts, chokes on large
channels, crashes on videos without captions, or takes more than one
click to start — reject it and keep going.

All agents must log their reasoning and decisions as markdown files
in a /logs folder in the project. Each loop is capped at 3 attempts.
If the 3rd review still fails, the critic must write out exactly why,
give a revised direction, and the agent gets a fresh cycle.

Don't stop until the critic tests against a real public channel with
100+ videos and mixed caption availability, and every single video
resolves cleanly (either full text or explicit "No captions" status)
with exports fully functional. /loop until it's utterly solid.
Fan out sub-agents and ultracode.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/88aaaa96-3d0e-420e-b1e2-40ec6e9880ac).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
