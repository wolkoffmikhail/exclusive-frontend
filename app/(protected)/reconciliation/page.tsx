"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { DateRangePicker } from "@/components/date-range-picker"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { useSharedPeriod } from "@/lib/use-shared-period"

type AccountRow = {
  account_id: string
  account_name: string
  account_type: string | null
  include_in_operating_reports: boolean | null
}

type CashInRow = {
  income_date: string
  amount: number | string | null
}

type CashOutRow = {
  payment_date: string
  amount: number | string | null
}

type BalanceSnapshotRow = {
  account_id: string
  snapshot_date: string
  balance: number | string | null
}

type LiabilitySnapshotRow = {
  liability_instrument_id: string
  snapshot_date: string
  component_type: string
  balance: number | string | null
}

type ReconciliationMonthRow = {
  monthKey: string
  monthLabel: string
  cashIn: number
  cashOut: number
  netCashflow: number
  operatingBalance: number
  depositBalance: number
  liabilityBalance: number
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

function normalizeAmount(value: number | string | null | undefined) {
  return Number(value) || 0
}

function getMonthKey(dateText: string) {
  return dateText.slice(0, 7)
}

function getMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number)
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1))
}

function buildMonthRange(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number)
  const [toYear, toMonth] = to.split("-").map(Number)
  const cursor = new Date(fromYear, fromMonth - 1, 1)
  const end = new Date(toYear, toMonth - 1, 1)
  const months: string[] = []

  while (cursor <= end) {
    months.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`
    )
    cursor.setMonth(cursor.getMonth() + 1)
  }

  return months
}

function getMonthEnd(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number)
  return new Date(year, month, 0).toISOString().slice(0, 10)
}

function getLatestAccountBalancesByMonth(
  monthKeys: string[],
  accountIds: string[],
  snapshots: BalanceSnapshotRow[]
) {
  const result = new Map<string, number>()
  const relevant = snapshots
    .filter((row) => accountIds.includes(row.account_id))
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))

  for (const monthKey of monthKeys) {
    const monthEnd = getMonthEnd(monthKey)
    const latestByAccount = new Map<string, number>()

    for (const row of relevant) {
      if (row.snapshot_date > monthEnd) {
        break
      }
      latestByAccount.set(row.account_id, normalizeAmount(row.balance))
    }

    result.set(
      monthKey,
      [...latestByAccount.values()].reduce((sum, value) => sum + value, 0)
    )
  }

  return result
}

function getLatestLiabilityBalancesByMonth(
  monthKeys: string[],
  snapshots: LiabilitySnapshotRow[]
) {
  const result = new Map<string, number>()
  const relevant = [...snapshots].sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date)
  )

  for (const monthKey of monthKeys) {
    const monthEnd = getMonthEnd(monthKey)
    const latestByInstrumentComponent = new Map<string, number>()

    for (const row of relevant) {
      if (row.snapshot_date > monthEnd) {
        break
      }
      latestByInstrumentComponent.set(
        `${row.liability_instrument_id}|${row.component_type}`,
        Math.abs(normalizeAmount(row.balance))
      )
    }

    result.set(
      monthKey,
      [...latestByInstrumentComponent.values()].reduce((sum, value) => sum + value, 0)
    )
  }

  return result
}

export default function ReconciliationPage() {
  const { from, to, setFrom, setTo, ready } = useSharedPeriod()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<ReconciliationMonthRow[]>([])
  const [kpis, setKpis] = useState({
    cashIn: 0,
    cashOut: 0,
    netCashflow: 0,
    endingOperatingBalance: 0,
    endingDepositBalance: 0,
    endingLiabilityBalance: 0,
  })
  const [coverage, setCoverage] = useState({
    operatingSnapshots: 0,
    depositSnapshots: 0,
    liabilitySnapshots: 0,
  })

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const supabase = createClient()

    const [
      accountsRes,
      incomeRes,
      expenseRes,
      balanceRes,
      liabilityRes,
    ] = await Promise.all([
      supabase
        .from("dim_account")
        .select("account_id, account_name, account_type, include_in_operating_reports"),
      supabase
        .from("fct_cash_in")
        .select("income_date, amount")
        .gte("income_date", from)
        .lte("income_date", to),
      supabase
        .from("fct_cash_out")
        .select("payment_date, amount")
        .gte("payment_date", from)
        .lte("payment_date", to),
      supabase
        .from("fct_balance_snapshot")
        .select("account_id, snapshot_date, balance")
        .lte("snapshot_date", to),
      supabase
        .from("fct_liability_snapshot")
        .select("liability_instrument_id, snapshot_date, component_type, balance")
        .lte("snapshot_date", to),
    ])

    const accounts = (accountsRes.data ?? []) as AccountRow[]
    const incomeRows = (incomeRes.data ?? []) as CashInRow[]
    const expenseRows = (expenseRes.data ?? []) as CashOutRow[]
    const balanceRows = (balanceRes.data ?? []) as BalanceSnapshotRow[]
    const liabilityRows = (liabilityRes.data ?? []) as LiabilitySnapshotRow[]

    const operatingAccountIds = accounts
      .filter((account) => account.include_in_operating_reports !== false)
      .map((account) => account.account_id)

    const bankAndCashAccountIds = accounts
      .filter(
        (account) =>
          account.include_in_operating_reports !== false &&
          (account.account_type === "bank" || account.account_type === "cash")
      )
      .map((account) => account.account_id)

    const depositAccountIds = accounts
      .filter((account) => account.account_type === "deposit")
      .map((account) => account.account_id)

    const monthKeys = buildMonthRange(from, to)
    const monthlyCashIn = new Map<string, number>()
    const monthlyCashOut = new Map<string, number>()

    for (const row of incomeRows) {
      const monthKey = getMonthKey(row.income_date)
      monthlyCashIn.set(monthKey, (monthlyCashIn.get(monthKey) ?? 0) + normalizeAmount(row.amount))
    }

    for (const row of expenseRows) {
      const monthKey = getMonthKey(row.payment_date)
      monthlyCashOut.set(monthKey, (monthlyCashOut.get(monthKey) ?? 0) + normalizeAmount(row.amount))
    }

    const operatingBalancesByMonth = getLatestAccountBalancesByMonth(
      monthKeys,
      bankAndCashAccountIds,
      balanceRows
    )
    const depositBalancesByMonth = getLatestAccountBalancesByMonth(
      monthKeys,
      depositAccountIds,
      balanceRows
    )
    const liabilityBalancesByMonth = getLatestLiabilityBalancesByMonth(
      monthKeys,
      liabilityRows
    )

    const monthlyRows = monthKeys.map((monthKey) => {
      const cashIn = monthlyCashIn.get(monthKey) ?? 0
      const cashOut = monthlyCashOut.get(monthKey) ?? 0
      return {
        monthKey,
        monthLabel: getMonthLabel(monthKey),
        cashIn,
        cashOut,
        netCashflow: cashIn - cashOut,
        operatingBalance: operatingBalancesByMonth.get(monthKey) ?? 0,
        depositBalance: depositBalancesByMonth.get(monthKey) ?? 0,
        liabilityBalance: liabilityBalancesByMonth.get(monthKey) ?? 0,
      }
    })

    const latestRow = monthlyRows[monthlyRows.length - 1]

    setRows(monthlyRows)
    setKpis({
      cashIn: incomeRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0),
      cashOut: expenseRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0),
      netCashflow:
        incomeRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0) -
        expenseRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0),
      endingOperatingBalance: latestRow?.operatingBalance ?? 0,
      endingDepositBalance: latestRow?.depositBalance ?? 0,
      endingLiabilityBalance: latestRow?.liabilityBalance ?? 0,
    })
    setCoverage({
      operatingSnapshots: balanceRows.filter((row) => operatingAccountIds.includes(row.account_id))
        .length,
      depositSnapshots: balanceRows.filter((row) => depositAccountIds.includes(row.account_id))
        .length,
      liabilitySnapshots: liabilityRows.length,
    })
    setLoading(false)
  }, [from, to, ready])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const monthsWithoutOperatingBalance = useMemo(
    () => rows.filter((row) => row.operatingBalance === 0),
    [rows]
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Сверка данных</h1>
        <p className="text-sm text-muted-foreground">
          Контрольный слой по импорту 50 / 51 / 55 / 67: месячный cashflow, остатки и
          обязательства в одном месте.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <DateRangePicker
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />
      </div>

      {monthsWithoutOperatingBalance.length > 0 ? (
        <Alert>
          <AlertTitle>Проверь месяцы без операционного остатка</AlertTitle>
          <AlertDescription>
            В выбранном диапазоне есть месяцы, где сумма остатков по расчетному счету и кассе
            равна нулю:{" "}
            {monthsWithoutOperatingBalance.map((row) => row.monthLabel).join(", ")}.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Поступления за период</CardDescription>
            <CardTitle>{loading ? "—" : formatCurrency(kpis.cashIn)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Платежи за период</CardDescription>
            <CardTitle>{loading ? "—" : formatCurrency(kpis.cashOut)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Чистый cashflow</CardDescription>
            <CardTitle>{loading ? "—" : formatCurrency(kpis.netCashflow)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Операционный остаток на конец</CardDescription>
            <CardTitle>
              {loading ? "—" : formatCurrency(kpis.endingOperatingBalance)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Депозиты на конец</CardDescription>
            <CardTitle>{loading ? "—" : formatCurrency(kpis.endingDepositBalance)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Обязательства на конец</CardDescription>
            <CardTitle>
              {loading ? "—" : formatCurrency(kpis.endingLiabilityBalance)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Срезы по 50 / 51</CardDescription>
            <CardTitle>{coverage.operatingSnapshots}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Срезы по 55</CardDescription>
            <CardTitle>{coverage.depositSnapshots}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Срезы по 67</CardDescription>
            <CardTitle>{coverage.liabilitySnapshots}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Месячная сводка</CardTitle>
          <CardDescription>
            По каждому месяцу видно приток, отток, чистый cashflow, операционный остаток,
            депозиты и обязательства.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Месяц</th>
                  <th className="px-3 py-2 font-medium">Поступления</th>
                  <th className="px-3 py-2 font-medium">Платежи</th>
                  <th className="px-3 py-2 font-medium">Чистый cashflow</th>
                  <th className="px-3 py-2 font-medium">Остаток 50 / 51</th>
                  <th className="px-3 py-2 font-medium">Остаток 55</th>
                  <th className="px-3 py-2 font-medium">Остаток 67</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.monthKey} className="border-b align-top">
                    <td className="px-3 py-3 font-medium">{row.monthLabel}</td>
                    <td className="px-3 py-3 font-mono">{formatCurrency(row.cashIn)}</td>
                    <td className="px-3 py-3 font-mono">{formatCurrency(row.cashOut)}</td>
                    <td className="px-3 py-3">
                      <Badge variant={row.netCashflow >= 0 ? "default" : "destructive"}>
                        {formatCurrency(row.netCashflow)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {formatCurrency(row.operatingBalance)}
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {formatCurrency(row.depositBalance)}
                    </td>
                    <td className="px-3 py-3 font-mono">
                      {formatCurrency(row.liabilityBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
