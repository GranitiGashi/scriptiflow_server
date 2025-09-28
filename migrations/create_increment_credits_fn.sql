create or replace function public.increment_credits(p_user_id uuid, p_delta_milli integer)
returns void
language plpgsql
as $$
begin
  insert into public.user_credits(user_id, balance_milli, updated_at)
  values (p_user_id, greatest(p_delta_milli, 0), now())
  on conflict (user_id)
  do update set balance_milli = public.user_credits.balance_milli + p_delta_milli, updated_at = now();
end;
$$;


