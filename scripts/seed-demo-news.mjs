import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-local-env.mjs";

loadLocalEnv();

const supabaseUrl = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const familyIdFromEnv = process.env.FAMILY_ID;
const familyNameFromEnv = process.env.DEMO_FAMILY_NAME;

function fail(message) {
  console.error(`[seed-demo-news] ${message}`);
  process.exit(1);
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildDemoNewsItems({ familyId, assets, now }) {
  const publishedAt = now.toISOString();
  const key = dayKey(now);
  const asset = assets.find((item) => item.asset_type_code !== "cash") ?? null;
  const assetLabel = asset?.ticker ?? asset?.name ?? "портфель";

  return [
    {
      family_id: familyId,
      source: "demo",
      external_id: `demo-portfolio-review-${familyId}-${key}`,
      kind: "portfolio_news",
      title: `Проверить новости по ${assetLabel}`,
      summary: "Demo-материал для проверки связи новости с активом, карточки новости и сохранения в watchlist.",
      url: null,
      published_at: publishedAt,
      asset_id: asset?.id ?? null,
      payload: { provider: "demo", scenario: "portfolio_news" },
    },
    {
      family_id: familyId,
      source: "demo",
      external_id: `demo-market-risk-${familyId}-${key}`,
      kind: "market_news",
      title: "Рыночный фон: проверить влияние на структуру портфеля",
      summary: "Demo-новость без привязки к конкретному активу, чтобы проверить общий поток рыночных материалов.",
      url: null,
      published_at: publishedAt,
      asset_id: null,
      payload: { provider: "demo", scenario: "market_news" },
    },
    {
      family_id: familyId,
      source: "demo",
      external_id: `demo-idea-${familyId}-${key}`,
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

if (!supabaseUrl) fail("SUPABASE_INTERNAL_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
if (!serviceRoleKey) fail("SUPABASE_SERVICE_ROLE_KEY is required.");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

let familyId = familyIdFromEnv;
if (!familyId) {
  let query = supabase
    .from("families")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1);

  if (familyNameFromEnv) {
    query = query.eq("name", familyNameFromEnv);
  }

  const { data: family, error } = await query.maybeSingle();

  if (error) fail(`family lookup failed: ${error.message}`);
  if (!family?.id) fail("No family found. Set FAMILY_ID or DEMO_FAMILY_NAME, or create a family first.");
  familyId = family.id;
}

const { data: assets, error: assetsError } = await supabase
  .from("assets")
  .select("id, asset_type_code, name, ticker, currency_code")
  .eq("family_id", familyId)
  .order("created_at", { ascending: true });

if (assetsError) fail(`asset lookup failed: ${assetsError.message}`);

const items = buildDemoNewsItems({
  familyId,
  assets: assets ?? [],
  now: new Date(),
});

for (const item of items) {
  const { data: existing, error: lookupError } = await supabase
    .from("news_items")
    .select("id")
    .eq("family_id", item.family_id)
    .eq("source", item.source)
    .eq("external_id", item.external_id)
    .maybeSingle();

  if (lookupError) fail(`news lookup failed: ${lookupError.message}`);

  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("news_items")
      .update({
        kind: item.kind,
        title: item.title,
        summary: item.summary,
        url: item.url,
        published_at: item.published_at,
        asset_id: item.asset_id,
        payload: item.payload,
      })
      .eq("id", existing.id)
      .eq("family_id", item.family_id);

    if (updateError) fail(`news update failed: ${updateError.message}`);
    continue;
  }

  const { error: insertError } = await supabase
    .from("news_items")
    .insert(item);

  if (insertError) fail(`news insert failed: ${insertError.message}`);
}

console.log(JSON.stringify({
  ok: true,
  family_id: familyId,
  item_count: items.length,
  source: "demo",
}, null, 2));
