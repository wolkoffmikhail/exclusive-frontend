"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { format, startOfMonth, endOfMonth } from "date-fns"
import { createClient } from "@/lib/supabase/client"
import { DateRangePicker } from "@/components/date-range-picker"
import { DataTable, type Column } from "@/components/data-table"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type DepositAccountRow = {
  account_id: string
  account_name: string
  account_type: string | null
  ledger_account_code: string | null
  include_in_operating_reports: boolean | null
}

type BalanceSnapshotRow = {
  account_id: string
  snapshot_date: string
  balance: number | string | null
}

type ExpenseFactRow = {
  cash_out_id: string
  payment_date: string
  amount: number | string | null
  expense_code: string | null
  account_id: string | null
  comment: string | null
  external_ref: string | null
}

type IncomeFactRow = {
  cash_in_id: string
  income_date: string
  amount: number | string | null
  income_article_id: string | null
  account_id: string | null
  comment: string | null
  external_ref: string | null
}

type IncomeArticleLookupRow = {
  income_article_id: string
  income_code: string | null
}

type DepositOperationType = "placement" | "return" | "interest"

interface DepositRegistryRow {
  operation_date: string
  operation_type: DepositOperationType
  operation_type_label: string
  instrument: string
  source_account_name: string | null
  amount: number
  external_ref: string | null
  comment: string | null
  [key: string]: unknown
}

interface DepositBalanceCard {
  account_id: string
  account_name: string
  ledger_account_code: string
  instrument_label: string
  balance: number
  snapshot_date: string | null
}

const PAGE_SIZE = 20

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(value)
}

function operationLabel(type: DepositOperationType) {
  switch (type) {
    case "placement":
      return "Размещение депозита"
    case "return":
      return "Возврат депозита"
    case "interest":
      return "Проценты по депозиту"
    default:
      return type
  }
}

function instrumentLabel(ledgerCode: string) {
  return ledgerCode === "55.01" ? "Аккредитив" : "Депозит"
}

export default function DepositsPage() {
  const now = new Date()
  const [from, setFrom] = useState(format(startOfMonth(now), "yyyy-MM-dd"))
  const [to, setTo] = useState(format(endOfMonth(now), "yyyy-MM-dd"))
  const [operationType, setOperationType] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState("operation_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [loading, setLoading] = useState(true)

  const [rows, setRows] = useState<DepositRegistryRow[]>([])
  const [balanceCards, setBalanceCards] = useState<DepositBalanceCard[]>([])
  const [kpis, setKpis] = useState({
    placed: 0,
    returned: 0,
    interest: 0,
    endingBalance: 0,
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const { data: depositAccountsRaw } = await supabase
      .from("dim_account")
      .select(
        "account_id, account_name, account_type, ledger_account_code, include_in_operating_reports"
      )
      .eq("account_type", "deposit")
      .like("ledger_account_code", "55%")
      .order("ledger_account_code")

    const depositAccounts = (depositAccountsRaw ?? []) as DepositAccountRow[]
    const depositAccountIds = depositAccounts.map((account) => account.account_id)
    const accountNameById = new Map(
      depositAccounts.map((account) => [account.account_id, account.account_name])
    )

    const { data: incomeArticlesRaw } = await supabase
      .from("dim_income_article")
      .select("income_article_id, income_code")
      .in("income_code", ["DEP_RETURN", "DEP_INTEREST"])

    const incomeArticles = (incomeArticlesRaw ?? []) as IncomeArticleLookupRow[]
    const returnArticleIds = incomeArticles
      .filter((row) => row.income_code === "DEP_RETURN")
      .map((row) => row.income_article_id)
    const interestArticleIds = incomeArticles
      .filter((row) => row.income_code === "DEP_INTEREST")
      .map((row) => row.income_article_id)

    const placementPromise = supabase
      .from("fct_cash_out")
      .select(
        "cash_out_id, payment_date, amount, expense_code, account_id, comment, external_ref"
      )
      .eq("expense_code", "DEP-PLACEMENT")
      .gte("payment_date", from)
      .lte("payment_date", to)

    const returnPromise =
      returnArticleIds.length > 0
        ? supabase
            .from("fct_cash_in")
            .select(
              "cash_in_id, income_date, amount, income_article_id, account_id, comment, external_ref"
            )
            .in("income_article_id", returnArticleIds)
            .gte("income_date", from)
            .lte("income_date", to)
        : Promise.resolve({ data: [] as IncomeFactRow[], error: null })

    const interestPromise =
      interestArticleIds.length > 0
        ? supabase
            .from("fct_cash_in")
            .select(
              "cash_in_id, income_date, amount, income_article_id, account_id, comment, external_ref"
            )
            .in("income_article_id", interestArticleIds)
            .gte("income_date", from)
            .lte("income_date", to)
        : Promise.resolve({ data: [] as IncomeFactRow[], error: null })

    const balancesPromise =
      depositAccountIds.length > 0
        ? supabase
            .from("fct_balance_snapshot")
            .select("account_id, snapshot_date, balance")
            .in("account_id", depositAccountIds)
            .lte("snapshot_date", to)
            .order("snapshot_date", { ascending: false })
        : Promise.resolve({ data: [] as BalanceSnapshotRow[], error: null })

    const [placementRes, returnRes, interestRes, balancesRes] = await Promise.all([
      placementPromise,
      returnPromise,
      interestPromise,
      balancesPromise,
    ])

    const placementRows = ((placementRes.data ?? []) as ExpenseFactRow[]).map((row) => ({
      operation_date: row.payment_date,
      operation_type: "placement" as const,
      operation_type_label: operationLabel("placement"),
      instrument: "Депозит",
      source_account_name: row.account_id ? accountNameById.get(row.account_id) ?? null : null,
      amount: Number(row.amount) || 0,
      external_ref: row.external_ref ?? null,
      comment: row.comment ?? null,
    }))

    const returnRows = ((returnRes.data ?? []) as IncomeFactRow[]).map((row) => ({
      operation_date: row.income_date,
      operation_type: "return" as const,
      operation_type_label: operationLabel("return"),
      instrument: "Депозит",
      source_account_name: row.account_id ? accountNameById.get(row.account_id) ?? null : null,
      amount: Number(row.amount) || 0,
      external_ref: row.external_ref ?? null,
      comment: row.comment ?? null,
    }))

    const interestRows = ((interestRes.data ?? []) as IncomeFactRow[]).map((row) => ({
      operation_date: row.income_date,
      operation_type: "interest" as const,
      operation_type_label: operationLabel("interest"),
      instrument: "Депозит",
      source_account_name: row.account_id ? accountNameById.get(row.account_id) ?? null : null,
      amount: Number(row.amount) || 0,
      external_ref: row.external_ref ?? null,
      comment: row.comment ?? null,
    }))

    const mergedRows = [...placementRows, ...returnRows, ...interestRows]

    const latestSnapshotByAccount = new Map<string, BalanceSnapshotRow>()
    for (const row of (balancesRes.data ?? []) as BalanceSnapshotRow[]) {
      if (!latestSnapshotByAccount.has(row.account_id)) {
        latestSnapshotByAccount.set(row.account_id, row)
      }
    }

    const depositBalanceCards = depositAccounts.map((account) => {
      const snapshot = latestSnapshotByAccount.get(account.account_id)
      return {
        account_id: account.account_id,
        account_name: account.account_name,
        ledger_account_code: account.ledger_account_code ?? "",
        instrument_label: instrumentLabel(account.ledger_account_code ?? ""),
        balance: Number(snapshot?.balance) || 0,
        snapshot_date: snapshot?.snapshot_date ?? null,
      }
    })

    setRows(mergedRows)
    setBalanceCards(depositBalanceCards)
    setKpis({
      placed: placementRows.reduce((sum, row) => sum + row.amount, 0),
      returned: returnRows.reduce((sum, row) => sum + row.amount, 0),
      interest: interestRows.reduce((sum, row) => sum + row.amount, 0),
      endingBalance: depositBalanceCards.reduce((sum, row) => sum + row.balance, 0),
    })
    setLoading(false)
  }, [from, to])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [from, to, operationType])

  const filteredRows = useMemo(() => {
    if (operationType === "all") {
      return rows
    }
    return rows.filter((row) => row.operation_type === operationType)
  }, [rows, operationType])

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1
      if (sortKey === "amount") {
        return (a.amount - b.amount) * direction
      }
      const aValue = String(a[sortKey as keyof DepositRegistryRow] ?? "")
      const bValue = String(b[sortKey as keyof DepositRegistryRow] ?? "")
      return aValue.localeCompare(bValue) * direction
    })
    return copy
  }, [filteredRows, sortDir, sortKey])

  const pagedRows = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return sortedRows.slice(offset, offset + PAGE_SIZE)
  }, [page, sortedRows])

  const columns: Column<DepositRegistryRow>[] = [
    { key: "operation_date", label: "Дата", sortable: true },
    { key: "operation_type_label", label: "Тип операции", sortable: true },
    { key: "instrument", label: "Инструмент" },
    { key: "source_account_name", label: "Счет-источник" },
    {
      key: "amount",
      label: "Сумма",
      sortable: true,
      render: (row) => <span className="font-mono">{formatCurrency(row.amount)}</span>,
    },
    { key: "external_ref", label: "Документ" },
    { key: "comment", label: "Комментарий" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Депозиты</h1>
        <p className="text-sm text-muted-foreground">
          Неоперационные размещения, возвраты, проценты и остатки по счетам 55.*
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <DateRangePicker
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Тип операции</Label>
          <Select value={operationType} onValueChange={setOperationType}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Все операции" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все операции</SelectItem>
              <SelectItem value="placement">Размещение депозита</SelectItem>
              <SelectItem value="return">Возврат депозита</SelectItem>
              <SelectItem value="interest">Проценты по депозиту</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Размещено за период</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(kpis.placed)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Возвращено за период</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(kpis.returned)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Проценты за период</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(kpis.interest)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Остаток на конец периода</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(kpis.endingBalance)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {balanceCards.map((card) => (
          <Card key={card.account_id}>
            <CardHeader className="gap-1">
              <CardDescription>{card.instrument_label}</CardDescription>
              <CardTitle>{card.account_name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Субсчет</span>
                <span className="font-medium">{card.ledger_account_code}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Остаток</span>
                <span className="font-mono font-medium">{formatCurrency(card.balance)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Дата среза</span>
                <span>{card.snapshot_date ?? "-"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="gap-4">
        <CardHeader className="gap-1">
          <CardTitle>Реестр депозитных операций</CardTitle>
          <CardDescription>
            Для версии v1 движения по 55.01 отдельно не загружаются, поэтому
            таблица отражает размещения, возвраты и проценты из уже импортированных фактов.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable<DepositRegistryRow>
            columns={columns}
            data={pagedRows}
            totalCount={sortedRows.length}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onSort={(key, dir) => {
              setSortKey(key)
              setSortDir(dir)
            }}
            sortKey={sortKey}
            sortDirection={sortDir}
            loading={loading}
          />
        </CardContent>
      </Card>
    </div>
  )
}
