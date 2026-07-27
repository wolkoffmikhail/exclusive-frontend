# Stage 7: Advisor And News Analysis

Updated: 2026-07-24.

## Source Policy

The first acceptance keeps automated ingestion intentionally narrow:

| Source | Queue | Automated | Terms status | App rate limit | Production access |
| --- | --- | --- | --- | --- | --- |
| Bank of Russia | first | yes | approved | 1 RSS request per minute per family; 20 items per run | Official RSS metadata, URL, hash and short excerpt with source citation |
| MOEX ISS | first | yes | restricted | 30 sequential security lookups per run; no real-time market data | Reference metadata for ticker/ISIN/name linking only |
| Manual URL/text | first | no | approved | user initiated only | Family-scoped user-provided URLs and permitted excerpts |
| e-disclosure API | second | no | restricted | disabled until API/subscription access is configured | Manual URL/text fallback is used in first acceptance |

Second queue sources are fixed but disabled until terms/access work is explicit: e-disclosure API, T-Invest API, SEC EDGAR, RBC Investments, Kommersant, and issuer IR pages.

Official references checked on 2026-07-24:

- Bank of Russia RSS: https://www.cbr.ru/rss/
- Bank of Russia user agreement: https://www.cbr.ru/user_agreement/
- MOEX ISS reference: https://iss.moex.com/iss/reference/
- MOEX market data terms/order page: https://www.moex.com/a2193
- e-disclosure API gateway: https://e-disclosure.ru/poluchenie-informacii/shlyuz-api

## LLM Boundary

LLM calls are server-side only. The configured model is read from runtime env, and `LLM_DISABLED=1` keeps all advisor features on local fallback.

Runtime provider options:

- OpenAI-compatible: `LLM_PROVIDER=openai-compatible`, `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_BASE_URL`.
- OpenAI env aliases: `OPENAI_API_KEY`, `OPENAI_MODEL`, optional `OPENAI_BASE_URL`.
- Mistral: `LLM_PROVIDER=mistral`, `MISTRAL_API_KEY`, `MISTRAL_MODEL`, optional `MISTRAL_BASE_URL` (defaults to `https://api.mistral.ai/v1`).
- Secrets must be configured in the deployment/runtime environment only. Do not commit provider keys, raw prompts or model responses to the repository.

Prompt versions:

- `stage7-source-document-analysis-v1`
- `stage7-recommendation-explanation-v1`
- `stage7-advisor-portfolio-question-v1`
- `stage7-report-summary-v1`

Every LLM/provider response must validate against the structured advisor schema before it can be saved as ready. The schema requires answer, facts, source links, portfolio links, impact level, confidence, suggested actions, limitations, disclaimer flag and safety flags.

## Storage Rules

- Store source metadata, URL, hash and short excerpt unless the source explicitly allows more.
- Do not store broker tokens, bot tokens, service-role keys, cookies, authorization headers, raw prompts or full audit context.
- Advisor audit records store metadata counts and safety flags, not message text or prompt bodies.
- Exports include marked LLM sections only when requested and include citations/limitations, not raw safety context.

## Known Limitations

- e-disclosure has only manual URL/text fallback in first acceptance.
- MOEX ISS is limited to reference/linking metadata; real-time market data is out of scope.
- Editorial sources are second queue and disabled until reuse/licensing terms are checked.
- Local fallback answers are explanatory and cautious, but not a replacement for provider-backed analysis.
- Browser and production smoke results still need to be captured against a running environment.

## Eval Set

The implemented eval fixture set lives in `src/lib/server/llm/eval-fixtures.ts` and is covered by `src/lib/server/llm/eval-fixtures.test.ts`.

It covers:

- regulator news without a specific issuer;
- disclosure for a concrete issuer;
- dividend announcement;
- similar company names;
- news unrelated to portfolio assets;
- negative news with uncertainty;
- English-language filing.

Each eval must check citations, absence of invented facts, absence of direct buy/sell commands and honest confidence reduction when evidence is weak.
