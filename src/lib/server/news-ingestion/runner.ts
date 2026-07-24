import type { NormalizedSourceDocument } from "../../portfolio/news-sources";

export type SourceIngestionAdapter = {
  sourceCode: string;
  fetchDocuments: () => Promise<NormalizedSourceDocument[]>;
};

export type SourceIngestionSuccess = {
  sourceCode: string;
  ok: true;
  documents: NormalizedSourceDocument[];
  fetchedCount: number;
};

export type SourceIngestionFailure = {
  sourceCode: string;
  ok: false;
  documents: [];
  fetchedCount: 0;
  error: string;
};

export type SourceIngestionResult = SourceIngestionSuccess | SourceIngestionFailure;

export type SourceIngestionSummary = {
  results: SourceIngestionResult[];
  fetchedCount: number;
  failedCount: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "source_ingestion_failed");
}

export async function runSourceIngestion(adapters: SourceIngestionAdapter[]): Promise<SourceIngestionSummary> {
  const results: SourceIngestionResult[] = [];

  for (const adapter of adapters) {
    try {
      const documents = await adapter.fetchDocuments();
      results.push({
        sourceCode: adapter.sourceCode,
        ok: true,
        documents,
        fetchedCount: documents.length,
      });
    } catch (error) {
      results.push({
        sourceCode: adapter.sourceCode,
        ok: false,
        documents: [],
        fetchedCount: 0,
        error: errorMessage(error),
      });
    }
  }

  return {
    results,
    fetchedCount: results.reduce((total, result) => total + result.fetchedCount, 0),
    failedCount: results.filter((result) => !result.ok).length,
  };
}

export function sourceIngestionErrorSummary(summary: SourceIngestionSummary) {
  return summary.results
    .filter((result): result is SourceIngestionFailure => !result.ok)
    .map((result) => `${result.sourceCode}:${result.error}`)
    .join("; ");
}
