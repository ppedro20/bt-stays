-- Align mock flow with webhook processing (no refactor of public API).

create or replace function public.demo_pay_and_issue_code(p_payment_token text)
returns table (
  payment_id uuid,
  access_code text,
  valid_until timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_code public.access_codes%rowtype;
  v_event_id text;
begin
  select *
    into v_payment
  from public.payments
  where payment_token_hash = public.sha256_text(p_payment_token)
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status <> 'created' then
    raise exception 'payment_invalid_status';
  end if;

  update public.payments
  set provider = 'mock',
      provider_payment_id = v_payment.id::text,
      provider_status = 'created',
      provider_payload = jsonb_build_object('method', 'mock')
  where id = v_payment.id;

  v_event_id := 'mock:' || gen_random_uuid()::text;

  perform public.process_payment_webhook_event(
    'mock',
    v_event_id,
    v_payment.id::text,
    'mock.paid',
    'paid',
    jsonb_build_object('method', 'mock')
  );

  select *
    into v_code
  from public.access_codes c
  where c.payment_id = v_payment.id;

  if not found or v_code.code_plaintext is null then
    raise exception 'code_not_found';
  end if;

  payment_id := v_payment.id;
  access_code := v_code.code_plaintext;
  valid_until := v_code.valid_until;
  return next;
end;
$$;

revoke all on function public.demo_pay_and_issue_code(text) from public;
grant execute on function public.demo_pay_and_issue_code(text) to service_role;
