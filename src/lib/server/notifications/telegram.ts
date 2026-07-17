export type TelegramSendInput = {
  chatId: string | null | undefined;
  text: string;
  messageThreadId?: string | null;
};

export type TelegramSendResult = {
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  payload: Record<string, unknown>;
};

export function buildTelegramAlertMessage({
  appUrl,
  severity,
  title,
  value,
}: {
  title: string;
  severity: string;
  value?: string | null;
  appUrl?: string | null;
}) {
  const lines = [
    `Investment Portfolio: ${severity.toUpperCase()}`,
    title,
  ];

  if (value) lines.push(value);
  if (appUrl) lines.push(appUrl);

  return lines.join("\n");
}

export async function sendTelegramMessage(input: TelegramSendInput): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = input.chatId?.trim();

  if (!chatId) {
    return {
      status: "skipped",
      errorMessage: "telegram_chat_id_missing",
      payload: { reason: "chat_id_missing" },
    };
  }

  if (!token) {
    return {
      status: "skipped",
      errorMessage: "telegram_bot_token_missing",
      payload: { reason: "bot_token_missing", chat_id: chatId },
    };
  }

  try {
    const body: Record<string, string | number> = {
      chat_id: chatId,
      text: input.text,
      disable_web_page_preview: 1,
    };

    if (input.messageThreadId) {
      const threadId = Number(input.messageThreadId);
      if (Number.isInteger(threadId) && threadId > 0) body.message_thread_id = threadId;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "failed",
        errorMessage: `telegram_http_${response.status}`,
        payload: typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {},
      };
    }

    return {
      status: "sent",
      errorMessage: null,
      payload: typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {},
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "telegram_send_failed",
      payload: {},
    };
  }
}
