# Investment Portfolio

MVP-система управления семейным инвестиционным портфелем. Приложение заменяет старый проект `exclusive` в существующей конфигурации Coolify и использует уже поднятый Supabase-контур.

## Текущий production

| Параметр | Значение |
|---|---|
| Production URL | `http://192.168.0.22:31010` |
| Health-check | `GET /api/health` |
| Coolify project/resource | `exclusive` |
| Coolify application ID | `6` |
| Coolify application UUID | `x0k4840c84sc0wc4c0gwsk8w` |
| GitHub repository | `wolkoffmikhail/exclusive-frontend` |
| Production branch | `main` |
| Runtime | Docker, Node.js 22 |
| Supabase Studio | `http://192.168.0.22:3011/project/default` |
| Supabase Kong | `http://192.168.0.22:8012` |

Секреты, пароли и service-role ключи не хранятся в репозитории. Рабочие значения задаются через Coolify environment variables.

## Стек

- Next.js 16, App Router
- React 19
- TypeScript
- Supabase Auth / Postgres / Storage
- PostgreSQL RLS для изоляции семей
- Vitest
- Dockerfile для Coolify

## Переменные окружения

См. [.env.example](./.env.example).

Минимально нужны:

```env
NEXT_PUBLIC_SUPABASE_URL=/supabase
SUPABASE_INTERNAL_URL=http://192.168.0.22:8012
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
APP_ENV=development
LOG_LEVEL=info
```

Правила:

- `NEXT_PUBLIC_*` доступны браузеру и не должны содержать секреты.
- `SUPABASE_SERVICE_ROLE_KEY` используется только серверными сценариями.
- Browser-клиент обращается к Supabase через `/supabase`.
- Server-клиент использует `SUPABASE_INTERNAL_URL`.

## Локальный запуск

```bash
npm install
npm run dev
```

Открыть:

```text
http://localhost:3000
```

Для полноценной локальной проверки нужны рабочие Supabase-переменные окружения.

## Проверки качества

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check
```

`npm run check` выполняет lint, typecheck, unit tests и production build.

## Smoke-test

Локально, если приложение запущено на `localhost:3000`:

```bash
npm run smoke
```

Production:

```bash
npm run smoke:prod
```

Или с произвольным адресом:

```bash
node scripts/smoke.mjs http://host:port
```

Smoke проверяет:

1. `GET /api/health` возвращает `status=ok`.
2. Главная страница открывается.
3. Страница `/login` открывается.
4. Защищённые разделы без сессии редиректят на `/login?next=...`:
   - `/dashboard`
   - `/accounts`
   - `/assets`
   - `/import`
   - `/recommendations`
   - `/news`
   - `/watchlist`
   - `/events`
   - `/settings`

Полный browser-smoke с реальным входом пользователя можно добавить следующим слоем через Playwright, когда понадобится проверять UI после авторизации.

## База данных и миграции

Миграции лежат в [supabase/migrations](./supabase/migrations).

Ключевые миграции:

- `20260709140000_identity_and_rls.sql` — identity layer, семьи, роли, RLS.
- `20260710100000_drop_legacy_dds_tables.sql` — удаление старого DDS-наследия.
- `20260710110000_portfolio_domain_schema.sql` — доменная модель портфеля, импорт, операции, снимки позиций.

RLS smoke-тесты лежат в [supabase/tests](./supabase/tests).

## Импорт брокерских отчётов

Текущий MVP поддерживает XLS/XLSX-отчёт БКС:

- загрузка исходного файла в private bucket `broker-reports`;
- хранение метаданных в `imports`;
- хранение raw/normalized строк в `import_rows`;
- применение денежных операций;
- применение валютных остатков;
- сохранение FX-курсов;
- сохранение и отображение `position_snapshots`.

Парсер расположен в [src/lib/server/broker-report-parsers/bcs-xls.ts](./src/lib/server/broker-report-parsers/bcs-xls.ts).

## Документация этапа 1

- [План этапа 1](../development-stage-1.md)
- [Конфигурация Company/Coolify](../docs/step-1-company-coolify-configuration.md)
- [ADR-001: стек и структура](../docs/adr/ADR-001-technology-stack-and-application-structure.md)
- [ADR-002: модель данных и историчность](./docs/adr/ADR-002-data-model-and-history.md)
- [Приёмка и smoke этапа 1](./docs/stage-1-acceptance-and-smoke.md)

## Документация этапа 4

- [Dashboard и аналитика](./docs/stage-4-dashboard-analytics.md)
- [Browser demo smoke](./docs/browser-demo-smoke.md)
