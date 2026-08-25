begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'every public table has RLS enabled'
);

grant select, insert, update, delete on address_book, asset_groups, asset_group_members,
  persons, person_relationships, wallet_folders, wallets, auto_send_run_leases to authenticated;
grant select on address_book to anon;

insert into address_book (user_id, public_key, label, created_at)
values ('22222222-2222-2222-2222-222222222222', 'GVICTIM', 'victim', 1);
insert into asset_groups (id, user_id, name, network, created_at, updated_at)
values
  ('group-user-1', '11111111-1111-1111-1111-111111111111', 'owner group', 'public', 1, 1),
  ('group-user-2', '22222222-2222-2222-2222-222222222222', 'victim group', 'public', 1, 1);
insert into asset_group_members (id, group_id, address, role, added_at)
values ('member-user-2', 'group-user-2', 'GVICTIMMEMBER', 'other', 1);
insert into auto_send_run_leases (resource_id, lease_token, expires_at)
values ('lease-private', 'token', 9999999999999);
insert into persons (id, user_id, name, created_at, updated_at)
values
  ('person-user-1', '11111111-1111-1111-1111-111111111111', 'owner person', 1, 1),
  ('person-user-2', '22222222-2222-2222-2222-222222222222', 'victim person', 1, 1);
insert into wallet_folders (id, user_id, name, position)
values ('folder-user-2', '22222222-2222-2222-2222-222222222222', 'victim folder', 0);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$insert into address_book (user_id, public_key, label, created_at)
    values ('11111111-1111-1111-1111-111111111111', 'GOWNER', 'owner', 1)$$,
  'user can insert an owned row'
);

select throws_ok(
  $$insert into address_book (user_id, public_key, label, created_at)
    values ('22222222-2222-2222-2222-222222222222', 'GFORGED', 'forged', 1)$$,
  '42501', null,
  'user cannot insert a row for another tenant'
);

select is(
  (select count(*)::integer from address_book where public_key in ('GOWNER', 'GVICTIM')),
  1,
  'user selects only owned rows from the two-tenant fixture'
);

select results_eq(
  $$update address_book set label = 'stolen' where public_key = 'GVICTIM' returning public_key$$,
  $$values (null::text) limit 0$$,
  'user cannot update another tenant row'
);

select lives_ok(
  $$insert into asset_group_members (id, group_id, address, role, added_at)
    values ('member-user-1', 'group-user-1', 'GOWNERMEMBER', 'other', 1)$$,
  'user can insert a child under an owned parent'
);

select throws_ok(
  $$insert into asset_group_members (id, group_id, address, role, added_at)
    values ('member-forged', 'group-user-2', 'GFORGED', 'other', 1)$$,
  '42501', null,
  'user cannot insert a child under another tenant parent'
);

select is((select count(*)::integer from asset_group_members), 1, 'child selects are parent-scoped');

select throws_ok(
  $$update address_book set user_id = '22222222-2222-2222-2222-222222222222'
    where public_key = 'GOWNER'$$,
  '42501', null,
  'WITH CHECK prevents ownership reassignment'
);

select throws_ok(
  $$insert into person_relationships (id, person_a_id, person_b_id, type, created_at)
    values ('relationship-forged', 'person-user-1', 'person-user-2', 'related', 1)$$,
  '42501', null,
  'relationship cannot reference another tenant person'
);

select throws_ok(
  $$insert into wallets (id, user_id, folder_id, name, public_key, secret_key, position)
    values ('wallet-forged', '11111111-1111-1111-1111-111111111111', 'folder-user-2', 'forged', 'GFORGEDWALLET', '', 0)$$,
  '42501', null,
  'wallet cannot reference another tenant folder'
);

select throws_ok(
  $$update asset_groups set person_id = 'person-user-2' where id = 'group-user-1'$$,
  '42501', null,
  'asset group cannot reference another tenant person'
);

select is((select count(*)::integer from auto_send_run_leases), 0, 'authenticated users cannot see service-only leases');

set local role anon;
select is((select count(*)::integer from address_book), 0, 'anonymous users cannot read tenant data');

select * from finish();
rollback;
