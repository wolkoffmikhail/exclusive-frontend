# Этап 1. Приёмка, документация и smoke-test

Дата актуализации: 2026-07-14.

## Статус

Этап 1 закрыт как рабочий технический фундамент MVP. Дополнительно уже реализована часть этапа 2: загрузка и применение XLS/XLSX-отчёта БКС, валютные остатки, FX-курсы и отображение импортированных позиций.

## Что считается готовым

### Архитектура и runtime

- Next.js 16 + React 19 + TypeScript.
- Supabase Auth/Postgres/Storage вместо отдельного ORM/Auth/S3-стека.
- Docker runtime на Node.js 22.
- Production разворачивается в существующем Coolify resource `exclusive`.
- Health endpoint: `GET /api/health`.

### Репозиторий и качество

- Есть `package-lock.json`.
- Есть `.env.example` без секретов.
- Есть `Dockerfile`.
- Есть единые команды:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `npm run check`
  - `npm run smoke`
  - `npm run smoke:prod`

### Данные

- Бизнес-таблицы изолированы по `family_id`.
- RLS включён для доменных таблиц.
- Импорт сохраняет raw и normalized данные отдельно.
- Снимки позиций (`position_snapshots`) используются для отображения текущего состояния портфеля.

### Авторизация

- Supabase Auth подключён.
- Защищённые маршруты без сессии редиректят на `/login`.
- Активная семья определяется на сервере.
- Роли семьи заложены в `family_members`.

### UI-каркас

Доступны разделы:

- Dashboard
- Accounts
- Assets
- Import
- Recommendations
- News
- Watchlist
- Events
- Settings

### Импорт

- Private bucket `broker-reports`.
- XLS/XLSX БКС разбирается.
- Импорт создаёт/обновляет:
  - денежные операции;
  - валютные остатки;
  - FX-курсы;
  - снимки позиций.
- Страница импорта показывает сводку строк и журнал обработки.

## Smoke-test

Smoke-test расположен в:

```text
scripts/smoke.mjs
```

Команды:

```bash
npm run smoke
npm run smoke:prod
node scripts/smoke.mjs http://host:port
```

По умолчанию `npm run smoke` проверяет:

```text
http://localhost:3000
```

`npm run smoke:prod` проверяет:

```text
http://192.168.0.22:31010
```

## Проверяемые условия smoke

1. `/api/health` возвращает HTTP 200 и JSON:

```json
{
  "status": "ok",
  "service": "investment-portfolio"
}
```

2. `/` возвращает HTTP 200 и содержит текст главной страницы.
3. `/login` возвращает HTTP 200 и содержит форму входа.
4. Защищённые маршруты без сессии возвращают redirect на `/login` с параметром `next`:
   - `/dashboard`
   - `/accounts`
   - `/assets`
   - `/import`
   - `/recommendations`
   - `/news`
   - `/watchlist`
   - `/events`
   - `/settings`

## Как запускать перед релизом

Перед push/deploy:

```bash
npm run check
```

После deploy:

```bash
npm run smoke:prod
```

Ожидаемый финал:

```text
Smoke passed.
```

## Что осталось отдельными задачами после этапа 1

- Полный browser-smoke с реальным логином и обходом разделов.
- Отдельная ER-диаграмма.
- ADR-003 по авторизации/ролям.
- ADR-004 по импорту/файловому хранению.
- Полная сверка импорта перед применением.
- PDF-парсер.
