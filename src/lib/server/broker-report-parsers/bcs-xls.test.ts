import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseBcsExcelReport } from "./bcs-xls";

function workbookBuffer(rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Лист_1");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

describe("parseBcsExcelReport", () => {
  it("extracts cash operations, holding snapshots and fx rows from a BCS-like sheet", () => {
    const buffer = workbookBuffer([
      ["Дата", "Операция", null, null, null, "Сумма зачисления", "Сумма списания", "В т.ч.НДС (руб.)", "Остаток (+/-)", null, null, "Площадка", null, "Примечание"],
      ["02.07.26", "Погашение купона", null, null, null, "2,539.98", "", "", null, null, null, "ММВБ", null, "RU000A10ATC4"],
      ["", "Итого:", null, null, null, "2,539.98"],
      ["Итого по валюте Рубль:", null, null, null, null, "2,539.98"],
      [],
      ["Курсы валют:", "01.07.2026", null, "02.07.2026"],
      ["USD", "78.2696", null, "78.2652"],
      [],
      ["Портфель по ценным бумагам, денежным средствам и ДМ (Рубль)", null, null, null, null, "на начало периода", null, null, null, "на конец периода"],
      [
        "Вид актива",
        null,
        "Номер гос. регистрации ЦБ/ ISIN",
        null,
        "Тип актива (для ЦБ - № вып.)",
        "Кол-во ЦБ / Масса ДМ (шт/г)",
        "Цена закрытия",
        "Сумма НКД",
        "Сумма, в т.ч. НКД",
        "Кол-во ЦБ / Масса ДМ (шт/г)",
        "Цена закрытия",
        "Сумма НКД",
        "Сумма, в т.ч. НКД",
        "Организатор торгов (2*)",
        "Место хранения",
        "Эмитент",
      ],
      ["RU000A10ATC4", null, "4B02-07-11915-A-001P", null, "Обл.", "10", "100.00 %", null, "1,000.00", "10", "102.00 %", "12.34", "1,032.34", "ММВБ", "Торг.(НРД)", "ПАО Тест"],
      ["Итого:", null, null, null, null, null, null, null, "1,000.00", null, null, null, "1,032.34"],
    ]);

    const rows = parseBcsExcelReport(buffer);
    const normalizedRows = rows.filter((row) => row.status === "normalized");
    const fxRows = rows.filter((row) => row.normalized.row_type === "fx_rate");

    expect(normalizedRows).toHaveLength(3);
    expect(fxRows).toHaveLength(1);
    expect(normalizedRows[0].normalized).toMatchObject({
      row_type: "cash_operation",
      trade_date: "2026-07-02",
      operation_type: "coupon",
      gross_amount: 2539.98,
      currency: "RUB",
      isin: "RU000A10ATC4",
    });
    expect(normalizedRows.find((row) => row.normalized.row_type === "holding_snapshot")?.normalized).toMatchObject({
      row_type: "holding_snapshot",
      snapshot_date: "2026-07-02",
      ticker: "RU000A10ATC4",
      isin: "RU000A10ATC4",
      asset_type: "bond",
      quantity: 10,
      market_value_amount: 1032.34,
      currency: "RUB",
    });
    expect(fxRows[0].status).toBe("normalized");
    expect(fxRows[0].normalized).toMatchObject({
      row_type: "fx_rate",
      currency: "USD",
      rate_date: "2026-07-02",
      rate_to_rub: 78.2652,
    });
  });
});
