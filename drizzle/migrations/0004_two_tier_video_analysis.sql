CREATE TABLE public.video_analyses (
 video_id text NOT NULL REFERENCES public.videos(id), tier text NOT NULL CHECK (tier IN ('read','watch')), version integer NOT NULL DEFAULT 1,
 result jsonb NOT NULL, segments jsonb NOT NULL, provider text NOT NULL, model text NOT NULL, usage jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(video_id,tier,version)
);
GRANT SELECT ON public.video_analyses TO authenticated;
GRANT ALL ON public.video_analyses TO service_role;
ALTER TABLE public.video_analyses ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.user_analysis_unlocks (
 user_id uuid NOT NULL, video_id text NOT NULL, tier text NOT NULL, version integer NOT NULL DEFAULT 1, unlocked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,video_id,tier,version), FOREIGN KEY(video_id,tier,version) REFERENCES public.video_analyses(video_id,tier,version)
);
GRANT SELECT ON public.user_analysis_unlocks TO authenticated;
GRANT ALL ON public.user_analysis_unlocks TO service_role;
ALTER TABLE public.user_analysis_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own analysis unlocks" ON public.user_analysis_unlocks FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY "Unlocked analyses" ON public.video_analyses FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.user_analysis_unlocks u WHERE u.user_id=auth.uid() AND u.video_id=video_analyses.video_id AND u.tier=video_analyses.tier AND u.version=video_analyses.version));
CREATE TABLE public.analysis_settings (
 user_id uuid PRIMARY KEY, settings jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.analysis_settings TO authenticated;
GRANT ALL ON public.analysis_settings TO service_role;
ALTER TABLE public.analysis_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own analysis settings" ON public.analysis_settings FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE TABLE public.analysis_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, video_id text NOT NULL REFERENCES public.videos(id), tier text NOT NULL CHECK(tier IN ('read','watch')), version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','failed')), attempts integer NOT NULL DEFAULT 0, error text, settings jsonb NOT NULL,
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,video_id,tier,version)
);
GRANT SELECT ON public.analysis_jobs TO authenticated;
GRANT ALL ON public.analysis_jobs TO service_role;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own analysis jobs" ON public.analysis_jobs FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE INDEX analysis_jobs_pending ON public.analysis_jobs(user_id,status,available_at);
CREATE TABLE public.analysis_generation_leases (
 video_id text NOT NULL, tier text NOT NULL, version integer NOT NULL, token uuid NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(video_id,tier,version)
);
GRANT ALL ON public.analysis_generation_leases TO service_role;
ALTER TABLE public.analysis_generation_leases ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.claim_analysis_job(_user uuid,_job uuid) RETURNS SETOF public.analysis_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN QUERY UPDATE public.analysis_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '150 seconds',updated_at=now()
 WHERE id=_job AND user_id=_user AND attempts<3 AND available_at<=now() AND (status='pending' OR (status='running' AND lease_until<now())) RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.claim_analysis_generation(_video text,_tier text,_version integer,_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.analysis_generation_leases(video_id,tier,version,token,expires_at) VALUES(_video,_tier,_version,_token,now()+interval '120 seconds')
 ON CONFLICT(video_id,tier,version) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE analysis_generation_leases.expires_at<now();
 RETURN EXISTS(SELECT 1 FROM public.analysis_generation_leases WHERE video_id=_video AND tier=_tier AND version=_version AND token=_token);
END $$;
CREATE OR REPLACE FUNCTION public.deliver_analysis_unlock(_user uuid,_video text,_tier text,_version integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cost integer; balance integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_user::text,0));
 IF _tier NOT IN ('read','watch') THEN RAISE EXCEPTION 'Invalid tier'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_video_unlocks WHERE user_id=_user AND video_id=_video) THEN RETURN jsonb_build_object('delivered',false,'reason','transcript_locked'); END IF;
 IF EXISTS(SELECT 1 FROM public.user_analysis_unlocks WHERE user_id=_user AND video_id=_video AND tier=_tier AND version=_version) THEN RETURN jsonb_build_object('delivered',true,'charged',0); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.video_analyses WHERE video_id=_video AND tier=_tier AND version=_version) THEN RETURN jsonb_build_object('delivered',false,'reason','missing'); END IF;
 cost:=CASE WHEN _tier='watch' THEN 10 ELSE 0 END;
 SELECT credits INTO balance FROM public.wallets WHERE user_id=_user FOR UPDATE;
 IF coalesce(balance,0)<cost THEN RETURN jsonb_build_object('delivered',false,'reason','credits'); END IF;
 IF cost>0 THEN UPDATE public.wallets SET credits=credits-cost,updated_at=now() WHERE user_id=_user; END IF;
 INSERT INTO public.user_analysis_unlocks(user_id,video_id,tier,version) VALUES(_user,_video,_tier,_version);
 INSERT INTO public.credit_ledger(user_id,delta,free_used,type,description) VALUES(_user,-cost,0,'analysis_'||_tier,'Video '||_tier||' analysis: '||_video);
 RETURN jsonb_build_object('delivered',true,'charged',cost);
END $$;
REVOKE ALL ON FUNCTION public.claim_analysis_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_analysis_generation(text,text,integer,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.deliver_analysis_unlock(uuid,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_job(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_analysis_generation(text,text,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.deliver_analysis_unlock(uuid,text,text,integer) TO service_role;