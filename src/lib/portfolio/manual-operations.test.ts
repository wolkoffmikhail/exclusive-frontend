import { describe, expect, it } from "vitest";
import {
  buildManualCashTransferRecords,
  buildManualFxOperationRecords,
  buildManualOperationRecord,
  canCancelManualOperation,
  parseOptionalPositiveDecimal,
  parsePositiveDecimal,
} from "./manual-operations";
import type { CalculatedCashBalance, CalculatedPosition } from "./calculations";

const cashBalances: CalculatedCashBalance[] = [
  {
    id: "portfolio-1:account-1:RUB",
    family_id: "family-1",
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Брокерский счёт",
    currency_code: "RUB",
    balance: 10_000,
    snapshot_date: null,
    net_cash_flow: 10_000,
  },
];

const positions: CalculatedPosition[] = [
  {
    id: "position-1",
    family_id: "family-1",
    portfolio_id: "portfolio-1",
    account_id: "account-1",
    account_name: "Брокерский счёт",
    asset_id: "asset-1",
    asset_name: "Демо-акция",
    ticker: "DEMO",
    asset_type_code: "stock",
    quantity: 20,
    average_price: 100,
    book_value: 2000,
    market_price: null,
    market_value: null,
    unrealized_pnl: null,
    valuation_date: null,
    net_cash_flow: -2000,
    currency_code: "RUB",
  },
];

const baseInput = {
  familyId: "family-1",
  portfolioId: "portfolio-1",
  accountId: "account-1",
  tradeDate: "2026-07-15",
  currencyCode: "RUB",
  userId: "user-1",
};

describe("manual operation helpers", () => {
  it("parses localized positive decimals", () => {
    expect(parsePositiveDecimal("1 234,56")).toBe(1234.56);
    expect(parseOptionalPositiveDecimal("")).toBe(0);
    expect(parsePositiveDecimal("-1")).toBeNull();
  });

  it("builds a deposit operation", () => {
    const result = buildManualOperationRecord(
      {
        ...baseInput,
        operationType: "deposit",
        amount: 5000,
        notes: "Пополнение",
      },
      { cashBalances, positions },
    );

    expect(result).toMatchObject({
      ok: true,
      record: {
        asset_id: null,
        operation_type_code: "deposit",
        gross_amount: 5000,
        net_amount: 5000,
        source: "manual",
        notes: "Пополнение",
      },
    });
  });

  it("rejects a withdrawal above available cash", () => {
    const result = buildManualOperationRecord(
      {
        ...baseInput,
        operationType: "withdrawal",
        amount: 15_000,
      },
      { cashBalances, positions },
    );

    expect(result).toEqual({ ok: false, code: "cash-insufficient" });
  });

  it("builds a buy operation with fees in net amount", () => {
    const result = buildManualOperationRecord(
      {
        ...baseInput,
        operationType: "buy",
        assetId: "asset-1",
        quantity: 10,
        price: 100,
        feeAmount: 10,
        taxAmount: 5,
      },
      { cashBalances, positions },
    );

    expect(result).toMatchObject({
      ok: true,
      record: {
        asset_id: "asset-1",
        operation_type_code: "buy",
        quantity: 10,
        price: 100,
        gross_amount: 1000,
        fee_amount: 10,
        tax_amount: 5,
        net_amount: -1015,
      },
    });
  });

  it("rejects a sell above available quantity", () => {
    const result = buildManualOperationRecord(
      {
        ...baseInput,
        operationType: "sell",
        assetId: "asset-1",
        quantity: 25,
        price: 120,
      },
      { cashBalances, positions },
    );

    expect(result).toEqual({ ok: false, code: "position-insufficient" });
  });

  it("allows cancelling only active manual operations", () => {
    expect(canCancelManualOperation({ source: "manual", cancelled_at: null })).toBe(true);
    expect(canCancelManualOperation({ source: "import", cancelled_at: null })).toBe(false);
    expect(canCancelManualOperation({ source: "manual", cancelled_at: "2026-07-15T10:00:00Z" })).toBe(false);
    expect(canCancelManualOperation(null)).toBe(false);
  });

  it("builds paired FX operations", () => {
    const result = buildManualFxOperationRecords(
      {
        ...baseInput,
        accountId: "account-1",
        fromCurrencyCode: "RUB",
        fromAmount: 1000,
        toCurrencyCode: "USD",
        toAmount: 10,
        feeAmount: 50,
        operationGroupId: "group-1",
      },
      { cashBalances, positions },
    );

    expect(result).toMatchObject({
      ok: true,
      records: [
        {
          operation_type_code: "fx",
          operation_group_id: "group-1",
          currency_code: "RUB",
          net_amount: -1050,
          fee_amount: 50,
        },
        {
          operation_type_code: "fx",
          operation_group_id: "group-1",
          currency_code: "USD",
          net_amount: 10,
        },
      ],
    });
  });

  it("rejects FX above available source cash", () => {
    const result = buildManualFxOperationRecords(
      {
        ...baseInput,
        fromCurrencyCode: "RUB",
        fromAmount: 20_000,
        toCurrencyCode: "USD",
        toAmount: 200,
        operationGroupId: "group-1",
      },
      { cashBalances, positions },
    );

    expect(result).toEqual({ ok: false, code: "cash-insufficient" });
  });

  it("builds paired cash transfer operations", () => {
    const result = buildManualCashTransferRecords(
      {
        ...baseInput,
        fromPortfolioId: "portfolio-1",
        toPortfolioId: "portfolio-2",
        fromAccountId: "account-1",
        toAccountId: "account-2",
        amount: 3000,
        operationGroupId: "transfer-1",
      },
      { cashBalances, positions },
    );

    expect(result).toMatchObject({
      ok: true,
      records: [
        { operation_type_code: "transfer_out", account_id: "account-1", portfolio_id: "portfolio-1", net_amount: -3000 },
        { operation_type_code: "transfer_in", account_id: "account-2", portfolio_id: "portfolio-2", net_amount: 3000 },
      ],
    });
  });

  it("rejects cash transfer to the same account", () => {
    const result = buildManualCashTransferRecords(
      {
        ...baseInput,
        fromPortfolioId: "portfolio-1",
        toPortfolioId: "portfolio-1",
        fromAccountId: "account-1",
        toAccountId: "account-1",
        amount: 3000,
        operationGroupId: "transfer-1",
      },
      { cashBalances, positions },
    );

    expect(result).toEqual({ ok: false, code: "transfer-account-same" });
  });
});
