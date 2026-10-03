create type public.plan_tier as enum ('free', 'paid');

create table public.profiles (
  user_id uuid primary key,
  email text,
  display_name text,
  avatar_url text,
  plan plan_tier not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  channel_id text not null,
  channel_title text not null default '',
  thumbnail text,
  video_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel_id)
);

create table public.wallets (
  user_id uuid primary key,
  credits integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  delta integer not null,
  type text not null,
  description text,
  created_at timestamptz not null default now()
);

create table public.daily_usage (
  user_id uuid not null,
  day date not null default current_date,
  used integer not null default 0,
  primary key (user_id, day)
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
GRANT SELECT ON public.daily_usage TO authenticated;
GRANT ALL ON public.daily_usage TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;

create policy "profiles are readable by owner" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
create policy "profiles are updatable by owner" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
create policy "profiles insertable by owner" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

create policy "projects owned by user" ON public.projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

create policy "wallets readable by owner" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

create policy "ledger readable by owner" ON public.credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

create policy "daily usage readable by owner" ON public.daily_usage FOR SELECT TO authenticated USING (auth.uid() = user_id);

create index if not exists projects_user_idx ON public.projects(user_id, updated_at desc);
create index if not exists ledger_user_idx ON public.credit_ledger(user_id, created_at desc);