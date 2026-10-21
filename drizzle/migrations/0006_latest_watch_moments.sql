ALTER TABLE public.video_analyses ADD COLUMN watch_format integer NOT NULL DEFAULT 0;
ALTER TABLE public.analysis_jobs ADD COLUMN refresh_requested_at timestamptz;
UPDATE public.video_analyses SET result=to_jsonb(result::text) WHERE tier='watch' AND watch_format=0 AND jsonb_typeof(result)='object';
COMMENT ON COLUMN public.video_analyses.watch_format IS 'Data-shape marker only, not prompt history; Watch replaces the same cache row on successful refresh.';
CREATE TABLE public.watch_categories (slug text PRIMARY KEY, label text NOT NULL, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.watch_categories TO authenticated;
GRANT ALL ON public.watch_categories TO service_role;
ALTER TABLE public.watch_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated category vocabulary" ON public.watch_categories FOR SELECT TO authenticated USING (true);
CREATE TABLE public.watch_moments (video_id text NOT NULL, tier text NOT NULL DEFAULT 'watch' CHECK(tier='watch'), version integer NOT NULL DEFAULT 1, ordinal integer NOT NULL, segment_id text NOT NULL, start_seconds numeric NOT NULL, end_seconds numeric NOT NULL, category_slug text REFERENCES public.watch_categories(slug), payload jsonb NOT NULL, PRIMARY KEY(video_id,ordinal), FOREIGN KEY(video_id,tier,version) REFERENCES public.video_analyses(video_id,tier,version));
GRANT SELECT ON public.watch_moments TO authenticated;
GRANT ALL ON public.watch_moments TO service_role;
ALTER TABLE public.watch_moments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Unlocked Watch moments" ON public.watch_moments FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.user_analysis_unlocks u WHERE u.user_id=auth.uid() AND u.video_id=watch_moments.video_id AND u.tier='watch' AND u.version=watch_moments.version));
CREATE INDEX watch_moments_category ON public.watch_moments(category_slug,video_id);
CREATE OR REPLACE FUNCTION public.replace_watch_analysis(_video text,_token uuid,_result jsonb,_segments jsonb,_provider text,_model text,_usage jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE moment jsonb; category jsonb; n integer:=0;
BEGIN
 PERFORM 1 FROM public.analysis_generation_leases WHERE video_id=_video AND tier='watch' AND version=1 AND token=_token AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Watch generation lease expired'; END IF;
 IF jsonb_typeof(_result) IS DISTINCT FROM 'object' OR jsonb_typeof(_result->'moments') IS DISTINCT FROM 'array' OR jsonb_array_length(_result->'moments')=0 THEN RAISE EXCEPTION 'Invalid Watch moments'; END IF;
 INSERT INTO public.video_analyses(video_id,tier,version,result,segments,provider,model,usage,watch_format) VALUES(_video,'watch',1,_result,_segments,_provider,_model,_usage,2)
 ON CONFLICT(video_id,tier,version) DO UPDATE SET result=excluded.result,segments=excluded.segments,provider=excluded.provider,model=excluded.model,usage=excluded.usage,watch_format=2,created_at=now();
 DELETE FROM public.watch_moments WHERE video_id=_video;
 FOR moment IN SELECT value FROM jsonb_array_elements(_result->'moments') LOOP
  category:=moment->'shot_type';
  IF coalesce(category->>'slug','')<>'' THEN
   INSERT INTO public.watch_categories(slug,label,description) VALUES(category->>'slug',category->>'label',coalesce(category->>'description','')) ON CONFLICT(slug) DO NOTHING;
  END IF;
  INSERT INTO public.watch_moments(video_id,ordinal,segment_id,start_seconds,end_seconds,category_slug,payload) VALUES(_video,n,moment->>'segmentId',(moment->>'start')::numeric,(moment->>'end')::numeric,nullif(category->>'slug',''),moment);
  n:=n+1;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.replace_watch_analysis(text,uuid,jsonb,jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_watch_analysis(text,uuid,jsonb,jsonb,text,text,jsonb) TO service_role;