# Supabase

Миграции применяются по порядку к Supabase resource
`m8c08w0csg4gwg8ksok480o4`.

Production-схема не редактируется вручную без соответствующей миграции в Git.

Проверка первой миграции:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'families', 'family_members');
```
