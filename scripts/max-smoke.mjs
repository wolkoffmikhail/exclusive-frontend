const token = process.env.MAX_BOT_TOKEN?.trim();
const userId = process.env.MAX_USER_ID?.trim();
const chatId = process.env.MAX_CHAT_ID?.trim();

function fail(message) {
  console.error(`[max-smoke] ${message}`);
  process.exit(1);
}

if (!token) fail("MAX_BOT_TOKEN is required.");
if (!userId && !chatId) fail("MAX_USER_ID or MAX_CHAT_ID is required.");

const url = new URL("https://platform-api2.max.ru/messages");
if (userId) url.searchParams.set("user_id", userId);
if (!userId && chatId) url.searchParams.set("chat_id", chatId);

let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: [
        "Investment Portfolio smoke",
        `Time: ${new Date().toISOString()}`,
        "MAX delivery is configured.",
      ].join("\n"),
      notify: true,
    }),
  });
} catch (error) {
  console.error("[max-smoke] delivery failed before MAX response");
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "fetch_failed",
    code: error?.cause?.code ?? null,
  }, null, 2));
  process.exit(1);
}

const payload = await response.json().catch(() => null);
if (!response.ok) {
  console.error("[max-smoke] delivery failed");
  console.error(JSON.stringify({
    status: response.status,
    error: payload?.error ?? payload?.message ?? "unknown",
  }, null, 2));
  process.exit(1);
}

const target = userId ?? chatId;
console.log(JSON.stringify({
  ok: true,
  target: target.replace(/.(?=.{4})/g, "*"),
  message_id: payload?.message?.body?.mid ?? payload?.message?.id ?? payload?.id ?? null,
}, null, 2));
