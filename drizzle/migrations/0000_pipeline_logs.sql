CREATE TABLE public.pipeline_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  channel_id text,
  video_id text,
  stage text NOT NULL,
  route text NOT NULL,
  outcome text NOT NULL,
  detail text,
  duration_ms integer
);
GRANT SELECT ON public.pipeline_logs TO authenticated;
GRANT ALL ON public.pipeline_logs TO service_role;
ALTER TABLE public.pipeline_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own logs" ON public.pipeline_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX pipeline_logs_user_time ON public.pipeline_logs (user_id, created_at DESC);