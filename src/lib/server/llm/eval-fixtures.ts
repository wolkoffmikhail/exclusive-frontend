import type { SourceDocumentAnalysisAssetLink, SourceDocumentAnalysisDocument } from "./document-analysis";

export type Stage7EvalFixture = {
  id: string;
  title: string;
  category:
    | "regulator_without_issuer"
    | "issuer_disclosure"
    | "dividend_announcement"
    | "similar_company_names"
    | "unrelated_news"
    | "negative_uncertainty"
    | "english_filing";
  document: SourceDocumentAnalysisDocument;
  links: SourceDocumentAnalysisAssetLink[];
  expected: {
    sourceCitationId: string;
    impactLevel: "low" | "unknown";
    maxConfidence?: number;
    minConfidence?: number;
    linkedAssetIds: string[];
    excludedAssetIds?: string[];
  };
};

export const stage7EvalFixtures: Stage7EvalFixture[] = [
  {
    id: "regulator-news-without-issuer",
    title: "Regulator news without a specific issuer",
    category: "regulator_without_issuer",
    document: {
      id: "eval-regulator-1",
      title: "Bank of Russia updates macroprudential add-ons for unsecured consumer loans",
      url: "https://example.test/cbr/macroprudential-addons",
      document_type: "regulator_news",
      issuer_name: null,
      ticker: null,
      isin: null,
      published_at: "2026-07-20T08:00:00.000Z",
      raw_excerpt: "The regulator changed macroprudential add-ons for unsecured consumer loans. No portfolio issuer is named.",
    },
    links: [],
    expected: {
      sourceCitationId: "source-document:eval-regulator-1",
      impactLevel: "unknown",
      maxConfidence: 0.3,
      linkedAssetIds: [],
    },
  },
  {
    id: "issuer-specific-disclosure",
    title: "Disclosure for a concrete issuer",
    category: "issuer_disclosure",
    document: {
      id: "eval-disclosure-1",
      title: "Polyus publishes board decision disclosure",
      url: "https://example.test/disclosure/polyus-board",
      document_type: "issuer_disclosure",
      issuer_name: "Polyus",
      ticker: "PLZL",
      isin: "RU000A0JNAA8",
      published_at: "2026-07-20T10:30:00.000Z",
      raw_excerpt: "The issuer disclosed a board decision. The text names Polyus and its ordinary shares.",
    },
    links: [
      {
        asset_id: "asset-plzl",
        label: "Polyus",
        ticker: "PLZL",
        status: "confirmed",
        confidence: 0.95,
      },
    ],
    expected: {
      sourceCitationId: "source-document:eval-disclosure-1",
      impactLevel: "low",
      minConfidence: 0.65,
      linkedAssetIds: ["asset-plzl"],
    },
  },
  {
    id: "dividend-announcement",
    title: "Dividend announcement",
    category: "dividend_announcement",
    document: {
      id: "eval-dividend-1",
      title: "Sberbank board recommends dividend",
      url: "https://example.test/issuer/sber-dividend",
      document_type: "dividend",
      issuer_name: "Sberbank",
      ticker: "SBER",
      isin: "RU0009029540",
      published_at: "2026-07-21T11:00:00.000Z",
      raw_excerpt: "The board recommended a dividend. Record date and final approval require source review.",
    },
    links: [
      {
        asset_id: "asset-sber",
        label: "Sberbank",
        ticker: "SBER",
        status: "confirmed",
        confidence: 0.91,
      },
    ],
    expected: {
      sourceCitationId: "source-document:eval-dividend-1",
      impactLevel: "low",
      minConfidence: 0.65,
      linkedAssetIds: ["asset-sber"],
    },
  },
  {
    id: "similar-company-names",
    title: "Similar company names",
    category: "similar_company_names",
    document: {
      id: "eval-similar-names-1",
      title: "TCS Holding publishes operating update",
      url: "https://example.test/issuer/tcs-update",
      document_type: "issuer_disclosure",
      issuer_name: "TCS Holding",
      ticker: "TCSG",
      isin: "US87238U2033",
      published_at: "2026-07-21T13:00:00.000Z",
      raw_excerpt: "The disclosure names TCS Holding. Similar names in the portfolio should not be linked unless evidence matches.",
    },
    links: [
      {
        asset_id: "asset-tcsg",
        label: "TCS Holding",
        ticker: "TCSG",
        status: "confirmed",
        confidence: 0.9,
      },
      {
        asset_id: "asset-t",
        label: "AT&T",
        ticker: "T",
        status: "suggested",
        confidence: 0.4,
      },
    ],
    expected: {
      sourceCitationId: "source-document:eval-similar-names-1",
      impactLevel: "low",
      minConfidence: 0.65,
      linkedAssetIds: ["asset-tcsg"],
      excludedAssetIds: ["asset-t"],
    },
  },
  {
    id: "unrelated-to-portfolio",
    title: "News without a portfolio link",
    category: "unrelated_news",
    document: {
      id: "eval-unrelated-1",
      title: "Regional retail traffic survey is published",
      url: "https://example.test/news/retail-survey",
      document_type: "news",
      issuer_name: null,
      ticker: null,
      isin: null,
      published_at: "2026-07-22T09:00:00.000Z",
      raw_excerpt: "A sector survey was published, but no held issuer, ticker, or ISIN is present in the provided document.",
    },
    links: [],
    expected: {
      sourceCitationId: "source-document:eval-unrelated-1",
      impactLevel: "unknown",
      maxConfidence: 0.3,
      linkedAssetIds: [],
    },
  },
  {
    id: "negative-news-with-uncertainty",
    title: "Negative news with uncertainty",
    category: "negative_uncertainty",
    document: {
      id: "eval-negative-uncertain-1",
      title: "Unconfirmed report mentions possible export restrictions for Gazprom",
      url: "https://example.test/news/gazprom-unconfirmed",
      document_type: "news",
      issuer_name: "Gazprom",
      ticker: "GAZP",
      isin: "RU0007661625",
      published_at: "2026-07-22T16:00:00.000Z",
      raw_excerpt: "The report is negative but unconfirmed. It should lower confidence and avoid firm portfolio conclusions.",
    },
    links: [
      {
        asset_id: "asset-gazp",
        label: "Gazprom",
        ticker: "GAZP",
        status: "suggested",
        confidence: 0.53,
      },
    ],
    expected: {
      sourceCitationId: "source-document:eval-negative-uncertain-1",
      impactLevel: "unknown",
      maxConfidence: 0.45,
      linkedAssetIds: [],
      excludedAssetIds: ["asset-gazp"],
    },
  },
  {
    id: "english-language-filing",
    title: "English-language filing",
    category: "english_filing",
    document: {
      id: "eval-english-filing-1",
      title: "Novatek files English-language operating update",
      url: "https://example.test/filing/novatek-operating-update",
      document_type: "filing",
      issuer_name: "Novatek",
      ticker: "NVTK",
      isin: "RU000A0DKVS5",
      published_at: "2026-07-23T07:45:00.000Z",
      raw_excerpt: "Novatek filed an English-language operating update. The text should be analyzed without assuming Russian-only source content.",
    },
    links: [
      {
        asset_id: "asset-nvtk",
        label: "Novatek",
        ticker: "NVTK",
        status: "confirmed",
        confidence: 0.88,
      },
    ],
    expected: {
      sourceCitationId: "source-document:eval-english-filing-1",
      impactLevel: "low",
      minConfidence: 0.65,
      linkedAssetIds: ["asset-nvtk"],
    },
  },
];
