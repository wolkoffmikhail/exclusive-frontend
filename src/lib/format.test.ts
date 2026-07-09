import { describe, expect, it } from "vitest";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(value);

describe("русская локаль", () => {
  it("форматирует денежные значения", () => {
    expect(formatMoney(1234.56)).toContain("1 234,56");
  });
});
