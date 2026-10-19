ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS free_used integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.deliver_transcript_unlocks(_user uuid, _ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE used_count integer; balance integer; free_count integer:=0; paid_count integer:=0; item text; delivered text[]:='{}';
BEGIN
 IF cardinality(_ids)>1000 THEN RAISE EXCEPTION 'Too many videos'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_user::text,0));
 INSERT INTO wallets(user_id,credits) VALUES (_user,0) ON CONFLICT DO NOTHING;
 INSERT INTO daily_usage(user_id,day,used) VALUES (_user,(now() AT TIME ZONE 'UTC')::date,0) ON CONFLICT DO NOTHING;
 SELECT coalesce(used,0) INTO used_count FROM daily_usage WHERE user_id=_user AND day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE;
 SELECT coalesce(credits,0) INTO balance FROM wallets WHERE user_id=_user FOR UPDATE;
 used_count := coalesce(used_count,0); balance := coalesce(balance,0);
 FOREACH item IN ARRAY coalesce(_ids,'{}') LOOP
  IF EXISTS(SELECT 1 FROM user_video_unlocks WHERE user_id=_user AND video_id=item) THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM video_transcripts WHERE video_id=item AND transcript<>'') THEN CONTINUE; END IF;
  -- Free daily allowance is always spent before paid credits.
  IF used_count+free_count<10 THEN
   INSERT INTO user_video_unlocks(user_id,video_id,source) VALUES(_user,item,'daily_free'); free_count:=free_count+1;
  ELSIF balance>paid_count THEN
   INSERT INTO user_video_unlocks(user_id,video_id,source) VALUES(_user,item,'credit'); paid_count:=paid_count+1;
  ELSE EXIT; END IF;
  delivered:=array_append(delivered,item);
 END LOOP;
 UPDATE daily_usage SET used=used_count+free_count WHERE user_id=_user AND day=(now() AT TIME ZONE 'UTC')::date;
 UPDATE wallets SET credits=balance-paid_count,updated_at=now() WHERE user_id=_user;
 IF paid_count>0 OR free_count>0 THEN
  INSERT INTO credit_ledger(user_id,delta,free_used,type,description)
  VALUES(_user,-paid_count,free_count,'crawl',
    CASE WHEN paid_count=0 THEN free_count||' free daily transcripts'
         WHEN free_count=0 THEN paid_count||' transcripts from credits'
         ELSE free_count||' free + '||paid_count||' from credits' END);
 END IF;
 UPDATE videos SET updated_at=now() WHERE id=ANY(delivered);
 RETURN jsonb_build_object('ids',delivered,'freeUsed',free_count,'creditUsed',paid_count,'freeLeft',greatest(0,10-used_count-free_count),'credits',balance-paid_count);
END $$;
REVOKE ALL ON FUNCTION public.deliver_transcript_unlocks(uuid, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_transcript_unlocks(uuid, text[]) TO service_role;