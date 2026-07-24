import { describe, expect, it } from "vitest";
import { normalizeSourceDocumentCandidate } from "../../portfolio/news-sources";
import { runSourceIngestion, sourceIngestionErrorSummary } from "./runner";

describe("runSourceIngestion", () => {
  it("keeps successful source results when another source fails", async () => {
    const summary = await runSourceIngestion([
      {
        sourceCode: "ok_source",
        fetchDocuments: async () => [
          normalizeSourceDocumentCandidate({
            sourceCode: "manual",
            title: "Successful document",
            rawExcerpt: "Document body",
          }),
        ],
      },
      {
        sourceCode: "failed_source",
        fetchDocuments: async () => {
          throw new Error("network timeout");
        },
      },
    ]);

    expect(summary.fetchedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.results[0]).toMatchObject({ sourceCode: "ok_source", ok: true, fetchedCount: 1 });
    expect(summary.results[1]).toMatchObject({ sourceCode: "failed_source", ok: false, error: "network timeout" });
    expect(sourceIngestionErrorSummary(summary)).toBe("failed_source:network timeout");
  });
});
