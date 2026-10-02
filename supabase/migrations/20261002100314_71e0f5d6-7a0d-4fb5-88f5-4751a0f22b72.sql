CREATE TABLE public.channels (
  id text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  handle text,
  thumbnail text,
  video_count integer NOT NULL DEFAULT 0,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.channels TO anon, authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels are public" ON public.channels FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.videos (
  id text PRIMARY KEY,
  channel_id text REFERENCES public.channels(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  publish_date timestamptz,
  views bigint,
  duration_seconds integer,
  status text NOT NULL DEFAULT 'pending',
  status_detail text,
  caption_lang text,
  transcript text,
  word_count integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX videos_channel_status_idx ON public.videos(channel_id, status, position);
GRANT SELECT ON public.videos TO anon, authenticated;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "videos are public" ON public.videos FOR SELECT TO anon, authenticated USING (true);