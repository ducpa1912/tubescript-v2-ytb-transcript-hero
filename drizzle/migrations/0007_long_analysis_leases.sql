CREATE OR REPLACE FUNCTION public.claim_analysis_job(_user uuid,_job uuid) RETURNS SETOF public.analysis_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.analysis_jobs SET status='failed',error='Analysis stopped after three attempts. Retry explicitly.',lease_until=NULL,updated_at=now() WHERE id=_job AND user_id=_user AND status='running' AND lease_until<now() AND attempts>=3;
 RETURN QUERY UPDATE public.analysis_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '650 seconds',updated_at=now() WHERE id=_job AND user_id=_user AND attempts<3 AND available_at<=now() AND (status='pending' OR (status='running' AND lease_until<now())) RETURNING *;
END $$;
CREATE OR REPLACE FUNCTION public.claim_analysis_generation(_video text,_tier text,_version integer,_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.analysis_generation_leases(video_id,tier,version,token,expires_at) VALUES(_video,_tier,_version,_token,now()+interval '650 seconds')
 ON CONFLICT(video_id,tier,version) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE analysis_generation_leases.expires_at<now();
 RETURN EXISTS(SELECT 1 FROM public.analysis_generation_leases WHERE video_id=_video AND tier=_tier AND version=_version AND token=_token);
END $$;
REVOKE ALL ON FUNCTION public.claim_analysis_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_analysis_generation(text,text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_job(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_analysis_generation(text,text,integer,uuid) TO service_role;