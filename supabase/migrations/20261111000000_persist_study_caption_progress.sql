alter table public.study_participations
  add column caption_order uuid[],
  add column current_caption_index integer not null default 0,
  add column current_caption_id uuid,
  add constraint study_participations_caption_order_nonempty
    check (caption_order is null or cardinality(caption_order) > 0),
  add constraint study_participations_caption_index_nonnegative
    check (current_caption_index >= 0),
  add constraint study_participations_caption_cursor_valid
    check (
      caption_order is null
      or (
        current_caption_index < cardinality(caption_order)
        and caption_order[current_caption_index + 1] = current_caption_id
      )
    );

grant insert (profile_id, study_id, caption_order, current_caption_index)
  on public.study_participations to authenticated;
grant update (caption_order, current_caption_index)
  on public.study_participations to authenticated;

create or replace function public.stamp_study_participation_end()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.ended_at is not null then
      new.ended_at := old.ended_at;
      new.completion_stats := old.completion_stats;
    elsif new.ended_at is not null then
      new.ended_at := statement_timestamp();
    end if;
  end if;

  if new.caption_order is null then
    new.current_caption_index := 0;
    new.current_caption_id := null;
  else
    if new.current_caption_index < 0
      or new.current_caption_index >= cardinality(new.caption_order) then
      raise exception 'Invalid study caption position' using errcode = '22023';
    end if;
    new.current_caption_id := new.caption_order[new.current_caption_index + 1];
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_study_participation_end
  on public.study_participations;
create trigger stamp_study_participation_end
  before insert or update on public.study_participations
  for each row execute function public.stamp_study_participation_end();

create function public.start_study_with_order(
  p_study_id bigint,
  p_caption_order uuid[]
)
returns public.study_participations
language plpgsql security invoker set search_path = '' as $$
declare
  participation public.study_participations;
  mapped_caption_count integer;
begin
  if p_caption_order is null
    or cardinality(p_caption_order) = 0
    or array_position(p_caption_order, null) is not null then
    raise exception 'Invalid study caption order' using errcode = '22023';
  end if;

  select count(distinct mapping.caption_id)::integer
    into mapped_caption_count
  from public.study_caption_mappings mapping
  where mapping.study_id = p_study_id
    and mapping.caption_id = any(p_caption_order);

  if mapped_caption_count <> cardinality(p_caption_order) then
    raise exception 'Invalid study caption order' using errcode = '22023';
  end if;

  insert into public.study_participations (
    profile_id,
    study_id,
    caption_order,
    current_caption_index
  )
  values (auth.uid(), p_study_id, p_caption_order, 0)
  on conflict (profile_id, study_id) do update
  set
    caption_order = excluded.caption_order,
    current_caption_index = case
      when array_position(
        excluded.caption_order,
        study_participations.current_caption_id
      ) is not null then array_position(
        excluded.caption_order,
        study_participations.current_caption_id
      ) - 1
      else least(
        study_participations.current_caption_index,
        cardinality(excluded.caption_order) - 1
      )
    end
  where study_participations.ended_at is null;

  select * into strict participation
  from public.study_participations
  where profile_id = auth.uid() and study_id = p_study_id;

  return participation;
end;
$$;

create function public.save_study_progress(
  p_study_id bigint,
  p_caption_index integer
)
returns public.study_participations
language plpgsql security invoker set search_path = '' as $$
declare participation public.study_participations;
begin
  update public.study_participations
  set current_caption_index = p_caption_index
  where profile_id = auth.uid()
    and study_id = p_study_id
    and ended_at is null
    and caption_order is not null
    and p_caption_index >= 0
    and p_caption_index < cardinality(caption_order)
  returning * into participation;

  if not found then
    raise exception 'Study progress could not be saved' using errcode = '22023';
  end if;

  return participation;
end;
$$;

revoke all on function public.start_study_with_order(bigint, uuid[]),
  public.save_study_progress(bigint, integer) from public, anon;
grant execute on function public.start_study_with_order(bigint, uuid[]),
  public.save_study_progress(bigint, integer) to authenticated;
