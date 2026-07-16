import * as XLSX from "xlsx";

export type ParsedBrokerImportRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown>;
  status: "normalized" | "skipped" | "failed";
  errorMessage: string | null;
};

type SheetRow = unknown[];

const currencyNameToCode: Record<string, string> = {
  рубль: "RUB",
  рубли: "RUB",
  rub: "RUB",
  usd: "USD",
  eur: "EUR",
  cny: "CNY",
  hkd: "HKD",
};

const cashOperationTypeMap: Array<[RegExp, string]> = [
  [/погашение\s+купона/i, "coupon"],
  [/купон/i, "coupon"],
  [/дивиденд/i, "dividend"],
  [/налог/i, "tax"],
  [/комисс/i, "fee"],
  [/зачислен|пополнен/i, "deposit"],
  [/списан|вывод/i, "withdrawal"],
];

function cellText(row: SheetRow | undefined, index: number) {
  const value = row?.[index];
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function rowText(row: SheetRow | undefined) {
  return (row ?? []).map((value) => (value === null || value === undefined ? "" : String(value))).join(" ");
}

function isBlankRow(row: SheetRow | undefined) {
  return !row || row.every((value) => cellText([value], 0) === "");
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value === null || value === undefined) return null;

  const text = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/%/g, "")
    .trim();
  if (!text) return null;

  const compact = text.replace(/\s+/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = compact.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = compact.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const decimals = compact.length - lastComma - 1;
    normalized = decimals === 3 ? compact.replace(/,/g, "") : compact.replace(",", ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return `${year}-${month}-${day}`;
}

function parseCurrency(value: unknown) {
  const text = String(value ?? "").trim();
  const upper = text.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;

  const lower = text.toLowerCase();
  return currencyNameToCode[lower] ?? null;
}

function parseSectionCurrency(title: string) {
  const match = title.match(/\(([^)]+)\)/);
  return parseCurrency(match?.[1] ?? "");
}

function looksLikeIsin(value: string) {
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value.trim().toUpperCase());
}

function assetTypeFromBcs(value: string) {
  const text = value.toLowerCase();
  if (/обл/.test(text)) return "bond";
  if (/пай|etf|бпиф|пиф/.test(text)) return "fund";
  if (/ао|ап|акц/.test(text)) return "stock";
  return "other";
}

function operationTypeFromBcs(value: string) {
  for (const [pattern, type] of cashOperationTypeMap) {
    if (pattern.test(value)) return type;
  }
  return "other";
}

function skippedRow(rowNumber: number, section: string, reason: string, raw: Record<string, unknown> = {}): ParsedBrokerImportRow {
  return {
    rowNumber,
    raw: {
      broker: "bcs",
      section,
      source_row_number: rowNumber,
      skip_reason: reason,
      ...raw,
    },
    normalized: {
      row_type: "skipped",
      reason,
    },
    status: "skipped",
    errorMessage: null,
  };
}

function snapshotStatus(snapshotDate: string | null, currency: string | null) {
  if (!snapshotDate) return { status: "failed" as const, errorMessage: "Snapshot date was not found in report" };
  if (!currency) return { status: "failed" as const, errorMessage: "Unknown report section currency" };
  return { status: "normalized" as const, errorMessage: null };
}

function reportEndDate(rows: SheetRow[]) {
  const fxHeaderIndex = rows.findIndex((row) => /курсы валют/i.test(cellText(row, 0)));
  if (fxHeaderIndex >= 0) {
    const candidate = parseDate(cellText(rows[fxHeaderIndex], 3)) ?? parseDate(cellText(rows[fxHeaderIndex], 1));
    if (candidate) return candidate;
  }

  for (const row of rows) {
    for (const value of row) {
      const date = parseDate(value);
      if (date) return date;
    }
  }

  return null;
}

function parseCashOperations(rows: SheetRow[]) {
  const parsed: ParsedBrokerImportRow[] = [];
  const headerIndex = rows.findIndex((row) => {
    const text = rowText(row).toLowerCase();
    return text.includes("дата") && text.includes("операция") && text.includes("сумма зачисления");
  });
  if (headerIndex < 0) return parsed;

  let currency = "RUB";

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const first = cellText(row, 0);
    const operation = cellText(row, 1);

    if (/итого по валюте/i.test(first)) {
      const currencyMatch = first.match(/итого по валюте\s+(.+):?/i);
      currency = parseCurrency(currencyMatch?.[1]?.replace(/:$/, "") ?? "") ?? currency;
      parsed.push(skippedRow(index + 1, "cash_operations", "Currency subtotal row", { label: first }));
      break;
    }
    if (/итого/i.test(operation) || /итого/i.test(first)) continue;
    if (!parseDate(first) || !operation) {
      if (isBlankRow(row)) break;
      parsed.push(skippedRow(index + 1, "cash_operations", "Non-operation row", { row_text: rowText(row) }));
      continue;
    }

    const credit = parseNumber(row[5]);
    const debit = parseNumber(row[6]);
    const amount = credit ?? debit;
    if (amount === null) {
      parsed.push(skippedRow(index + 1, "cash_operations", "Operation row without amount", { date: first, operation }));
      continue;
    }

    const note = cellText(row, 13);
    const isin = looksLikeIsin(note) ? note.toUpperCase() : null;
    const operationType = operationTypeFromBcs(operation);

    parsed.push({
      rowNumber: index + 1,
      raw: {
        broker: "bcs",
        section: "cash_operations",
        source_row_number: index + 1,
        date: first,
        operation,
        credit_amount: credit,
        debit_amount: debit,
        market: cellText(row, 11) || null,
        note: note || null,
      },
      normalized: {
        row_type: "cash_operation",
        trade_date: parseDate(first),
        operation_type: operationType,
        ticker: isin,
        isin,
        asset_name: isin,
        market: cellText(row, 11) || null,
        quantity: null,
        price: null,
        gross_amount: Math.abs(amount),
        fee_amount: 0,
        tax_amount: 0,
        currency,
        asset_type: operationType === "coupon" ? "bond" : "other",
        notes: operation,
      },
      status: "normalized",
      errorMessage: null,
    });
  }

  return parsed;
}

function parseHoldingSnapshots(rows: SheetRow[], snapshotDate: string | null) {
  const parsed: ParsedBrokerImportRow[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const title = cellText(rows[index], 0);
    if (!/^портфель по ценным бумагам/i.test(title)) continue;

    const currency = parseSectionCurrency(title);
    const headerIndex = index + 1;
    if (!/вид актива/i.test(cellText(rows[headerIndex], 0))) continue;

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const assetCode = cellText(row, 0);
      if (!assetCode) break;
      if (/^итого/i.test(assetCode)) break;
      if (/^портфель по ценным бумагам/i.test(assetCode)) break;

      const identifier = cellText(row, 2);
      const assetTypeText = cellText(row, 4);
      const cashCurrency = parseCurrency(assetCode);
      const isCashAsset = Boolean(cashCurrency) && !assetTypeText;

      if (isCashAsset && cashCurrency) {
        const beginBalance = parseNumber(row[8]);
        const endBalance = parseNumber(row[12]) ?? beginBalance;
        if (endBalance === null) continue;

        parsed.push({
          rowNumber: rowIndex + 1,
          raw: {
            broker: "bcs",
            section: "cash_balance_snapshots",
            source_row_number: rowIndex + 1,
            report_section_currency: currency,
            currency: cashCurrency,
            begin_balance: beginBalance,
            end_balance: endBalance,
            market: cellText(row, 13) || null,
            custody_place: cellText(row, 14) || null,
          },
          normalized: {
            row_type: "holding_snapshot",
            snapshot_date: snapshotDate,
            ticker: cashCurrency,
            isin: null,
            asset_name: `${cashCurrency} cash`,
            asset_type: "cash",
            market: cellText(row, 13) || null,
            quantity: endBalance,
            price: 1,
            accrued_interest_amount: null,
            book_value_amount: endBalance,
            market_value_amount: endBalance,
            currency: cashCurrency,
            security_identifier: null,
            custody_place: cellText(row, 14) || null,
          },
          status: snapshotDate ? "normalized" : "failed",
          errorMessage: snapshotDate ? null : "Snapshot date was not found in report",
        });
        continue;
      }

      const endQuantity = parseNumber(row[9]);
      const endPrice = parseNumber(row[10]);
      const endAccruedInterest = parseNumber(row[11]);
      const endMarketValue = parseNumber(row[12]);
      const issuer = cellText(row, 15);

      if (endQuantity === null || endMarketValue === null) {
        parsed.push(skippedRow(rowIndex + 1, "holding_snapshots", "Holding row without quantity or market value", { asset_code: assetCode }));
        continue;
      }

      const ticker = assetCode.toUpperCase();
      const isin = looksLikeIsin(identifier) ? identifier.toUpperCase() : looksLikeIsin(ticker) ? ticker : null;
      const assetType = assetTypeFromBcs(assetTypeText);

      const status = snapshotStatus(snapshotDate, currency);

      parsed.push({
        rowNumber: rowIndex + 1,
        raw: {
          broker: "bcs",
          section: "holding_snapshots",
          source_row_number: rowIndex + 1,
          report_section_currency: currency,
          asset_code: assetCode,
          security_identifier: identifier || null,
          asset_type: assetTypeText || null,
          begin_quantity: parseNumber(row[5]),
          begin_price: parseNumber(row[6]),
          begin_accrued_interest: parseNumber(row[7]),
          begin_market_value: parseNumber(row[8]),
          end_quantity: endQuantity,
          end_price: endPrice,
          end_accrued_interest: endAccruedInterest,
          end_market_value: endMarketValue,
          market: cellText(row, 13) || null,
          custody_place: cellText(row, 14) || null,
          issuer: issuer || null,
        },
        normalized: {
          row_type: "holding_snapshot",
          snapshot_date: snapshotDate,
          ticker,
          isin,
          asset_name: issuer || ticker,
          asset_type: assetType,
          market: cellText(row, 13) || null,
          quantity: endQuantity,
          price: endPrice,
          accrued_interest_amount: endAccruedInterest,
          book_value_amount: parseNumber(row[8]),
          market_value_amount: endMarketValue,
          currency,
          security_identifier: identifier || null,
          custody_place: cellText(row, 14) || null,
        },
        status: status.status,
        errorMessage: status.errorMessage,
      });
    }
  }

  return parsed;
}

function parseFxRates(rows: SheetRow[]) {
  const parsed: ParsedBrokerImportRow[] = [];
  const headerIndex = rows.findIndex((row) => /курсы валют/i.test(cellText(row, 0)));
  if (headerIndex < 0) return parsed;

  const startDate = parseDate(cellText(rows[headerIndex], 1));
  const endDate = parseDate(cellText(rows[headerIndex], 3));

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const code = parseCurrency(cellText(rows[index], 0));
    if (!code) break;

    parsed.push({
      rowNumber: index + 1,
      raw: {
        broker: "bcs",
        section: "fx_rates",
        source_row_number: index + 1,
        currency: code,
        start_date: startDate,
        start_rate: parseNumber(rows[index][1]),
        end_date: endDate,
        end_rate: parseNumber(rows[index][3]),
      },
      normalized: {
        row_type: "fx_rate",
        currency: code,
        rate_date: endDate,
        rate_to_rub: parseNumber(rows[index][3]),
      },
      status: endDate && parseNumber(rows[index][3]) !== null ? "normalized" : "failed",
      errorMessage: endDate && parseNumber(rows[index][3]) !== null ? null : "FX rate date or value is missing",
    });
  }

  return parsed;
}

export function parseBcsExcelReport(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : null;
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<SheetRow>(sheet, {
    header: 1,
    defval: null,
    raw: false,
  });
  const snapshotDate = reportEndDate(rows);

  return [
    ...parseCashOperations(rows),
    ...parseHoldingSnapshots(rows, snapshotDate),
    ...parseFxRates(rows),
  ].sort((left, right) => left.rowNumber - right.rowNumber);
}
