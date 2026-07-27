# Browser Demo Smoke

The full browser demo smoke is an optional Playwright runner for the live demo flow through import, portfolio analytics, and read-only access checks.

For a safe service-role workflow with Coolify, use [Coolify Service Role Runbook for Demo Smoke](./coolify-service-role-demo-smoke.md). The service-role key must be used only as a temporary environment variable and must not be saved in docs or repository files.

It checks:

- viewer login and read-only import access;
- editor login;
- Import page;
- active account selector;
- XLS/XLSX upload;
- uploaded status;
- parse action and `parsed`/reconciliation state;
- row summary;
- raw and normalized row details;
- apply action and `applied` status;
- Dashboard analytics:
  - KPI grid;
  - total value, cash, P&L, XIRR, inflow and positions cards;
  - asset-type structure;
  - currency/account structure;
  - cash-flow period switch;
  - cash-flow table;
  - XIRR detail and cash-flow rows;
- Stage 5 dashboard signals;
- Recommendations:
  - list and filters;
  - recommendation card;
  - mark as read action when available;
  - status update action when available;
- News and ideas:
  - list and filters;
  - news card;
  - save to watchlist action when available;
- Watchlist:
  - list and filters;
  - notes/status update when an editable item is available;
- Events:
  - list and filters;
  - event cards;
- Limits:
  - admin-only limits settings;
  - default limit creation when no active limits exist;
  - limit check action;
- viewer read-only access for stage 5 sections;
- Assets and positions;
- duplicate upload protection for the same report;
- Audit block in Settings.

## Requirements

Install Playwright in the environment that runs the demo:

```bash
npm install -D playwright
```

Install a browser runtime, or use an existing system browser channel:

```bash
npx playwright install chromium
PLAYWRIGHT_CHANNEL=msedge
PLAYWRIGHT_CHANNEL=chrome
```

On Windows the smoke runner auto-detects installed Edge or Chrome when `PLAYWRIGHT_CHANNEL` is not set.

Provide real demo credentials:

```bash
DEMO_ADMIN_EMAIL=admin@example.com
DEMO_ADMIN_PASSWORD=...
DEMO_VIEWER_EMAIL=viewer@example.com
DEMO_VIEWER_PASSWORD=...
DEMO_EDITOR_EMAIL=editor@example.com
DEMO_EDITOR_PASSWORD=...
```

The smoke and demo seed scripts also read `.env.local` automatically. Values already set in the shell take precedence over `.env.local`.

Keep `SUPABASE_SERVICE_ROLE_KEY` out of `.env.local`; pass it only as a temporary process environment variable when seeding is required.

If the environment has a Supabase service-role key, seed or update demo users first:

```bash
SUPABASE_INTERNAL_URL=http://192.168.0.22:8012 \
SUPABASE_SERVICE_ROLE_KEY=... \
DEMO_ADMIN_EMAIL=admin@example.com \
DEMO_ADMIN_PASSWORD=... \
DEMO_EDITOR_EMAIL=editor@example.com \
DEMO_EDITOR_PASSWORD=... \
DEMO_VIEWER_EMAIL=viewer@example.com \
DEMO_VIEWER_PASSWORD=... \
npm run demo:seed-users
```

The seed command creates or updates auth users, links them to one demo family as `admin`, `editor`, and `viewer`, and creates an active demo portfolio/account for imports.

For stage 5 news/watchlist coverage, seed demo news before running browser smoke when the environment has no news items yet:

```bash
SUPABASE_INTERNAL_URL=http://192.168.0.22:8012 \
SUPABASE_SERVICE_ROLE_KEY=... \
npm run demo:seed-news
```

For a full fresh-upload run, the selected demo account must not already have the same broker report SHA-256 in its import journal. If the fixture was already uploaded, the smoke runner verifies duplicate protection and continues with dashboard, assets and stage 5 checks against the existing demo data.

Optionally override the target and broker report fixture:

```bash
DEMO_BASE_URL=http://192.168.0.22:31010
DEMO_BROKER_REPORT_PATH="../Брокерский пример .xls"
```

## Run

```bash
npm run smoke:browser-demo
```

The command is intentionally not part of `npm run check`, because it requires real credentials and a browser runtime.
