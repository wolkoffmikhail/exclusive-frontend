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
DEMO_VIEWER_EMAIL=viewer@example.com
DEMO_VIEWER_PASSWORD=...
DEMO_EDITOR_EMAIL=editor@example.com
DEMO_EDITOR_PASSWORD=...
```

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

For a full fresh-upload run, the selected demo account must not already have the same broker report SHA-256 in its import journal. If the fixture was already uploaded, the smoke runner stops on the expected duplicate protection and asks for demo import data to be reset before rerunning the full path.

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
