# MAX notifications

Stage 5 supports MAX delivery for critical limit alerts.

Official API notes used by the implementation:

- API requests should use `https://platform-api2.max.ru`.
- Bot token is passed through the `Authorization` header.
- Text messages are sent with `POST /messages` and either `user_id` or `chat_id`.

## Runtime variables

- `MAX_BOT_TOKEN`: bot token from MAX for business / Master Bot. Store only in runtime environment variables.
- `APP_PUBLIC_URL`: optional public application URL used in alert messages.

For standalone smoke only:

- `MAX_USER_ID`: target MAX user id.
- `MAX_CHAT_ID`: target MAX chat id. If both `MAX_USER_ID` and `MAX_CHAT_ID` are set, the smoke uses `MAX_USER_ID`.

Do not store bot tokens in tracked files. `.env*` files are ignored by this app except `.env.example`.

## Application flow

1. In `Settings`, an `admin` enables MAX and saves a target user or chat id.
2. The application sends a test message through the server action.
3. Critical limit alerts are sent to MAX during limit checks.
4. Delivery attempts are recorded in `notification_deliveries`.
5. If MAX is disabled or the bot token is missing, the in-app alert remains active and the delivery is recorded as skipped.

## Smoke command

Run from `app` with environment variables set:

```powershell
npm run smoke:max
```

The smoke output masks the target id and never prints the bot token.
