# Stage 5 recommendations

Stage 5 recommendations are rule-based signals. They explain portfolio conditions that are already visible from imported positions, cash balances, events and analytics.

## Rule-based rules

The generator lives in `src/lib/portfolio/recommendations.ts`.

Implemented rules:

- `asset_class_concentration`: one asset class is above the base concentration threshold.
- `currency_concentration`: one non-base currency is above the base concentration threshold.
- `single_asset_concentration`: one asset is above the base concentration threshold.
- `missing_market_price`: a meaningful position has no market value.
- `cash_below_threshold`: cash share is below the base liquidity threshold.
- `cash_above_threshold`: cash share is above the base cash threshold.
- `xirr_unavailable`: XIRR cannot be calculated from the current data set.
- `large_external_flow`: recent net flow is large compared with portfolio value.
- `upcoming_position_event`: a held asset has a scheduled event inside the configured horizon.

Each generated recommendation includes:

- stable `fingerprint` for dedupe;
- `priority`, `reason`, `confidence` and `metrics`;
- source link through `href`;
- optional `linkedAssetId`.

Stored recommendations with the same open fingerprint suppress generated duplicates, so user decisions are preserved.

## Current limitations

The generator does not use LLM reasoning in stage 5. It does not produce personalized investment advice, target allocations, tax optimization, issuer research or country-specific regulatory conclusions.

The following items are intentionally left for later stages:

- AI/LLM explanation and scenario layer;
- what-if modelling;
- PDF/Excel export;
- external analyst ideas beyond seed/import news items;
- richer issuer/country rules when the asset reference data is incomplete.

## Stage 6 candidates

Stage 6 can build on these fingerprints and metrics to add scenario modelling, exportable reports and optional AI summaries. Those layers should remain downstream from deterministic rules, so the core alerts stay testable and explainable.
