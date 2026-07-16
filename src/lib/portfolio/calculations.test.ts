import { describe, expect, it } from "vitest";
import { calculateCashBalances, calculateSecurityPositions, type CalculationAccount, type CalculationAsset, type CalculationOperation, type CalculationPositionSnapshot } from "./calculations";

const familyId = "family-1";

const accounts: CalculationAccount[] = [
  {
    id: "account-1",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    name: "Брокерский счёт",
    currency_code: "RUB",
  },
  {
    id: "account-2",
    family_id: familyId,
    portfolio_id: "portfolio-1",
    name: "Второй счёт",
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
    id: overrides.id ?? crypto.randomUUID(),
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
    id: overrides.id ?? crypto.randomUUID(),
    family_id: familyId,
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    asset_id: "asset-stock-1",
    snapshot_date: "2026-07-10",
    quantity: 0,
    book_value_amount: 0,
    market_value_amount: null,
    currency_code: "RUB",
    source: "imported",
    ...overrides,
  };
}

describe("portfolio calculation helpers", () => {
  it("calculates average cost after a manual buy", () => {
    const positions = calculateSecurityPositions(
      [
        operation({
          id: "buy-1",
          operation_type_code: "buy",
          quantity: 10,
          price: 100,
          gross_amount: 1000,
          fee_amount: 10,
          net_amount: -1010,
        }),
      ],
      accounts,
      assets,
      [],
      familyId,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      quantity: 10,
      book_value: 1010,
      average_price: 101,
      net_cash_flow: -1010,
    });
  });

  it("reduces quantity and book value after a sell", () => {
    const positions = calculateSecurityPositions(
      [
        operation({
          id: "buy-1",
          operation_type_code: "buy",
          trade_date: "2026-07-01",
          quantity: 10,
          gross_amount: 1000,
          fee_amount: 0,
          net_amount: -1000,
        }),
        operation({
          id: "sell-1",
          operation_type_code: "sell",
          trade_date: "2026-07-11",
          quantity: 4,
          gross_amount: 480,
          fee_amount: 5,
          net_amount: 475,
        }),
      ],
      accounts,
      assets,
      [],
      familyId,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0].quantity).toBe(6);
    expect(positions[0].average_price).toBe(100);
    expect(positions[0].book_value).toBe(600);
    expect(positions[0].net_cash_flow).toBe(-525);
  });

  it("uses a latest snapshot as baseline and applies later operations", () => {
    const positions = calculateSecurityPositions(
      [
        operation({
          id: "old-buy",
          operation_type_code: "buy",
          trade_date: "2026-07-01",
          quantity: 100,
          gross_amount: 10000,
          net_amount: -10000,
        }),
        operation({
          id: "later-buy",
          operation_type_code: "buy",
          trade_date: "2026-07-12",
          quantity: 5,
          gross_amount: 600,
          net_amount: -600,
        }),
      ],
      accounts,
      assets,
      [
        snapshot({
          id: "snapshot-1",
          snapshot_date: "2026-07-10",
          quantity: 10,
          book_value_amount: 1000,
          market_value_amount: 1200,
        }),
      ],
      familyId,
    );

    expect(positions).toHaveLength(1);
    expect(positions[0].quantity).toBe(15);
    expect(positions[0].book_value).toBe(1600);
    expect(positions[0].market_price).toBe(120);
    expect(positions[0].market_value).toBe(1800);
    expect(positions[0].unrealized_pnl).toBe(200);
  });

  it("calculates cash from operations after an imported cash snapshot", () => {
    const balances = calculateCashBalances(
      [
        operation({
          id: "old-deposit",
          asset_id: null,
          operation_type_code: "deposit",
          trade_date: "2026-07-01",
          net_amount: 10000,
        }),
        operation({
          id: "later-withdrawal",
          asset_id: null,
          operation_type_code: "withdrawal",
          trade_date: "2026-07-12",
          net_amount: -2500,
        }),
      ],
      accounts,
      assets,
      [
        snapshot({
          id: "cash-snapshot-1",
          asset_id: "asset-cash-rub",
          snapshot_date: "2026-07-10",
          quantity: 7000,
          book_value_amount: 7000,
          market_value_amount: 7000,
        }),
      ],
      familyId,
    );

    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      account_id: "account-1",
      currency_code: "RUB",
      balance: 4500,
      net_cash_flow: -2500,
      snapshot_date: "2026-07-10",
    });
  });

  it("keeps cash assets out of security positions", () => {
    const positions = calculateSecurityPositions(
      [],
      accounts,
      assets,
      [
        snapshot({
          id: "cash-snapshot-1",
          asset_id: "asset-cash-rub",
          quantity: 7000,
          book_value_amount: 7000,
          market_value_amount: 7000,
        }),
      ],
      familyId,
    );

    expect(positions).toEqual([]);
  });
});
