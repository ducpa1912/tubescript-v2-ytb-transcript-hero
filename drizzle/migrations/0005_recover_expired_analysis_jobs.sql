CREATE OR REPLACE FUNCTION public.claim_analysis_job(_user uuid,_job uuid) RETURNS SETOF public.analysis_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.analysis_jobs SET status='failed',error='Analysis stopped after three attempts. Retry explicitly.',lease_until=NULL,updated_at=now() WHERE id=_job AND user_id=_user AND status='running' AND lease_until<now() AND attempts>=3;
 RETURN QUERY UPDATE public.analysis_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '150 seconds',updated_at=now() WHERE id=_job AND user_id=_user AND attempts<3 AND available_at<=now() AND (status='pending' OR (status='running' AND lease_until<now())) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_analysis_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analysis_job(uuid,uuid) TO service_role;