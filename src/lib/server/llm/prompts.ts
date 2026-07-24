import { redactLlmContext } from "./safety";

export const llmPromptVersions = {
  sourceDocumentAnalysis: "stage7-source-document-analysis-v1",
  recommendationExplanation: "stage7-recommendation-explanation-v1",
  advisorPortfolioQuestion: "stage7-advisor-portfolio-question-v1",
  reportSummary: "stage7-report-summary-v1",
} as const;

export type LlmPromptMessage = {
  role: "system" | "user";
  content: string;
};

export type VersionedLlmPrompt = {
  promptVersion: string;
  messages: LlmPromptMessage[];
};

type SourceDocumentPromptDocument = {
  id: string;
  title: string;
  url: string | null;
  document_type: string;
  issuer_name: string | null;
  ticker: string | null;
  isin: string | null;
  published_at: string | null;
  raw_excerpt: string | null;
};

type SourceDocumentPromptLink = {
  asset_id: string;
  label: string;
  ticker: string | null;
  status: string;
  confidence: number | string;
};

type RecommendationPromptRecommendation = {
  id: string;
  title: string;
  body: string | null;
  reason: string | null;
  priority: string;
  recommendation_type: string;
  source: string;
  confidence: number | string | null;
  metrics: Record<string, unknown>;
  href: string | null;
  linkedAssetId: string | null;
};

type RecommendationPromptAsset = {
  id: string;
  name: string;
  ticker: string | null;
};

type RecommendationPromptSourceDocument = {
  id: string;
  title: string;
  url: string | null;
  document_type: string;
  published_at: string | null;
  raw_excerpt: string | null;
};

type AdvisorPortfolioQuestionContext = {
  question: string;
  portfolioSnapshot: Record<string, unknown>;
  recentMessages: Array<{ role: string; content: string }>;
  sourceDocument?: Record<string, unknown> | null;
};

const structuredOutputContract = [
  "Return only JSON with these fields:",
  "answer, facts, assumptions, portfolio_links, source_links, impact_level, confidence, suggested_actions, what_if_prefill, limitations, disclaimer_required, safety_flags.",
  "Every fact must cite an id from source_links.",
  "Do not give direct buy/sell commands or guaranteed return claims.",
  "Be cautious when links are suggested rather than confirmed.",
].join(" ");

function safeJson(value: unknown) {
  return JSON.stringify(redactLlmContext(value), null, 2);
}

export function buildSourceDocumentAnalysisPrompt({
  document,
  links = [],
}: {
  document: SourceDocumentPromptDocument;
  links?: SourceDocumentPromptLink[];
}): VersionedLlmPrompt {
  return {
    promptVersion: llmPromptVersions.sourceDocumentAnalysis,
    messages: [
      {
        role: "system",
        content: `You are a cautious portfolio news analyst. ${structuredOutputContract}`,
      },
      {
        role: "user",
        content: [
          "Analyze this source document for portfolio relevance.",
          "Use source-document:<document.id> as the citation id for document facts.",
          safeJson({ document, links }),
        ].join("\n\n"),
      },
    ],
  };
}

export function buildRecommendationExplanationPrompt({
  asset,
  linkedDocuments = [],
  recommendation,
}: {
  recommendation: RecommendationPromptRecommendation;
  asset?: RecommendationPromptAsset | null;
  linkedDocuments?: RecommendationPromptSourceDocument[];
}): VersionedLlmPrompt {
  return {
    promptVersion: llmPromptVersions.recommendationExplanation,
    messages: [
      {
        role: "system",
        content: `You explain portfolio recommendations without giving personal investment advice. ${structuredOutputContract}`,
      },
      {
        role: "user",
        content: [
          "Explain why this stored recommendation was shown and what evidence supports it.",
          "Use recommendation:<recommendation.id> and source-document:<document.id> citation ids.",
          safeJson({ recommendation, asset, linkedDocuments }),
        ].join("\n\n"),
      },
    ],
  };
}

export function buildAdvisorPortfolioQuestionPrompt(context: AdvisorPortfolioQuestionContext): VersionedLlmPrompt {
  return {
    promptVersion: llmPromptVersions.advisorPortfolioQuestion,
    messages: [
      {
        role: "system",
        content: `You are a cautious portfolio advisor inside an accounting app. ${structuredOutputContract} Link app entities in portfolio_links when relevant. Do not ask for secrets.`,
      },
      {
        role: "user",
        content: [
          "Answer the user's portfolio question using only the supplied portfolio snapshot, recent messages, and selected source document.",
          "This is not personal investment advice; be explicit about limitations.",
          safeJson(context),
        ].join("\n\n"),
      },
    ],
  };
}
