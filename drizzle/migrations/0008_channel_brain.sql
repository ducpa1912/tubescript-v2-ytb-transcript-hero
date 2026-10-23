CREATE TABLE public.channel_briefs (
  user_id uuid NOT NULL,
  channel_id text NOT NULL,
  markdown text NOT NULL DEFAULT '',
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  model text NOT NULL DEFAULT '',
  video_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);
ALTER TABLE public.channel_briefs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.channel_briefs TO authenticated;
GRANT ALL ON public.channel_briefs TO service_role;
CREATE POLICY "owners read briefs" ON public.channel_briefs FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.generated_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('replicate','style','gap','blueprint')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output text NOT NULL,
  model text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generated_scripts_user_idx ON public.generated_scripts (user_id, channel_id, created_at DESC);
ALTER TABLE public.generated_scripts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.generated_scripts TO authenticated;
GRANT ALL ON public.generated_scripts TO service_role;
CREATE POLICY "owners read scripts" ON public.generated_scripts FOR SELECT TO authenticated USING (auth.uid() = user_id);