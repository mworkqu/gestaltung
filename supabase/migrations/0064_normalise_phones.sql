-- 0064_normalise_phones.sql  (NOT RUN — owner runs it, after 0063)
--
-- Group 7 (P5-07): one stored form for phone numbers, bare E.164 (+97466567410).
-- The app DISPLAYS Qatar numbers as "+974 6656 7410" (lib/phone.ts formatPhoneDisplay);
-- stored values stay compact because wa.me and tel: need digits only. New writes are
-- already normalised by normalizePhone() (store-lead, design-quote, phone prompt,
-- sign-up); this fixes the rows saved before that.
--
-- Rule (same as lib/phone.ts normalizePhone, a little stricter on 8-digit numbers):
--   1. keep digits only; drop a leading "00" (international access code);
--   2. collapse a doubled country code ("974 974 6656 7410" -> "974 6656 7410");
--   3. an 8-digit number starting 3-7 is a Qatar number -> prefix 974;
--   4. only when the result is "974" + 8 digits is it written as "+974XXXXXXXX".
-- Anything else (foreign numbers, test placeholders, junk) is left exactly as it is.
--
-- Read-only check against production on 2026-10-10 (rows that WOULD change):
--   inquiries.phone          6 of 10  (3 spaced "+974 NNNN NNNN", 2 bare 8-digit, 1 doubled code
--                                      "+97497466567410" -> "+97466567410")
--   profiles.phone           0 of 6
--   part_orders.customer_phone 3 of 11 (2 spaced, 1 bare 8-digit)
--
-- DRY RUN first (changes nothing):
--   select 'inquiries' t, id, phone old, public._phone_e164(phone) new from public.inquiries
--     where phone is not null and public._phone_e164(phone) is distinct from phone
--   union all select 'profiles', id, phone, public._phone_e164(phone) from public.profiles
--     where phone is not null and public._phone_e164(phone) is distinct from phone
--   union all select 'part_orders', id, customer_phone, public._phone_e164(customer_phone) from public.part_orders
--     where customer_phone is not null and public._phone_e164(customer_phone) is distinct from customer_phone;
--
-- Safe to re-run (idempotent). Rollback: none needed for display; the old text is not kept,
-- so run the dry run above and save its output first if you want a record.

create or replace function public._phone_e164(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return p; end if;
  if d like '00%' then d := substr(d, 3); end if;
  while d like '974974%' loop
    d := substr(d, 4);
  end loop;
  if d ~ '^[3-7][0-9]{7}$' then d := '974' || d; end if;
  if d ~ '^974[0-9]{8}$' then return '+' || d; end if;
  return p;
end;
$$;

update public.inquiries
   set phone = public._phone_e164(phone)
 where phone is not null and public._phone_e164(phone) is distinct from phone;

update public.profiles
   set phone = public._phone_e164(phone)
 where phone is not null and public._phone_e164(phone) is distinct from phone;

update public.part_orders
   set customer_phone = public._phone_e164(customer_phone)
 where customer_phone is not null and public._phone_e164(customer_phone) is distinct from customer_phone;

-- The helper is only for this migration and the dry run; drop it when done if you like:
--   drop function public._phone_e164(text);
