import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCronSecretRequest } from "./cron-auth";

const savedEnv = {
  CRON_SECRET: process.env.CRON_SECRET,
  NEWS_INGEST_SECRET: process.env.NEWS_INGEST_SECRET,
};

function requestWithBearer(token: string) {
  return {
    headers: new Headers({
      Authorization: `Bearer ${token}`,
    }),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key as keyof typeof savedEnv];
    } else {
      process.env[key as keyof typeof savedEnv] = value;
    }
  }
});

describe("isAuthorizedCronSecretRequest", () => {
  it("accepts either dedicated news secret or shared cron secret", () => {
    vi.stubEnv("NEWS_INGEST_SECRET", "news-secret");
    vi.stubEnv("CRON_SECRET", "cron-secret");

    expect(isAuthorizedCronSecretRequest(requestWithBearer("news-secret")).ok).toBe(true);
    expect(isAuthorizedCronSecretRequest(requestWithBearer("cron-secret")).ok).toBe(true);
    expect(isAuthorizedCronSecretRequest(requestWithBearer("wrong-secret"))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("requires at least one configured secret", () => {
    vi.stubEnv("NEWS_INGEST_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");

    expect(isAuthorizedCronSecretRequest(requestWithBearer("any-secret"))).toEqual({
      ok: false,
      reason: "news_ingest_secret_missing",
    });
  });
});
