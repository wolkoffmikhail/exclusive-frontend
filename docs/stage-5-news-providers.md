# Stage 5 news providers

Stage 5 uses `NewsProvider` as the boundary for market news, portfolio news and investment ideas.

## Contract

The provider interface lives in `src/lib/portfolio/news-provider.ts`.

Each provider returns normalized items:

- `source`
- `external_id`
- `kind`: `portfolio_news`, `market_news` or `idea`
- `title`
- `summary`
- `url`
- `published_at`
- `asset_id`
- `payload`

The collector isolates provider errors. If one source fails, other sources can still return items and the dashboard remains independent from provider runtime failures.

## Demo provider

`demoNewsProvider` creates three deterministic demo items per family/day:

- one portfolio news item linked to the first non-cash asset when available;
- one market news item without asset link;
- one investment idea.

## Seed command

Run from `app` with Supabase service-role access:

```powershell
npm run demo:seed-news
```

Optional target family:

```powershell
$env:FAMILY_ID="..."
npm run demo:seed-news
```

The script upserts by `family_id + source + external_id`, so repeating it on the same day does not create duplicates.

## Known limitations

Real external news sources are not connected in stage 5. The demo provider exists to validate UI flows, filtering, watchlist saves and dashboard behavior before a production provider is selected.
