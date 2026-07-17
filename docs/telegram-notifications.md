# Telegram notifications

Stage 5 supports Telegram delivery for critical limit alerts.

## Runtime variables

- `TELEGRAM_BOT_TOKEN`: bot token from BotFather. This must be stored only in runtime environment variables.
- `APP_PUBLIC_URL`: optional public application URL used in alert messages.

For standalone smoke only:

- `TELEGRAM_CHAT_ID`: target chat, group or channel id.
- `TELEGRAM_MESSAGE_THREAD_ID`: optional forum topic id.

Do not store bot tokens in tracked files. `.env*` files are ignored by this app except `.env.example`.

## Application flow

1. In `Settings`, an `admin` enables Telegram and saves `chat_id`.
2. The application sends a test message through the server action.
3. Critical limit alerts are sent to Telegram during limit checks.
4. Delivery attempts are recorded in `notification_deliveries`.
5. If Telegram is disabled or the bot token is missing, the in-app alert still remains active and the delivery is recorded as skipped.

## Smoke command

Run from `app` with environment variables set:

```powershell
npm run smoke:telegram
```

The smoke output masks the chat id and never prints the bot token.
