export type MaxRecipient =
  | { type: "user"; id: string | null | undefined }
  | { type: "chat"; id: string | null | undefined };

export type MaxSendInput = {
  recipient: MaxRecipient;
  text: string;
};

export type MaxSendResult = {
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
  payload: Record<string, unknown>;
};

export function buildMaxAlertMessage({
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

export async function sendMaxMessage(input: MaxSendInput): Promise<MaxSendResult> {
  const token = process.env.MAX_BOT_TOKEN?.trim();
  const recipientId = input.recipient.id?.trim();

  if (!recipientId) {
    return {
      status: "skipped",
      errorMessage: "max_recipient_missing",
      payload: { reason: "recipient_missing" },
    };
  }

  if (!token) {
    return {
      status: "skipped",
      errorMessage: "max_bot_token_missing",
      payload: { reason: "bot_token_missing", recipient_type: input.recipient.type },
    };
  }

  const url = new URL("https://platform-api2.max.ru/messages");
  url.searchParams.set(input.recipient.type === "user" ? "user_id" : "chat_id", recipientId);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text: input.text,
        notify: true,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "failed",
        errorMessage: `max_http_${response.status}`,
        payload: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {},
      };
    }

    return {
      status: "sent",
      errorMessage: null,
      payload: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {},
    };
  } catch (error) {
    return {
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "max_send_failed",
      payload: {},
    };
  }
}
