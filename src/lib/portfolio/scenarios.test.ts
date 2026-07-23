import { describe, expect, it } from "vitest";
import { calculateCashBalances, calculatePositions, type CalculationAccount, type CalculationAsset, type CalculationOperation, type CalculationPositionSnapshot } from "./calculations";
import { runWhatIfScenario, type WhatIfScenarioContext } from "./scenarios";

const familyId = "family-1";

const accounts: CalculationAccount[] = [
  {
    id: "account-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    name: "Брокерский счет",
    currency_code: "RUB",
  },
];

const assets: CalculationAsset[] = [
  {
    id: "asset-stock-1",
    family_id: familyId,
    asset_type_code: "stock",
    name: "Демо-акция",
    ticker: "DEMO",
    currency_code: "RUB",
  },
  {
    id: "asset-cash-rub",
    family_id: familyId,
    asset_type_code: "cash",
    name: "Российский рубль",
    ticker: "RUB",
    currency_code: "RUB",
  },
];

function operation(overrides: Partial<CalculationOperation>): CalculationOperation {
  return {
    id: overrides.id ?? "operation-1",
    family_id: familyId,
    account_id: "account-1",
    asset_id: "asset-stock-1",
    trade_date: "2026-07-10",
    operation_type_code: "buy",
    quantity: 0,
    price: null,
    gross_amount: 0,
    fee_amount: 0,
    tax_amount: 0,
    net_amount: 0,
    currency_code: "RUB",
    ...overrides,
  };
}

function snapshot(overrides: Partial<CalculationPositionSnapshot>): CalculationPositionSnapshot {
  return {
    id: overrides.id ?? "snapshot-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    asset_id: "asset-stock-1",
    snapshot_date: "2026-07-10",
    quantity: 0,
    book_value_amount: 0,
    market_value_amount: null,
    currency_code: "RUB",
    source: "import",
    ...overrides,
  };
}

function context(overrides: Partial<WhatIfScenarioContext> = {}): WhatIfScenarioContext {
  const operations: CalculationOperation[] = [
    operation({
      id: "deposit-1",
      asset_id: null,
      operation_type_code: "deposit",
      trade_date: "2026-07-11",
      net_amount: 5000,
    }),
    operation({
      id: "buy-1",
      operation_type_code: "buy",
      trade_date: "2026-07-12",
      quantity: 10,
      price: 100,
      gross_amount: 1000,
      fee_amount: 0,
      net_amount: -1000,
    }),
  ];

  return {
    familyId,
    accounts,
    assets,
    operations,
    positionSnapshots: [],
    positions: [],
    cashBalances: [],
    limits: [],
    baseCurrency: "RUB",
    ...overrides,
  };
}

function calculatedContext(overrides: Partial<WhatIfScenarioContext> = {}): WhatIfScenarioContext {
  const { positions, cashBalances, ...baseOverrides } = overrides;
  const base = context(baseOverrides);
  return {
    ...base,
    positions: calculatePositions(base.operations, base.accounts, base.assets, base.positionSnapshots, familyId),
    cashBalances: calculateCashBalances(base.operations, base.accounts, base.assets, base.positionSnapshots, familyId),
    ...(positions ? { positions } : {}),
    ...(cashBalances ? { cashBalances } : {}),
  };
}

describe("runWhatIfScenario", () => {
  it("models a buy without changing source operations", () => {
    const base = calculatedContext();
    const result = runWhatIfScenario({
      scenarioType: "buy",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 5,
      price: 110,
      currencyCode: "RUB",
      commission: 10,
    }, base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(base.operations).toHaveLength(2);
    expect(result.virtualOperation.net_amount).toBe(-560);
    expect(result.after.positions[0].quantity).toBe(15);
    expect(result.after.cashBalances[0].balance).toBe(3440);
    expect(result.metrics.find((metric) => metric.label === "Количество актива")?.delta).toBe(5);
  });

  it("models a sell and includes commission in cash", () => {
    const result = runWhatIfScenario({
      scenarioType: "sell",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 4,
      price: 120,
      currencyCode: "RUB",
      commission: 5,
    }, calculatedContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.virtualOperation.net_amount).toBe(475);
    expect(result.after.positions[0].quantity).toBe(6);
    expect(result.after.cashBalances[0].balance).toBe(4475);
  });

  it("rejects a buy when cash is insufficient", () => {
    const result = runWhatIfScenario({
      scenarioType: "buy",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 100,
      price: 100,
      currencyCode: "RUB",
      commission: 0,
    }, calculatedContext());

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "cash-insufficient", severity: "error" }));
  });

  it("rejects a sell when position is insufficient", () => {
    const result = runWhatIfScenario({
      scenarioType: "sell",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 11,
      price: 100,
      currencyCode: "RUB",
      commission: 0,
    }, calculatedContext());

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "position-insufficient", severity: "error" }));
  });

  it("marks non-base currency scenarios as partial", () => {
    const result = runWhatIfScenario({
      scenarioType: "buy",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 1,
      price: 100,
      currencyCode: "USD",
      commission: 0,
    }, calculatedContext({
      cashBalances: [
        {
          id: "cash-usd",
          family_id: familyId,
          portfolio_id: "portfolio-1",
          account_id: "account-1",
          account_name: "Брокерский счет",
          currency_code: "USD",
          balance: 1000,
          snapshot_date: null,
          net_cash_flow: 0,
        },
      ],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "missing-fx-rate", severity: "warning" }));
  });

  it("evaluates limits before and after the scenario", () => {
    const result = runWhatIfScenario({
      scenarioType: "buy",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 5,
      price: 100,
      currencyCode: "RUB",
      commission: 0,
    }, calculatedContext({
      limits: [{
        id: "cash-limit",
        limit_type: "cash_min_share",
        scope_key: null,
        threshold_value: 0.75,
        direction: "min",
        severity: "warning",
        status: "active",
      }],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.before.limitCheck.violations).toHaveLength(0);
    expect(result.after.limitCheck.violations).toHaveLength(1);
  });

  it("can use imported snapshots as current context", () => {
    const base = calculatedContext({
      operations: [],
      positionSnapshots: [
        snapshot({
          id: "stock-snapshot",
          quantity: 10,
          book_value_amount: 1000,
          market_value_amount: 1200,
        }),
        snapshot({
          id: "cash-snapshot",
          asset_id: "asset-cash-rub",
          quantity: 3000,
          book_value_amount: 3000,
          market_value_amount: 3000,
        }),
      ],
    });

    const result = runWhatIfScenario({
      scenarioType: "sell",
      familyId,
      accountId: "account-1",
      assetId: "asset-stock-1",
      tradeDate: "2026-07-20",
      quantity: 2,
      price: 130,
      currencyCode: "RUB",
      commission: 0,
    }, base);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.after.positions[0].quantity).toBe(8);
    expect(result.after.cashBalances[0].balance).toBe(3260);
  });
});
