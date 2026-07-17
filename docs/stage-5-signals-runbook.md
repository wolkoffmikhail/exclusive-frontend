# Stage 5 signals runbook

This document covers the non-recommendation signal models used in stage 5: watchlist, events, limits, alerts and demo-smoke.

## Watchlist

`watchlist_items` stores user-saved items for the active family.

Supported item types:

- `asset`
- `news`
- `idea`
- `recommendation`

Supported statuses:

- `watching`
- `considering`
- `done`
- `archived`

Active duplicates are prevented per family and item reference. Users with edit rights can add items, update notes, change status and archive entries. Viewer users can read the list only.

## Events

`events` stores dated portfolio or asset events.

Stage 5 supports manual events and imported/external events through the shared model. The current UI creates manual events; automatic event creation is limited to future integrations.

Important fields:

- `event_type`
- `title`
- `event_date`
- `asset_id`
- `amount`
- `currency_code`
- `status`
- `source`
- `external_id`

The event list separates upcoming and past events by date/status. Asset-linked events can be opened from the asset context.

## Limits

`limits` defines active portfolio thresholds.

Supported directions:

- `min`
- `max`

Supported severity levels:

- `info`
- `warning`
- `critical`

Stage 5 templates cover cash share, asset class concentration, currency concentration and single asset concentration. Limit checks use current `PortfolioAnalytics` and produce understandable skipped/partial outcomes when the metric cannot be evaluated.

## Alert lifecycle

`alerts` stores system alerts created from limit violations.

Lifecycle:

1. A limit check evaluates active limits.
2. A new violation creates an active alert with a stable fingerprint.
3. A repeated violation updates the existing active alert instead of creating a duplicate.
4. A resolved violation marks the active alert as resolved.
5. Critical alerts can trigger notification delivery attempts.

Telegram and MAX delivery failures do not block alert creation. If messenger settings are missing, the alert remains visible inside the app.

## Demo-smoke

Recommended stage 5 smoke flow:

1. Open `Dashboard` and check recommendations, news and upcoming events.
2. Open `Recommendations`, inspect reason, metrics and linked records.
3. Mark a recommendation as read and update its status as editor/admin.
4. Open `News`, save a news item or idea to watchlist.
5. Open `Watchlist`, update notes and status.
6. Open `Events`, switch upcoming/past filters and open linked asset context.
7. Open `Settings` as admin, create or update limits.
8. Run a limit check and verify alert dedupe.
9. Verify viewer role cannot edit stage 5 data.
10. Run Telegram or MAX test delivery only when messenger settings are configured.

## Known limitations

Browser smoke and production smoke must be executed against a running environment. SQL/RLS role tests are still a separate hardening task.
