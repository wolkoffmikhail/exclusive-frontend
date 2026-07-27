# Stage 7 Final Acceptance

Date: 2026-07-27.

## Result

Stage 7 is accepted for the current production demo slice.

The deployed application now supports source document import, source document analysis, advisor questions, Mistral runtime configuration, local fallback behavior, citations, guarded answers and browser smoke coverage across viewer, editor and admin roles.

## Runtime

Production target:

```text
http://192.168.0.22:31010
```

Deployment:

```text
Coolify application x0k4840c84sc0wc4c0gwsk8w
```

Latest pushed commit used for the final verification:

```text
845f34d Use disposable limit in browser demo smoke
```

## Environment

Local project runtime values were saved in ignored `.env.local`.

The file contains local copies of Coolify, Mistral, Supabase and demo smoke variables. It is intentionally not committed. Supabase service-role and database values must be treated as high-risk secrets.

Coolify production env was updated for:

- `LLM_DISABLED`
- `LLM_PROVIDER`
- `MISTRAL_API_KEY`
- `MISTRAL_MODEL`
- `MISTRAL_BASE_URL`

Supabase stage 7 migrations were applied to production through the self-hosted Supabase Studio pg-meta endpoint.

Verified production tables:

- `news_sources`
- `source_documents`
- `source_document_links`
- `llm_analyses`
- `advisor_threads`
- `advisor_messages`
- `issuer_aliases`

## Demo Seed

Demo family:

```text
98a64453-8e63-482d-a558-3471227187b6
```

Seed commands passed:

```powershell
npm run demo:seed-users
npm run demo:seed-news
```

`demo:seed-news` now prefers `DEMO_FAMILY_NAME` when `FAMILY_ID` is not provided, so repeated demo checks seed the intended family.

## Verification

Passed:

```powershell
npm run lint
npm run typecheck
npm run smoke:prod
npm run smoke:browser-demo
```

`smoke:browser-demo` covered:

- viewer read-only checks;
- editor import and duplicate-upload path;
- dashboard analytics;
- stage 5 recommendations, news, watchlist, events and limit alert lifecycle;
- stage 6 what-if and export downloads;
- stage 7 source document import and analysis;
- stage 7 advisor flow;
- admin editable access.

## Notes

- The final browser smoke uses a disposable asset-specific limit for the admin limit lifecycle check. This keeps repeated production demo runs idempotent.
- Mistral direct smoke was previously verified without printing the API key or generated content.
- LLM failures still fall back to guarded local responses rather than breaking news/advisor pages.
