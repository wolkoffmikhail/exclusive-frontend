export type NewsProviderAsset = {
  id: string;
  asset_type_code: string;
  name: string;
  ticker: string | null;
  currency_code: string | null;
};

export type NewsProviderItem = {
  source: string;
  external_id: string;
  kind: "portfolio_news" | "market_news" | "idea";
  title: string;
  summary: string | null;
  url: string | null;
  published_at: string;
  asset_id: string | null;
  payload: Record<string, unknown>;
};

export type NewsProviderInput = {
  familyId: string;
  assets: NewsProviderAsset[];
  now?: Date;
};

export type NewsProvider = {
  id: string;
  fetch(input: NewsProviderInput): Promise<NewsProviderItem[]>;
};

export type NewsProviderCollectionResult = {
  items: NewsProviderItem[];
  errors: Array<{ provider_id: string; message: string }>;
};

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function firstTradableAsset(assets: NewsProviderAsset[]) {
  return assets.find((asset) => asset.asset_type_code !== "cash") ?? null;
}

export function buildDemoNewsItems(input: NewsProviderInput): NewsProviderItem[] {
  const now = input.now ?? new Date();
  const publishedAt = now.toISOString();
  const key = dayKey(now);
  const asset = firstTradableAsset(input.assets);
  const assetLabel = asset?.ticker ?? asset?.name ?? "портфель";

  return [
    {
      source: "demo",
      external_id: `demo-portfolio-review-${input.familyId}-${key}`,
      kind: "portfolio_news",
      title: `Проверить новости по ${assetLabel}`,
      summary: "Demo-материал для проверки связи новости с активом, карточки новости и сохранения в watchlist.",
      url: null,
      published_at: publishedAt,
      asset_id: asset?.id ?? null,
      payload: { provider: "demo", scenario: "portfolio_news" },
    },
    {
      source: "demo",
      external_id: `demo-market-risk-${input.familyId}-${key}`,
      kind: "market_news",
      title: "Рыночный фон: проверить влияние на структуру портфеля",
      summary: "Demo-новость без привязки к конкретному активу, чтобы проверить общий поток рыночных материалов.",
      url: null,
      published_at: publishedAt,
      asset_id: null,
      payload: { provider: "demo", scenario: "market_news" },
    },
    {
      source: "demo",
      external_id: `demo-idea-${input.familyId}-${key}`,
      kind: "idea",
      title: "Идея для наблюдения: сравнить с текущими лимитами",
      summary: "Demo-идея для проверки фильтра `Идеи` и добавления инвестиционной идеи в watchlist.",
      url: null,
      published_at: publishedAt,
      asset_id: null,
      payload: { provider: "demo", scenario: "idea" },
    },
  ];
}

export const demoNewsProvider: NewsProvider = {
  id: "demo",
  async fetch(input) {
    return buildDemoNewsItems(input);
  },
};

export async function collectNewsProviderItems(providers: NewsProvider[], input: NewsProviderInput): Promise<NewsProviderCollectionResult> {
  const items: NewsProviderItem[] = [];
  const errors: NewsProviderCollectionResult["errors"] = [];

  for (const provider of providers) {
    try {
      items.push(...await provider.fetch(input));
    } catch (error) {
      errors.push({
        provider_id: provider.id,
        message: error instanceof Error ? error.message : "news_provider_failed",
      });
    }
  }

  return { items, errors };
}
