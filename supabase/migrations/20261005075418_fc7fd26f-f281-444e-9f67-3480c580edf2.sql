create table public.video_transcripts (
  video_id text primary key references public.videos(id) on delete cascade,
  transcript text not null,
  caption_lang text,
  word_count integer not null default 0,
  extracted_at timestamptz not null default now()
);

create table public.user_video_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  video_id text not null references public.videos(id) on delete cascade,
  source text not null default 'daily_free',
  unlocked_at timestamptz not null default now(),
  unique (user_id, video_id)
);

create table public.video_metadata_history (
  id uuid primary key default gen_random_uuid(),
  video_id text not null references public.videos(id) on delete cascade,
  title text,
  views bigint,
  duration_seconds integer,
  publish_date timestamptz,
  recorded_at timestamptz not null default now()
);

GRANT SELECT ON public.video_transcripts TO authenticated;
GRANT ALL ON public.video_transcripts TO service_role;
GRANT SELECT ON public.user_video_unlocks TO authenticated;
GRANT ALL ON public.user_video_unlocks TO service_role;
GRANT ALL ON public.video_metadata_history TO service_role;

ALTER TABLE public.video_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_video_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_metadata_history ENABLE ROW LEVEL SECURITY;

create policy "unlocks readable by owner" on public.user_video_unlocks
  for select to authenticated using (auth.uid() = user_id);

create policy "transcripts readable when unlocked" on public.video_transcripts
  for select to authenticated using (
    exists (select 1 from public.user_video_unlocks u where u.video_id = video_transcripts.video_id and u.user_id = auth.uid())
  );

create index user_video_unlocks_video_idx on public.user_video_unlocks(video_id);
create index video_metadata_history_video_idx on public.video_metadata_history(video_id, recorded_at desc);

alter table public.videos add column views_updated_at timestamptz;

-- Move existing transcripts into the shared store.
insert into public.video_transcripts (video_id, transcript, caption_lang, word_count, extracted_at)
select id, transcript, caption_lang, word_count, updated_at from public.videos where transcript is not null and transcript <> ''
on conflict (video_id) do nothing;

-- Existing project owners keep access to what was already crawled for their channel.
insert into public.user_video_unlocks (user_id, video_id, source)
select p.user_id, v.id, 'migrated' from public.projects p
join public.videos v on v.channel_id = p.channel_id
join public.video_transcripts t on t.video_id = v.id
on conflict (user_id, video_id) do nothing;

update public.videos set views_updated_at = updated_at where views is not null;

alter table public.videos drop column transcript;

-- Keep previous metadata whenever it changes.
create or replace function public.archive_video_metadata()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.title is distinct from new.title and coalesce(old.title, '') <> '')
     or (old.views is distinct from new.views and old.views is not null)
     or (old.duration_seconds is distinct from new.duration_seconds and old.duration_seconds is not null)
     or (old.publish_date is distinct from new.publish_date and old.publish_date is not null) then
    insert into public.video_metadata_history (video_id, title, views, duration_seconds, publish_date)
    values (old.id, old.title, old.views, old.duration_seconds, old.publish_date);
  end if;
  return new;
end $$;
revoke all on function public.archive_video_metadata() from public, anon, authenticated;

create trigger videos_archive_metadata before update on public.videos
for each row execute function public.archive_video_metadata();

-- Per-user work list: videos still to extract, plus cached transcripts this user hasn't unlocked.
create or replace function public.user_channel_todo(_user uuid, _channel text, _limit integer)
returns table (id text, status text, attempts integer, title text, views bigint, duration_seconds integer, publish_date timestamptz, cached boolean)
language sql stable security definer set search_path = public as $$
  select v.id, v.status, v.attempts, v.title, v.views, v.duration_seconds, v.publish_date,
         exists (select 1 from video_transcripts t where t.video_id = v.id) as cached
  from videos v
  where v.channel_id = _channel
    and (v.status = 'pending'
         or (v.status = 'ok' and not exists (select 1 from user_video_unlocks u where u.user_id = _user and u.video_id = v.id)))
  order by v.position
  limit _limit
$$;

create or replace function public.user_channel_remaining(_user uuid, _channel text)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from videos v
  where v.channel_id = _channel
    and (v.status = 'pending'
         or (v.status = 'ok' and not exists (select 1 from user_video_unlocks u where u.user_id = _user and u.video_id = v.id)))
$$;

revoke all on function public.user_channel_todo(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.user_channel_remaining(uuid, text) from public, anon, authenticated;
grant execute on function public.user_channel_todo(uuid, text, integer) to service_role;
grant execute on function public.user_channel_remaining(uuid, text) to service_role;