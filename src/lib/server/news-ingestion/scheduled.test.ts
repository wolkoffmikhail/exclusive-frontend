import { describe, expect, it } from "vitest";
import { normalizeSourceDocumentCandidate } from "../../portfolio/news-sources";
import { runScheduledNewsIngestion, type ScheduledNewsIngestionStore } from "./scheduled";

function cbrDocument(id: string) {
  return normalizeSourceDocumentCandidate({
    sourceCode: "cbr",
    externalId: id,
    url: `https://example.test/cbr/${id}`,
    title: `CBR document ${id}`,
    publishedAt: "2026-07-27T08:00:00.000Z",
    documentType: "press_release",
    trustLevel: "primary",
    rawExcerpt: "Short official excerpt.",
    payload: { provider: "cbr" },
  });
}

type FakeDocument = ReturnType<typeof cbrDocument>;

class FakeScheduledStore implements ScheduledNewsIngestionStore {
  families = [{ id: "family-1" }, { id: "family-2" }];
  sources = new Map<string, string>();
  documents = new Map<string, FakeDocument & { id: string }>();
  sourceRuns: unknown[] = [];
  audits: Array<{ action: string; familyId: string; afterData: Record<string, unknown> }> = [];
  assets = new Map<string, Array<{ id: string; ticker: string | null; isin: string | null; name: string }>>();
  aliases = new Map<string, string[]>();
  insertedAliases: Array<{ familyId: string; alias: string }> = [];

  constructor() {
    this.assets.set("family-1", [
      { id: "asset-sber", ticker: "SBER", isin: "RU0009029540", name: "Sberbank" },
    ]);
  }

  async listFamilies({ limit }: { limit: number }) {
    return this.families.slice(0, limit);
  }

  async ensureNewsSource({ familyId, sourceCode }: { familyId: string; sourceCode: "cbr" | "moex_iss" }) {
    const key = `${familyId}:${sourceCode}`;
    const existing = this.sources.get(key);
    if (existing) return existing;

    const sourceId = `source-${sourceCode}-${familyId}`;
    this.sources.set(key, sourceId);
    return sourceId;
  }

  async findSourceDocumentDuplicate({
    contentHash,
    externalId,
    familyId,
    sourceId,
  }: {
    familyId: string;
    sourceId: string;
    externalId: string | null;
    contentHash: string | null;
  }) {
    for (const document of this.documents.values()) {
      if (document.contentHash && document.contentHash === contentHash) return { id: document.id, match: "content_hash" as const };
      if (document.externalId && document.externalId === externalId && document.id.startsWith(`${familyId}:${sourceId}:`)) {
        return { id: document.id, match: "external_id" as const };
      }
    }

    return null;
  }

  async insertSourceDocument({
    document,
    familyId,
    sourceId,
  }: {
    familyId: string;
    sourceId: string;
    document: FakeDocument;
  }) {
    const id = `${familyId}:${sourceId}:${document.externalId ?? document.contentHash}`;
    this.documents.set(id, {
      ...document,
      id,
    });
    return id;
  }

  async updateSourceDocument({
    document,
    documentId,
  }: Parameters<ScheduledNewsIngestionStore["updateSourceDocument"]>[0]) {
    this.documents.set(documentId, {
      ...document,
      id: documentId,
    });
  }

  async updateNewsSourceRun(input: Parameters<ScheduledNewsIngestionStore["updateNewsSourceRun"]>[0]) {
    this.sourceRuns.push(input);
  }

  async listAssetsForAliasSync({ familyId, limit }: { familyId: string; limit: number }) {
    return (this.assets.get(familyId) ?? []).slice(0, limit);
  }

  async listExistingAliases({ familyId, assetId }: { familyId: string; assetId: string }) {
    return this.aliases.get(`${familyId}:${assetId}`) ?? [];
  }

  async insertIssuerAliases({
    familyId,
    rows,
  }: Parameters<ScheduledNewsIngestionStore["insertIssuerAliases"]>[0]) {
    this.insertedAliases.push(...rows.map((row) => ({ familyId, alias: row.alias })));
  }

  async addAudit(input: Parameters<ScheduledNewsIngestionStore["addAudit"]>[0]) {
    this.audits.push({ action: input.action, familyId: input.familyId, afterData: input.afterData });
  }
}

describe("runScheduledNewsIngestion", () => {
  it("loads CBR source documents for configured families and skips duplicates on repeat runs", async () => {
    const store = new FakeScheduledStore();
    const fetchCbrDocuments = async () => [cbrDocument("doc-1"), cbrDocument("doc-2")];

    const first = await runScheduledNewsIngestion(store, {
      familyIds: ["family-1"],
      fetchCbrDocuments,
      now: new Date("2026-07-27T09:00:00.000Z"),
    });
    const second = await runScheduledNewsIngestion(store, {
      familyIds: ["family-1"],
      fetchCbrDocuments,
      now: new Date("2026-07-27T10:00:00.000Z"),
    });

    expect(first).toMatchObject({
      ok: true,
      familyCount: 1,
      cbrFetchedCount: 2,
      results: [
        {
          familyId: "family-1",
          cbr: { createdCount: 2, skippedCount: 0, fetchedCount: 2, failedCount: 0, error: null },
        },
      ],
    });
    expect(second.results[0].cbr).toMatchObject({ createdCount: 0, skippedCount: 2 });
    expect(store.audits.filter((audit) => audit.action === "scheduled_ingest_cbr_rss")).toHaveLength(2);
  });

  it("updates existing CBR documents matched by external id so mojibake can be repaired", async () => {
    const store = new FakeScheduledStore();
    const sourceId = await store.ensureNewsSource({ familyId: "family-1", sourceCode: "cbr" });
    const badDocument = cbrDocument("doc-1");
    await store.insertSourceDocument({
      familyId: "family-1",
      sourceId,
      document: {
        ...badDocument,
        title: "Р‘Р°РЅРє Р РѕСЃСЃРёРё",
        rawExcerpt: "РћРїРёСЃР°РЅРёРµ",
        contentHash: "old-mojibake-hash",
      },
    });

    const goodDocument = {
      ...cbrDocument("doc-1"),
      title: "Банк России",
      rawExcerpt: "Описание",
    };

    const summary = await runScheduledNewsIngestion(store, {
      familyIds: ["family-1"],
      fetchCbrDocuments: async () => [goodDocument],
    });
    const stored = Array.from(store.documents.values())[0];

    expect(summary.results[0].cbr).toMatchObject({ createdCount: 0, updatedCount: 1, skippedCount: 0 });
    expect(stored.title).toBe("Банк России");
    expect(stored.rawExcerpt).toBe("Описание");
  });

  it("marks every target family failed when the CBR feed cannot be fetched", async () => {
    const store = new FakeScheduledStore();
    const summary = await runScheduledNewsIngestion(store, {
      familyIds: ["family-1", "family-2"],
      fetchCbrDocuments: async () => {
        throw new Error("network timeout");
      },
      now: new Date("2026-07-27T09:00:00.000Z"),
    });

    expect(summary.ok).toBe(false);
    expect(summary.cbrFailedCount).toBe(1);
    expect(summary.results.map((result) => result.cbr.error)).toEqual([
      "cbr:network timeout",
      "cbr:network timeout",
    ]);
    expect(store.sourceRuns).toEqual([
      expect.objectContaining({ familyId: "family-1", status: "failed", lastError: "cbr:network timeout" }),
      expect.objectContaining({ familyId: "family-2", status: "failed", lastError: "cbr:network timeout" }),
    ]);
  });

  it("optionally refreshes MOEX issuer aliases for better relevance linking", async () => {
    const store = new FakeScheduledStore();
    store.aliases.set("family-1:asset-sber", ["SBER"]);

    const summary = await runScheduledNewsIngestion(store, {
      familyIds: ["family-1"],
      fetchCbrDocuments: async () => [],
      syncMoexAliases: true,
      fetchMoexReference: async () => ({
        secid: "SBER",
        isin: "RU0009029540",
        shortName: "Sber",
        secName: "Sberbank",
        latName: "Sberbank PJSC",
        aliases: ["SBER", "Sber", "Sberbank", "Sberbank PJSC", "RU0009029540"],
      }),
    });

    expect(summary.results[0].moexAliases).toMatchObject({
      enabled: true,
      assetsChecked: 1,
      createdCount: 3,
      skippedCount: 2,
      errorCount: 0,
    });
    expect(store.insertedAliases.map((row) => row.alias)).toEqual(["Sberbank", "Sberbank PJSC", "RU0009029540"]);
  });
});
