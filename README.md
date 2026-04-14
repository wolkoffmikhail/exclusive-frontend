# EXCLUSIVE frontend

Frontend for the single-object EXCLUSIVE cashflow workspace.

## Scope

The application is simplified relative to DDS:
- one project object only
- no balance-object selector
- no payout-object selector
- dashboard, balances, income registry, expense registry
- Supabase-backed views and RPC from `schema_v1.sql`

## Required environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=/supabase
SUPABASE_INTERNAL_URL=http://supabase-kong:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-anon-key
```

## Data sources expected by the frontend

Views:
- `v_cashflow_daily`
- `v_expense_daily_by_code`
- `v_latest_balance_per_account`
- `v_balances_registry`
- `v_income_registry`
- `v_expense_registry`

RPC:
- `rpc_dashboard_kpis`
- `rpc_top_expenses`

## Main routes

- `/dashboard`
- `/balances`
- `/registries/income`
- `/registries/expense`
- `/auth/login`

## Next steps

1. Apply `schema_v1.sql` to the new EXCLUSIVE database.
2. Apply `seed.sql` for demo data.
3. Fill `.env.local` with the new Supabase values.
4. Install dependencies.
5. Run `npm run lint` and `npm run build`.
