# Stage 8: Production Hardening And Advanced Scenarios

Updated: 2026-07-27.

Current implementation note:

- First saved what-if scenario slice is implemented locally and applied to production database: `scenario_drafts` migration/RLS, save/reopen/archive server actions, active draft list in `what-if`, focused unit tests and browser smoke coverage.
- Remaining saved scenario work: richer filters, compare mode and advisor draft creation from `what_if_prefill`.

## Goal

Turn the stage 1-7 product from a verified demo into a more operable production tool: repeatable migrations, safer runtime configuration, saved what-if scenarios, stronger reporting, better LLM quality control and clearer admin operations.

Stage 8 should not add automated trading or opaque AI decisions. It should make the existing accounting, analytics, recommendation and advisor flows easier to trust, repeat and support.

## Scope

In scope:

- production migration/runbook hardening;
- saved what-if scenario drafts;
- binary PDF export decision and implementation path;
- LLM eval operations and regression reporting;
- source/advisor admin observability;
- better secret and environment handling for self-hosted deployments;
- browser smoke stability and demo reset tooling.

Out of scope:

- broker-side trading actions;
- portfolio auto-optimization;
- unlicensed automated ingestion from restricted editorial or disclosure sources;
- real-time market data redistribution;
- mobile-native app.

## Workstreams

### 1. Production Operations

Objective: deployments and database migrations should be repeatable without ad hoc browser scripts.

Tasks:

1. Add a documented production migration procedure for self-hosted Supabase.
2. Add a non-secret migration runner or runbook that can apply SQL files through an approved channel.
3. Record which migrations are applied in production.
4. Add a deployment verification checklist covering health, route smoke, browser smoke and demo seed.
5. Add a rollback note for app-only deploys and database changes.

Acceptance:

- a fresh operator can redeploy and verify production using docs only;
- no service-role, database password or LLM key is printed in logs;
- stage 7 migration drift is detectable.

### 2. Saved What-if Scenarios

Objective: users can save, revisit and compare scenario drafts instead of relying only on query-string state.

Tasks:

1. Add `scenario_drafts` table with `family_id`, owner, status, input payload, result snapshot and audit fields.
2. Add RLS: viewer can read, editor/admin can create/update/archive.
3. Add UI in `what-if` to save current scenario.
4. Add scenario list with filters by status, asset and date.
5. Add compare mode for current portfolio vs saved scenario.
6. Add advisor links that can open or create a scenario draft from `what_if_prefill`.

Acceptance:

- editor can save a scenario and reopen it;
- viewer can inspect saved scenarios without editing;
- archived scenarios disappear from default list;
- browser smoke covers save/reopen/archive.

### 3. Reporting And PDF

Objective: exports become reliable management artifacts, not only browser fallbacks.

Tasks:

1. Decide whether stage 8 implements binary PDF or keeps HTML print as the official export.
2. If binary PDF is selected, choose the engine and deployment impact.
3. Add report template coverage for dashboard, limits, recommendations, source documents and advisor summaries.
4. Add stable filenames and content-type tests.
5. Add optional inclusion switches for LLM summaries and citations.

Acceptance:

- exported report has deterministic sections and filenames;
- download smoke checks Excel and PDF/HTML report;
- LLM sections are marked and cite sources.

### 4. LLM Eval Operations

Objective: stage 7 evals become a repeatable quality gate.

Tasks:

1. Add an eval runner that executes fixture cases against local fallback and configured provider when available.
2. Persist summarized eval results as local artifacts without raw secrets or full prompts.
3. Track pass/fail for citations, no invented facts, no buy/sell commands and confidence behavior.
4. Add a compact report for prompt/model changes.
5. Document when a provider regression blocks deployment.

Acceptance:

- eval runner can be executed locally and in production-like env;
- provider failures are visible but do not expose raw keys or private data;
- prompt/model changes have a recorded eval result.

### 5. Source And Advisor Administration

Objective: admins can understand source health and advisor behavior without reading the database.

Tasks:

1. Add admin view for source registry status, last success and last error.
2. Add manual refresh controls for allowed sources.
3. Add advisor audit summary: counts, model, fallback status, safety flags and citations.
4. Add filters for source documents by source, link status, asset and analysis status.
5. Add actions to archive stale source documents or rejected links.

Acceptance:

- admin can see why a source is paused or failing;
- editor can continue manual import without admin source access;
- viewer cannot see admin-only source controls.

### 6. Demo And Support Tooling

Objective: demo data can be reset and smoke-tested repeatedly.

Tasks:

1. Add idempotent demo reset script for source documents, advisor threads and temporary smoke records.
2. Keep demo seed selection pinned to `DEMO_FAMILY_NAME`.
3. Add smoke diagnostics that explain which stage failed without leaking secrets.
4. Keep browser smoke idempotent across repeated production runs.

Acceptance:

- repeated `demo:seed-*` plus `smoke:browser-demo` runs pass on the same environment;
- temporary smoke data is either disposable or cleaned up;
- failure messages point to the failing feature area.

## Suggested Order

1. Production migration/runbook and stage 7 final acceptance docs.
2. Demo reset and smoke diagnostics.
3. Saved what-if scenario drafts.
4. Reporting/PDF decision and implementation.
5. LLM eval runner and result artifact.
6. Admin observability for sources and advisor audit.

## First Slice

The recommended first implementation slice is:

1. Add `scenario_drafts` migration and RLS.
2. Add save/reopen/archive actions for `what-if`.
3. Add focused tests for scenario draft permissions and payload validation.
4. Extend browser smoke to save and reopen one scenario.

This slice is useful on its own and reuses existing stage 6 and stage 7 flows without adding new external providers.

## Acceptance For Stage 8

Stage 8 is complete when:

- production migration and deployment checks are repeatable from docs;
- saved what-if drafts work across viewer/editor/admin roles;
- reporting export behavior is explicitly decided and covered by tests;
- LLM evals can be run and summarized;
- source/advisor admin observability exists;
- demo seed and browser smoke remain idempotent;
- no new secrets are committed or printed.
