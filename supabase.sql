-- Uruchom ten plik jeden raz w Supabase: SQL Editor > New query > Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Gracz' check (char_length(display_name) between 1 and 24),
  tokens integer not null default 8 check (tokens >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Gracz widzi własny profil" on public.profiles;
create policy "Gracz widzi własny profil"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, tokens)
  values (new.id, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Gracz'), 8)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.spend_token(p_user_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  new_balance integer;
begin
  update public.profiles
  set tokens = tokens - 1, updated_at = now()
  where id = p_user_id and tokens > 0
  returning tokens into new_balance;

  if new_balance is null then
    raise exception 'insufficient_tokens';
  end if;

  return new_balance;
end;
$$;

revoke all on function public.spend_token(uuid) from public, anon, authenticated;
grant execute on function public.spend_token(uuid) to service_role;
