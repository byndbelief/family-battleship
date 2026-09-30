-- 🎨 Design Studio votes (studio.html): one row per player per question ("who lives in r4box?").
-- Everyone can read the tally; you can only write your own row. Safe to re-run.
create table if not exists public.design_votes (
  player uuid not null references public.profiles(id) on delete cascade,
  topic text not null,
  choice text not null,
  updated_at timestamptz not null default now(),
  primary key (player, topic)
);
alter table public.design_votes enable row level security;
drop policy if exists design_votes_read on public.design_votes;
create policy design_votes_read on public.design_votes for select to authenticated using (true);
drop policy if exists design_votes_own on public.design_votes;
create policy design_votes_own on public.design_votes for all to authenticated using (player = auth.uid()) with check (player = auth.uid());
grant select, insert, update, delete on public.design_votes to authenticated;
-- Cast (or change) a vote; returns the tally for the topic.
create or replace function public.design_vote(p_topic text, p_choice text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into design_votes(player, topic, choice) values (auth.uid(), p_topic, p_choice)
    on conflict (player, topic) do update set choice = excluded.choice, updated_at = now();
  return design_tally(p_topic);
end $$;
create or replace function public.design_tally(p_topic text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('player', v.player, 'name', p.username, 'choice', v.choice, 'at', v.updated_at) order by v.updated_at), '[]'::jsonb)
  from design_votes v join profiles p on p.id = v.player where v.topic = p_topic
$$;
grant execute on function public.design_vote(text, text), public.design_tally(text) to authenticated;
