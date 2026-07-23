import { NextRequest, NextResponse } from "next/server";
import { buildPortfolioExcelBuffer, buildPortfolioExportViewModel, buildPortfolioReportHtml } from "@/lib/portfolio/exports";
import { buildPortfolioExportAuditPayload, exportRequestErrorMessage, parsePortfolioExportRequest, validatePortfolioExportScope } from "@/lib/portfolio/export-request";
import { getActiveFamily, getPortfolioData } from "@/lib/portfolio/data";
import { runWhatIfScenario, type WhatIfScenarioResult } from "@/lib/portfolio/scenarios";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function numeric(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function scenarioFromSearchParams(searchParams: URLSearchParams, data: Awaited<ReturnType<typeof getPortfolioData>>): WhatIfScenarioResult | null {
  if (searchParams.get("include_scenario") !== "1" || !data.family) return null;

  return runWhatIfScenario({
    scenarioType: searchParams.get("scenario_type") === "sell" ? "sell" : "buy",
    familyId: data.family.id,
    accountId: searchParams.get("account_id") ?? "",
    assetId: searchParams.get("asset_id") ?? "",
    tradeDate: searchParams.get("trade_date") ?? "",
    quantity: numeric(searchParams.get("quantity")),
    price: numeric(searchParams.get("price")),
    currencyCode: searchParams.get("currency_code") ?? data.family.baseCurrency,
    commission: numeric(searchParams.get("commission")),
    sourceRecommendationId: searchParams.get("source_recommendation_id"),
  }, {
    familyId: data.family.id,
    accounts: data.accounts,
    assets: data.assets,
    operations: data.operations,
    positionSnapshots: data.positionSnapshots,
    positions: data.positions,
    cashBalances: data.cashBalances,
    limits: data.limits,
    baseCurrency: data.family.baseCurrency,
  });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const family = await getActiveFamily(supabase, userId);
  const data = await getPortfolioData(supabase, family);
  if (!data.family) return NextResponse.json({ error: "family_not_found" }, { status: 404 });

  const searchParams = request.nextUrl.searchParams;
  const exportRequest = parsePortfolioExportRequest(searchParams);
  const scopeError = validatePortfolioExportScope(data, exportRequest.scope);
  if (scopeError) {
    return NextResponse.json({ error: scopeError, message: exportRequestErrorMessage(scopeError) }, { status: 400 });
  }
  const scenario = scenarioFromSearchParams(searchParams, data);
  const viewModel = buildPortfolioExportViewModel({ data, scenario, scope: exportRequest.scope });
  const format = exportRequest.format;

  await supabase.from("audit_log").insert({
    family_id: data.family.id,
    actor_user_id: userId,
    action: "export_portfolio_report",
    entity_table: "portfolio_exports",
    before_data: null,
    after_data: buildPortfolioExportAuditPayload({
      format,
      generatedAt: viewModel.generatedAt,
      scenario,
      scope: exportRequest.scope,
      sheets: viewModel.sheets.map((sheet) => sheet.name),
      warningsCount: viewModel.warnings.length,
    }),
  });

  if (format === "pdf-html") {
    return new NextResponse(buildPortfolioReportHtml(viewModel), {
      headers: {
        "Content-Disposition": `attachment; filename="${viewModel.fileBaseName}.html"`,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  const buffer = buildPortfolioExcelBuffer(viewModel);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Disposition": `attachment; filename="${viewModel.fileBaseName}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
