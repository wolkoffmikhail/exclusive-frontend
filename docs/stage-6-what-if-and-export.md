# Stage 6 what-if and export

Stage 6 adds a stateless one-asset scenario layer and management report exports.

## What-if

The scenario engine lives in `src/lib/portfolio/scenarios.ts`.

Supported scenarios:

- buy one asset on one account;
- sell one asset on one account;
- quantity, price, currency and commission;
- comparison of current portfolio and scenario;
- limit evaluation before and after the scenario;
- diagnostics for insufficient cash, insufficient position, missing FX and missing prices.

The scenario does not insert rows into `operations`. It creates a virtual operation in memory and recalculates positions, cash balances and analytics through the existing portfolio calculation layer.

## UI

Entry points:

- `Dashboard` -> `What-if`;
- `Assets` -> asset detail -> `What-if`;
- `Recommendations` -> recommendation card -> `What-if`, when the recommendation has a linked asset.

The screen is available at `/what-if`. Scenario parameters are kept in query params, so export links can include the same scenario without saving it to the database.

## Exports

The export view model lives in `src/lib/portfolio/exports.ts`.

Excel export:

- endpoint: `/api/portfolio/export?format=excel`;
- generated through the already installed `xlsx` package;
- sheets: `Summary`, `Positions`, `Cashflows`, `Operations`, `Recommendations`, `Warnings`, `Metadata`;
- optional `Scenario` sheet when `include_scenario=1`.
- `portfolio_id` and `account_id` scopes recalculate report summary on the filtered data set.
- Invalid scope is rejected: unknown portfolio, unknown account, or account/portfolio mismatch returns a `400` response.

PDF export:

- endpoint: `/api/portfolio/export?format=pdf-html`;
- current implementation returns a print-friendly HTML report;
- the user can print/save it as PDF in the browser;
- binary PDF generation remains a later hardening task if a PDF engine is selected.

## Security

The export route uses the current authenticated Supabase client and `getActiveFamily`, so it remains scoped by the user's family and RLS. It does not use service-role access.

Successful export requests write a best-effort `audit_log` record with format, scope, sheet names, warnings count and scenario status. The audit entry does not include secrets, raw broker files or notification settings. If audit insert is rejected by role/RLS, the download should still work.

No Telegram, MAX, broker API or Supabase secrets are included in scenario context, export metadata or report output.

## Tests

Focused tests:

```powershell
npm run test -- scenarios.test.ts exports.test.ts
```

Covered:

- buy scenario;
- sell scenario;
- commission;
- insufficient cash;
- insufficient position;
- non-base currency diagnostics;
- limit evaluation before/after;
- export sheet structure;
- account-scoped summary recalculation;
- export request parsing and scope validation;
- safe audit payload shape;
- xlsx workbook generation;
- print-friendly HTML rendering.

## Known limitations

- Only one operation and one asset per scenario.
- Scenario results are not saved as reusable drafts.
- FX conversion is diagnostic only when scenario currency differs from base currency.
- XIRR may be unavailable when the portfolio lacks enough external cash flows.
- PDF is currently an HTML print fallback, not a server-side binary PDF.
- Export scope is recalculated for selected portfolio/account, but very large reports may still need background generation after MVP.
