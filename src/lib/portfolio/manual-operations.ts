import type { CalculatedCashBalance, CalculatedPosition } from "./calculations";

export type ManualOperationType = "deposit" | "withdrawal" | "buy" | "sell" | "fx" | "transfer_in" | "transfer_out";

export type ManualOperationInput = {
  operationType: ManualOperationType;
  familyId: string;
  portfolioId: string;
  accountId: string;
  assetId?: string | null;
  tradeDate: string;
  settleDate?: string | null;
  quantity?: number | null;
  price?: number | null;
  amount?: number | null;
  feeAmount?: number | null;
  taxAmount?: number | null;
  currencyCode: string;
  notes?: string | null;
  userId: string;
};

export type ManualOperationRecord = {
  family_id: string;
  portfolio_id: string;
  account_id: string;
  asset_id: string | null;
  operation_type_code: ManualOperationType;
  trade_date: string;
  settle_date: string | null;
  quantity: number | null;
  price: number | null;
  gross_amount: number;
  fee_amount: number;
  tax_amount: number;
  net_amount: number;
  currency_code: string;
  source: "manual";
  operation_group_id?: string | null;
  notes: string | null;
  occurred_at: string;
  created_by: string;
  updated_by: string;
  metadata: Record<string, unknown>;
};

export type ManualOperationValidationContext = {
  cashBalances: CalculatedCashBalance[];
  positions: CalculatedPosition[];
};

export type ManualOperationResult =
  | { ok: true; record: ManualOperationRecord }
  | { ok: false; code: string };

export type CancellableOperation = {
  source?: string | null;
  cancelled_at?: string | null;
};

export type ManualFxInput = {
  familyId: string;
  portfolioId: string;
  accountId: string;
  tradeDate: string;
  fromCurrencyCode: string;
  fromAmount: number | null;
  toCurrencyCode: string;
  toAmount: number | null;
  feeAmount?: number | null;
  notes?: string | null;
  userId: string;
  operationGroupId: string;
};

export type ManualCashTransferInput = {
  familyId: string;
  fromPortfolioId: string;
  toPortfolioId: string;
  fromAccountId: string;
  toAccountId: string;
  tradeDate: string;
  currencyCode: string;
  amount: number | null;
  notes?: string | null;
  userId: string;
  operationGroupId: string;
};

export type ManualOperationPairResult =
  | { ok: true; records: [ManualOperationRecord, ManualOperationRecord] }
  | { ok: false; code: string };

const moneyOperationTypes = new Set<ManualOperationType>(["deposit", "withdrawal"]);
const securityOperationTypes = new Set<ManualOperationType>(["buy", "sell"]);

export function parsePositiveDecimal(value: FormDataEntryValue | null | undefined) {
  const normalized = String(value ?? "").replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parseOptionalPositiveDecimal(value: FormDataEntryValue | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return parsePositiveDecimal(text);
}

export function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function money(value: number | null | undefined) {
  return value ?? 0;
}

function grossAmount(input: ManualOperationInput) {
  if (moneyOperationTypes.has(input.operationType)) return money(input.amount);
  return money(input.quantity) * money(input.price);
}

function netAmount(input: ManualOperationInput) {
  const gross = grossAmount(input);
  const fees = money(input.feeAmount) + money(input.taxAmount);

  if (input.operationType === "buy" || input.operationType === "withdrawal") {
    return -Math.abs(gross + fees);
  }

  return Math.abs(gross - fees);
}

export function availableCash(cashBalances: CalculatedCashBalance[], accountId: string, currencyCode: string) {
  return cashBalances
    .filter((balance) => balance.account_id === accountId && balance.currency_code === currencyCode)
    .reduce((total, balance) => total + balance.balance, 0);
}

export function availablePositionQuantity(positions: CalculatedPosition[], accountId: string, assetId: string, currencyCode: string) {
  return positions
    .filter((position) => position.account_id === accountId && position.asset_id === assetId && position.currency_code === currencyCode)
    .reduce((total, position) => total + position.quantity, 0);
}

export function buildManualOperationRecord(input: ManualOperationInput, context: ManualOperationValidationContext): ManualOperationResult {
  if (!input.familyId || !input.portfolioId || !input.accountId || !input.userId) return { ok: false, code: "context-required" };
  if (!isIsoDate(input.tradeDate)) return { ok: false, code: "date-required" };
  if (input.settleDate && !isIsoDate(input.settleDate)) return { ok: false, code: "settle-date-invalid" };

  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  if (!/^[A-Z]{3}$/.test(currencyCode)) return { ok: false, code: "currency-invalid" };

  const feeAmount = money(input.feeAmount);
  const taxAmount = money(input.taxAmount);
  if (feeAmount < 0 || taxAmount < 0) return { ok: false, code: "costs-invalid" };

  if (moneyOperationTypes.has(input.operationType)) {
    if (!input.amount || input.amount <= 0) return { ok: false, code: "amount-required" };
  }

  if (securityOperationTypes.has(input.operationType)) {
    if (!input.assetId) return { ok: false, code: "asset-required" };
    if (!input.quantity || input.quantity <= 0) return { ok: false, code: "quantity-required" };
    if (!input.price || input.price <= 0) return { ok: false, code: "price-required" };
  }

  const gross = grossAmount(input);
  const net = netAmount(input);

  if (input.operationType === "withdrawal" && availableCash(context.cashBalances, input.accountId, currencyCode) < Math.abs(net)) {
    return { ok: false, code: "cash-insufficient" };
  }

  if (input.operationType === "buy" && availableCash(context.cashBalances, input.accountId, currencyCode) < Math.abs(net)) {
    return { ok: false, code: "cash-insufficient" };
  }

  if (
    input.operationType === "sell"
    && input.assetId
    && availablePositionQuantity(context.positions, input.accountId, input.assetId, currencyCode) < money(input.quantity)
  ) {
    return { ok: false, code: "position-insufficient" };
  }

  return {
    ok: true,
    record: {
      family_id: input.familyId,
      portfolio_id: input.portfolioId,
      account_id: input.accountId,
      asset_id: input.assetId ?? null,
      operation_type_code: input.operationType,
      trade_date: input.tradeDate,
      settle_date: input.settleDate ?? null,
      quantity: securityOperationTypes.has(input.operationType) ? input.quantity ?? null : null,
      price: securityOperationTypes.has(input.operationType) ? input.price ?? null : null,
      gross_amount: gross,
      fee_amount: feeAmount,
      tax_amount: taxAmount,
      net_amount: net,
      currency_code: currencyCode,
      source: "manual",
      notes: input.notes?.trim() || null,
      occurred_at: `${input.tradeDate}T00:00:00.000Z`,
      created_by: input.userId,
      updated_by: input.userId,
      metadata: {},
    },
  };
}

export function canCancelManualOperation(operation: CancellableOperation | null | undefined) {
  return operation?.source === "manual" && !operation.cancelled_at;
}

function basePairRecord({
  accountId,
  currencyCode,
  familyId,
  netAmount,
  notes,
  operationGroupId,
  operationType,
  portfolioId,
  tradeDate,
  userId,
  metadata,
}: {
  accountId: string;
  currencyCode: string;
  familyId: string;
  netAmount: number;
  notes?: string | null;
  operationGroupId: string;
  operationType: "fx" | "transfer_in" | "transfer_out";
  portfolioId: string;
  tradeDate: string;
  userId: string;
  metadata: Record<string, unknown>;
}): ManualOperationRecord {
  return {
    family_id: familyId,
    portfolio_id: portfolioId,
    account_id: accountId,
    asset_id: null,
    operation_type_code: operationType,
    trade_date: tradeDate,
    settle_date: null,
    quantity: null,
    price: null,
    gross_amount: Math.abs(netAmount),
    fee_amount: 0,
    tax_amount: 0,
    net_amount: netAmount,
    currency_code: currencyCode,
    source: "manual",
    operation_group_id: operationGroupId,
    notes: notes?.trim() || null,
    occurred_at: `${tradeDate}T00:00:00.000Z`,
    created_by: userId,
    updated_by: userId,
    metadata,
  };
}

export function buildManualFxOperationRecords(input: ManualFxInput, context: ManualOperationValidationContext): ManualOperationPairResult {
  if (!input.familyId || !input.portfolioId || !input.accountId || !input.userId || !input.operationGroupId) return { ok: false, code: "context-required" };
  if (!isIsoDate(input.tradeDate)) return { ok: false, code: "date-required" };

  const fromCurrencyCode = normalizeCurrencyCode(input.fromCurrencyCode);
  const toCurrencyCode = normalizeCurrencyCode(input.toCurrencyCode);
  if (!/^[A-Z]{3}$/.test(fromCurrencyCode) || !/^[A-Z]{3}$/.test(toCurrencyCode)) return { ok: false, code: "currency-invalid" };
  if (fromCurrencyCode === toCurrencyCode) return { ok: false, code: "fx-currency-same" };
  if (!input.fromAmount || input.fromAmount <= 0) return { ok: false, code: "amount-required" };
  if (!input.toAmount || input.toAmount <= 0) return { ok: false, code: "target-amount-required" };

  const feeAmount = money(input.feeAmount);
  if (feeAmount < 0) return { ok: false, code: "costs-invalid" };

  const totalDebit = input.fromAmount + feeAmount;
  if (availableCash(context.cashBalances, input.accountId, fromCurrencyCode) < totalDebit) {
    return { ok: false, code: "cash-insufficient" };
  }

  const rate = input.toAmount / input.fromAmount;
  const metadata = {
    kind: "fx",
    from_currency: fromCurrencyCode,
    to_currency: toCurrencyCode,
    from_amount: input.fromAmount,
    to_amount: input.toAmount,
    fee_amount: feeAmount,
    rate,
  };

  return {
    ok: true,
    records: [
      {
        ...basePairRecord({
          accountId: input.accountId,
          currencyCode: fromCurrencyCode,
          familyId: input.familyId,
          netAmount: -Math.abs(totalDebit),
          notes: input.notes,
          operationGroupId: input.operationGroupId,
          operationType: "fx",
          portfolioId: input.portfolioId,
          tradeDate: input.tradeDate,
          userId: input.userId,
          metadata,
        }),
        gross_amount: input.fromAmount,
        fee_amount: feeAmount,
      },
      basePairRecord({
        accountId: input.accountId,
        currencyCode: toCurrencyCode,
        familyId: input.familyId,
        netAmount: Math.abs(input.toAmount),
        notes: input.notes,
        operationGroupId: input.operationGroupId,
        operationType: "fx",
        portfolioId: input.portfolioId,
        tradeDate: input.tradeDate,
        userId: input.userId,
        metadata,
      }),
    ],
  };
}

export function buildManualCashTransferRecords(input: ManualCashTransferInput, context: ManualOperationValidationContext): ManualOperationPairResult {
  if (!input.familyId || !input.fromPortfolioId || !input.toPortfolioId || !input.fromAccountId || !input.toAccountId || !input.userId || !input.operationGroupId) return { ok: false, code: "context-required" };
  if (input.fromAccountId === input.toAccountId) return { ok: false, code: "transfer-account-same" };
  if (!isIsoDate(input.tradeDate)) return { ok: false, code: "date-required" };

  const currencyCode = normalizeCurrencyCode(input.currencyCode);
  if (!/^[A-Z]{3}$/.test(currencyCode)) return { ok: false, code: "currency-invalid" };
  if (!input.amount || input.amount <= 0) return { ok: false, code: "amount-required" };
  if (availableCash(context.cashBalances, input.fromAccountId, currencyCode) < input.amount) return { ok: false, code: "cash-insufficient" };

  const metadata = {
    kind: "cash_transfer",
    from_account_id: input.fromAccountId,
    to_account_id: input.toAccountId,
    currency: currencyCode,
    amount: input.amount,
  };

  return {
    ok: true,
    records: [
      basePairRecord({
        accountId: input.fromAccountId,
        currencyCode,
        familyId: input.familyId,
        netAmount: -Math.abs(input.amount),
        notes: input.notes,
        operationGroupId: input.operationGroupId,
        operationType: "transfer_out",
        portfolioId: input.fromPortfolioId,
        tradeDate: input.tradeDate,
        userId: input.userId,
        metadata,
      }),
      basePairRecord({
        accountId: input.toAccountId,
        currencyCode,
        familyId: input.familyId,
        netAmount: Math.abs(input.amount),
        notes: input.notes,
        operationGroupId: input.operationGroupId,
        operationType: "transfer_in",
        portfolioId: input.toPortfolioId,
        tradeDate: input.tradeDate,
        userId: input.userId,
        metadata,
      }),
    ],
  };
}
