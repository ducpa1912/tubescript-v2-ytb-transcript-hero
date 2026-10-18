CREATE TABLE public.billing_accounts (
 user_id uuid PRIMARY KEY, customer_id text NOT NULL UNIQUE, subscription_id text UNIQUE, subscription_status text NOT NULL DEFAULT 'none', updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.billing_accounts TO authenticated;
GRANT ALL ON public.billing_accounts TO service_role;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing owner reads" ON public.billing_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TABLE public.payment_fulfillments (
 reference_id text PRIMARY KEY, user_id uuid NOT NULL, credits integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_fulfillments TO authenticated;
GRANT ALL ON public.payment_fulfillments TO service_role;
ALTER TABLE public.payment_fulfillments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment owner reads" ON public.payment_fulfillments FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE OR REPLACE FUNCTION public.fulfill_stripe_credits(_user uuid, _reference text, _type text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inserted integer;
BEGIN
 IF _type NOT IN ('stripe_topup', 'stripe_subscription') OR length(_reference) > 255 THEN RAISE EXCEPTION 'Invalid payment'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_user::text, 0));
 INSERT INTO payment_fulfillments(reference_id,user_id,credits) VALUES (_reference,_user,500) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 IF inserted = 0 THEN RETURN false; END IF;
 INSERT INTO wallets(user_id,credits) VALUES (_user,500) ON CONFLICT(user_id) DO UPDATE SET credits=wallets.credits+500, updated_at=now();
 INSERT INTO credit_ledger(user_id,delta,type,description) VALUES (_user,500,_type,_reference);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.fulfill_stripe_credits(uuid,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_stripe_credits(uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.deliver_transcript_unlocks(_user uuid, _ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE used_count integer; balance integer; free_count integer:=0; paid_count integer:=0; item text; delivered text[]:='{}';
BEGIN
 IF cardinality(_ids)>1000 THEN RAISE EXCEPTION 'Too many videos'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_user::text,0));
 INSERT INTO wallets(user_id,credits) VALUES (_user,0) ON CONFLICT DO NOTHING;
 INSERT INTO daily_usage(user_id,day,used) VALUES (_user,(now() AT TIME ZONE 'UTC')::date,0) ON CONFLICT DO NOTHING;
 SELECT used INTO used_count FROM daily_usage WHERE user_id=_user AND day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE;
 SELECT credits INTO balance FROM wallets WHERE user_id=_user FOR UPDATE;
 FOREACH item IN ARRAY _ids LOOP
  IF EXISTS(SELECT 1 FROM user_video_unlocks WHERE user_id=_user AND video_id=item) THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM video_transcripts WHERE video_id=item AND transcript<>'') THEN CONTINUE; END IF;
  IF used_count+free_count<10 THEN
   INSERT INTO user_video_unlocks(user_id,video_id,source) VALUES(_user,item,'daily_free'); free_count:=free_count+1;
  ELSIF balance>paid_count THEN
   INSERT INTO user_video_unlocks(user_id,video_id,source) VALUES(_user,item,'credit'); paid_count:=paid_count+1;
  ELSE EXIT; END IF;
  delivered:=array_append(delivered,item);
 END LOOP;
 UPDATE daily_usage SET used=used_count+free_count WHERE user_id=_user AND day=(now() AT TIME ZONE 'UTC')::date;
 UPDATE wallets SET credits=balance-paid_count,updated_at=now() WHERE user_id=_user;
 IF paid_count>0 THEN INSERT INTO credit_ledger(user_id,delta,type,description) VALUES(_user,-paid_count,'crawl','Transcript unlocks'); END IF;
 UPDATE videos SET updated_at=now() WHERE id=ANY(delivered);
 RETURN jsonb_build_object('ids',delivered,'freeUsed',free_count,'creditUsed',paid_count,'freeLeft',greatest(0,10-used_count-free_count),'credits',balance-paid_count);
END $$;
REVOKE ALL ON FUNCTION public.deliver_transcript_unlocks(uuid,text[]) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.deliver_transcript_unlocks(uuid,text[]) TO service_role;