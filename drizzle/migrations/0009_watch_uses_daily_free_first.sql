CREATE OR REPLACE FUNCTION public.deliver_analysis_unlock(_user uuid, _video text, _tier text, _version integer DEFAULT 1)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cost integer; balance integer; used_today integer; free_part integer; paid integer; today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_user::text,0));
 IF _tier NOT IN ('read','watch') THEN RAISE EXCEPTION 'Invalid tier'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_video_unlocks WHERE user_id=_user AND video_id=_video) THEN RETURN jsonb_build_object('delivered',false,'reason','transcript_locked'); END IF;
 IF EXISTS(SELECT 1 FROM public.user_analysis_unlocks WHERE user_id=_user AND video_id=_video AND tier=_tier AND version=_version) THEN RETURN jsonb_build_object('delivered',true,'charged',0); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.video_analyses WHERE video_id=_video AND tier=_tier AND version=_version) THEN RETURN jsonb_build_object('delivered',false,'reason','missing'); END IF;
 cost:=CASE WHEN _tier='watch' THEN 10 ELSE 0 END;
 INSERT INTO public.daily_usage(user_id,day,used) VALUES(_user,today,0) ON CONFLICT DO NOTHING;
 SELECT used INTO used_today FROM public.daily_usage WHERE user_id=_user AND day=today FOR UPDATE;
 free_part:=LEAST(cost, GREATEST(0, 10-coalesce(used_today,0)));
 paid:=cost-free_part;
 SELECT credits INTO balance FROM public.wallets WHERE user_id=_user FOR UPDATE;
 IF coalesce(balance,0)<paid THEN RETURN jsonb_build_object('delivered',false,'reason','credits'); END IF;
 IF free_part>0 THEN UPDATE public.daily_usage SET used=used+free_part WHERE user_id=_user AND day=today; END IF;
 IF paid>0 THEN UPDATE public.wallets SET credits=credits-paid,updated_at=now() WHERE user_id=_user; END IF;
 INSERT INTO public.user_analysis_unlocks(user_id,video_id,tier,version) VALUES(_user,_video,_tier,_version);
 INSERT INTO public.credit_ledger(user_id,delta,free_used,type,description) VALUES(_user,-paid,free_part,'analysis_'||_tier,'Video '||_tier||' analysis: '||_video);
 RETURN jsonb_build_object('delivered',true,'charged',paid,'free_used',free_part);
END $function$;