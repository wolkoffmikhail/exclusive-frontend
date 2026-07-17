const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
const messageThreadId = process.env.TELEGRAM_MESSAGE_THREAD_ID?.trim();

function fail(message) {
  console.error(`[telegram-smoke] ${message}`);
  process.exit(1);
}

if (!token) fail("TELEGRAM_BOT_TOKEN is required.");
if (!chatId) fail("TELEGRAM_CHAT_ID is required.");

const body = {
  chat_id: chatId,
  text: [
    "Investment Portfolio smoke",
    `Time: ${new Date().toISOString()}`,
    "Telegram delivery is configured.",
  ].join("\n"),
  disable_web_page_preview: true,
};

if (messageThreadId) {
  const threadId = Number(messageThreadId);
  if (!Number.isInteger(threadId) || threadId <= 0) fail("TELEGRAM_MESSAGE_THREAD_ID must be a positive integer.");
  body.message_thread_id = threadId;
}

let response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
} catch (error) {
  console.error("[telegram-smoke] delivery failed before Telegram response");
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "fetch_failed",
    code: error?.cause?.code ?? null,
  }, null, 2));
  process.exit(1);
}

const payload = await response.json().catch(() => null);
if (!response.ok || payload?.ok !== true) {
  console.error("[telegram-smoke] delivery failed");
  console.error(JSON.stringify({
    status: response.status,
    ok: payload?.ok ?? false,
    description: payload?.description ?? "unknown",
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  chat_id: chatId.replace(/.(?=.{4})/g, "*"),
  message_id: payload.result?.message_id ?? null,
}, null, 2));
