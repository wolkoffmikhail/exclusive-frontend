export type CronSecretRequest = {
  headers: Pick<Headers, "get">;
};

function configuredSecrets() {
  return [
    process.env.NEWS_INGEST_SECRET,
    process.env.CRON_SECRET,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
}

function bearerToken(request: CronSecretRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? null;
}

export function isAuthorizedCronSecretRequest(request: CronSecretRequest) {
  const expected = configuredSecrets();
  if (expected.length === 0) return { ok: false, reason: "news_ingest_secret_missing" };

  const actual = bearerToken(request) || request.headers.get("x-cron-secret")?.trim() || null;
  if (!actual || !expected.includes(actual)) return { ok: false, reason: "unauthorized" };

  return { ok: true, reason: null };
}
