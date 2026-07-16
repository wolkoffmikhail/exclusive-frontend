begin;

insert into public.operation_types (code, name, affects_position)
values ('fx', 'Currency exchange', false)
on conflict (code) do update
set name = excluded.name,
    affects_position = excluded.affects_position;

commit;
