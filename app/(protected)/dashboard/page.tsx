"use client"

import { useCallback, useEffect, useState } from "react"
import { Wallet, ArrowDownLeft, ArrowUpRight, TrendingUp } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { KpiCard } from "@/components/kpi-card"
import { DateRangePicker } from "@/components/date-range-picker"
import { CashflowChart } from "@/components/cashflow-chart"
import { TopExpensesTable } from "@/components/top-expenses-table"
import { useSharedPeriod } from "@/lib/use-shared-period"

type ChartRow = { dt: string; inflow: number; outflow: number; net: number }
type ChartApiRow = {
  dt: string | null
  inflow: number | string | null
  outflow: number | string | null
  net: number | string | null
}
type TopExpenseRow = { expense_code: string; expense_name: string; total: number }
type TopExpenseApiRow = {
  expense_code: string | null
  expense_name: string | null
  total: number | string | null
}
type KpiRow = {
  balance_start: number | string | null
  inflow: number | string | null
  outflow: number | string | null
  net: number | string | null
  balance_end: number | string | null
}

type AccountLookupRow = {
  account_id: string | null
  account_type: string | null
  include_in_operating_reports: boolean | null
}

type SnapshotRow = {
  account_id: string | null
  snapshot_date: string | null
  balance: number | string | null
}

type OperatingBalanceSplit = {
  bank: number
  cash: number
}

function getEmptyBalanceSplit(): OperatingBalanceSplit {
  return { bank: 0, cash: 0 }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function renderBalanceBreakdown(split: OperatingBalanceSplit) {
  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <span>Расчетный счет</span>
        <span className="font-mono">{formatCurrency(split.bank)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Касса</span>
        <span className="font-mono">{formatCurrency(split.cash)}</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t pt-1 text-foreground/80">
        <span>Итого</span>
        <span className="font-mono">{formatCurrency(split.bank + split.cash)}</span>
      </div>
    </div>
  )
}

function calculateSplitForDate(
  targetDate: string,
  accounts: AccountLookupRow[],
  snapshots: SnapshotRow[]
) {
  const latestByAccount = new Map<string, number>()

  for (const row of snapshots) {
    const accountId = String(row.account_id ?? "")
    const snapshotDate = String(row.snapshot_date ?? "")
    if (!accountId || !snapshotDate || snapshotDate > targetDate) continue
    if (latestByAccount.has(accountId)) continue
    latestByAccount.set(accountId, Number(row.balance) || 0)
  }

  return accounts.reduce<OperatingBalanceSplit>((acc, account) => {
    const accountId = String(account.account_id ?? "")
    const amount = latestByAccount.get(accountId) ?? 0
    if (account.account_type === "cash") {
      acc.cash += amount
    } else {
      acc.bank += amount
    }
    return acc
  }, getEmptyBalanceSplit())
}

export default function DashboardPage() {
  const { from, to, setFrom, setTo, ready } = useSharedPeriod()
  const [kpis, setKpis] = useState({
    balance_start: 0,
    inflow: 0,
    outflow: 0,
    net: 0,
    balance_end: 0,
  })
  const [chartData, setChartData] = useState<ChartRow[]>([])
  const [topExpenses, setTopExpenses] = useState<TopExpenseRow[]>([])
  const [balanceSplit, setBalanceSplit] = useState<{
    start: OperatingBalanceSplit
    end: OperatingBalanceSplit
  }>({
    start: getEmptyBalanceSplit(),
    end: getEmptyBalanceSplit(),
  })
  const [loading, setLoading] = useState<boolean>(true)

  const fetchData = useCallback(async () => {
    if (!ready) return
    setLoading(true)
    const supabase = createClient()

    const [kpiRes, chartRes, topExpensesRes, accountsRes] = await Promise.all([
      supabase.rpc("rpc_dashboard_kpis", {
        p_date_from: from,
        p_date_to: to,
      }),
      supabase
        .from("v_cashflow_daily")
        .select("dt, inflow, outflow, net")
        .gte("dt", from)
        .lte("dt", to)
        .order("dt", { ascending: true }),
      supabase.rpc("rpc_top_expenses", {
        p_date_from: from,
        p_date_to: to,
        p_limit: 10,
      }),
      supabase
        .from("dim_account")
        .select("account_id, account_type, include_in_operating_reports")
        .in("account_type", ["bank", "cash"])
        .eq("include_in_operating_reports", true),
    ])

    if (kpiRes.error) console.error("rpc_dashboard_kpis error", kpiRes.error)
    if (chartRes.error) console.error("v_cashflow_daily error", chartRes.error)
    if (topExpensesRes.error) console.error("rpc_top_expenses error", topExpensesRes.error)
    if (accountsRes.error) console.error("dim_account error", accountsRes.error)

    const kpiRow = (kpiRes.data?.[0] ?? null) as KpiRow | null

    setKpis({
      balance_start: Number(kpiRow?.balance_start) || 0,
      inflow: Number(kpiRow?.inflow) || 0,
      outflow: Number(kpiRow?.outflow) || 0,
      net: Number(kpiRow?.net) || 0,
      balance_end: Number(kpiRow?.balance_end) || 0,
    })

    setChartData(
      ((chartRes.data ?? []) as ChartApiRow[]).map((row) => ({
        dt: String(row.dt ?? ""),
        inflow: Number(row.inflow) || 0,
        outflow: Number(row.outflow) || 0,
        net: Number(row.net) || 0,
      }))
    )

    setTopExpenses(
      ((topExpensesRes.data ?? []) as TopExpenseApiRow[]).map((row) => ({
        expense_code: String(row.expense_code ?? ""),
        expense_name: String(row.expense_name ?? row.expense_code ?? ""),
        total: Number(row.total) || 0,
      }))
    )

    const operatingAccounts = ((accountsRes.data ?? []) as AccountLookupRow[]).filter(
      (row) => Boolean(row.account_id)
    )

    if (operatingAccounts.length > 0) {
      const accountIds = operatingAccounts
        .map((row) => String(row.account_id ?? ""))
        .filter(Boolean)

      const { data: snapshotData, error: snapshotError } = await supabase
        .from("fct_balance_snapshot")
        .select("account_id, snapshot_date, balance")
        .in("account_id", accountIds)
        .lte("snapshot_date", to)
        .order("snapshot_date", { ascending: false })

      if (snapshotError) {
        console.error("fct_balance_snapshot error", snapshotError)
        setBalanceSplit({
          start: getEmptyBalanceSplit(),
          end: getEmptyBalanceSplit(),
        })
      } else {
        const snapshots = (snapshotData ?? []) as SnapshotRow[]
        setBalanceSplit({
          start: calculateSplitForDate(from, operatingAccounts, snapshots),
          end: calculateSplitForDate(to, operatingAccounts, snapshots),
        })
      }
    } else {
      setBalanceSplit({
        start: getEmptyBalanceSplit(),
        end: getEmptyBalanceSplit(),
      })
    }

    setLoading(false)
  }, [from, to, ready])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Движение денежных средств за выбранный период.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="text-xs text-muted-foreground">Период</div>
          <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          title="Баланс на начало"
          value={formatCurrency(kpis.balance_start)}
          description={renderBalanceBreakdown(balanceSplit.start)}
          icon={Wallet}
          loading={loading}
        />
        <KpiCard
          title="Поступления"
          value={formatCurrency(kpis.inflow)}
          description="Поступления за период"
          icon={ArrowDownLeft}
          loading={loading}
        />
        <KpiCard
          title="Платежи"
          value={formatCurrency(kpis.outflow)}
          description="Платежи за период"
          icon={ArrowUpRight}
          loading={loading}
        />
        <KpiCard
          title="Чистый поток"
          value={formatCurrency(kpis.net)}
          description="Поступления минус платежи"
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          title="Баланс на конец"
          value={formatCurrency(kpis.balance_end)}
          description={renderBalanceBreakdown(balanceSplit.end)}
          icon={Wallet}
          loading={loading}
        />
      </div>

      <div className="flex flex-col gap-6">
        <CashflowChart data={chartData} loading={loading} />
        <TopExpensesTable data={topExpenses} loading={loading} />
      </div>
    </div>
  )
}
