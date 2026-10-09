-- Rate Trades: shared votes for rate.html. Run once in Supabase -> SQL Editor.
-- Anyone can add a vote (no login) and read vote counts; nobody can read,
-- change or delete individual votes through the public key.

create table if not exists public.trade_votes (
  id bigint generated always as identity primary key,
  trade_id text not null check (char_length(trade_id) between 4 and 40),
  fmt text not null check (fmt in ('sf', 'oneQB')),
  vote smallint not null check (vote in (-1, 0, 1)),  -- 1 = Team A won, 0 = fair, -1 = Team B won
  device text not null check (char_length(device) between 8 and 40),  -- random id per browser, no personal data
  created_at timestamptz not null default now(),
  unique (trade_id, device)  -- one vote per trade per device
);

alter table public.trade_votes enable row level security;

-- The public key may only add votes.
drop policy if exists "anyone can vote" on public.trade_votes;
create policy "anyone can vote" on public.trade_votes
  for insert to anon with check (true);

-- Vote counts for a list of trades (no device ids or timestamps come back).
create or replace function public.vote_tally(ids text[])
returns table (trade_id text, a bigint, fair bigint, b bigint)
language sql stable security definer set search_path = public as $$
  select v.trade_id,
         count(*) filter (where v.vote = 1),
         count(*) filter (where v.vote = 0),
         count(*) filter (where v.vote = -1)
  from public.trade_votes v
  where v.trade_id = any(ids)
  group by v.trade_id;
$$;
grant execute on function public.vote_tally(text[]) to anon;

-- A light brake on spam: at most 120 votes per device per hour.
create or replace function public.trade_votes_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.trade_votes
      where device = new.device and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many votes from this device; try again later.';
  end if;
  return new;
end $$;
drop trigger if exists trade_votes_rate_limit on public.trade_votes;
create trigger trade_votes_rate_limit before insert on public.trade_votes
  for each row execute function public.trade_votes_rate_limit();
