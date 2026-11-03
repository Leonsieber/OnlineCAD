-- OnlineCAD cloud projects. Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
-- Every project belongs to the user who saved it; row-level security makes sure nobody else can
-- read or change it, except for read access to projects the owner has shared by link.

create table if not exists public.projects (
  id text primary key,
  owner uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name text not null default 'Untitled',
  data jsonb not null,
  thumb text,
  feature_count integer not null default 0,
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_updated on public.projects (owner, updated_at desc);

alter table public.projects enable row level security;

drop policy if exists "owners read their projects" on public.projects;
create policy "owners read their projects" on public.projects
  for select using (auth.uid() = owner);

drop policy if exists "anyone reads shared projects" on public.projects;
create policy "anyone reads shared projects" on public.projects
  for select using (shared);

drop policy if exists "owners create projects" on public.projects;
create policy "owners create projects" on public.projects
  for insert with check (auth.uid() = owner);

drop policy if exists "owners update projects" on public.projects;
create policy "owners update projects" on public.projects
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists "owners delete projects" on public.projects;
create policy "owners delete projects" on public.projects
  for delete using (auth.uid() = owner);
