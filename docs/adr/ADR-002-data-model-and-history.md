# ADR-002. Data model and historical accounting

Date: 2026-07-10

## Status

Accepted.

## Context

The MVP must keep investment portfolio data reproducible and isolated by family. Imported broker reports should remain traceable: raw rows are stored separately from normalized business entities, and operations become the source for calculating historical positions.

The project uses Supabase PostgreSQL, Supabase Auth, Supabase Storage and PostgreSQL Row Level Security.

## Decision

Use a family-scoped relational model:

- `families`, `profiles`, `family_members` remain the identity layer.
- `portfolios` belongs to one family.
- `accounts` belongs to one portfolio and one family.
- `assets` are family-scoped so each family can maintain its own identifiers and naming.
- `operations` are immutable accounting events as much as possible. They reference portfolio, account, optional asset, operation type, amounts and source import metadata.
- `position_snapshots` store calculated or imported state for a date, but operations remain the reproducible source of truth.
- `imports` and `import_rows` preserve original file metadata and raw parsed rows.
- `recommendations`, `events` and `alerts` are family-scoped auxiliary entities.
- `audit_log` stores critical changes and is readable only by `editor` and `admin`.
- Reference dictionaries (`currencies`, `asset_types`, `account_types`, `operation_types`) are global read-only dictionaries for authenticated users.

Every business table has a direct `family_id`. Cross-family references are prevented with composite foreign keys such as `(portfolio_id, family_id)` and `(account_id, family_id)`.

## Access rules

- Family members can read ordinary business data for their family.
- `editor` and `admin` can create and update working data.
- `admin` remains responsible for family membership and critical administrative actions.
- `viewer` cannot mutate working data.
- `audit_log` can be read by `editor` and `admin`; rows are append-only from the client point of view.
- Supabase service role bypasses RLS for migrations, bootstrap scripts and trusted server-only workflows.

## Historical rules

- Money is stored in exact decimal fields with an explicit currency.
- Dates that represent business days are stored as `date`; event timestamps are stored as `timestamptz`.
- Imported raw data is never overwritten by normalized entities.
- Re-importing the same file is detected by `(family_id, account_id, sha256)`.
- Historical state at a date is calculated without using future operations.

## Consequences

- Initial reporting can be built from `operations` and `position_snapshots`.
- Import development can proceed safely because every imported row has a traceable raw payload.
- RLS policies are simple and consistent because every business entity carries `family_id`.
- Some assets may be duplicated across families. This is acceptable for the MVP and avoids premature global-master-data governance.
