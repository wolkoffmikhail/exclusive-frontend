"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { endOfMonth, format, startOfMonth } from "date-fns"
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

type LiabilityRegistryApiRow = {
  liability_movement_id: string
  operation_date: string
  instrument_name: string
  instrument_type: string
  contract_number: string | null
  contract_date: string | null
  contract_descriptor: string | null
  rate_text: string | null
  gl_account_group: string
  lender_name: string
  lender_type: string | null
  component_type: string
  movement_type: string
  amount: number | string | null
  currency_code: string | null
  debit_account_code: string | null
  credit_account_code: string | null
  comment: string | null
  external_ref: string | null
}

type LiabilityBalanceApiRow = {
  liability_instrument_id: string
  instrument_name: string
  instrument_type: string
  contract_number: string | null
  contract_date: string | null
  contract_descriptor: string | null
  rate_text: string | null
  gl_account_group: string
  liability_party_id: string
  lender_name: string
  lender_type: string | null
  snapshot_date: string
  principal_balance: number | string | null
  interest_balance: number | string | null
  total_balance: number | string | null
  currency_code: string | null
}

interface LiabilityRegistryRow {
  operation_date: string
  lender_name: string
  instrument_name: string
  instrument_type_label: string
  component_type_label: string
  movement_type_label: string
  amount: number
  debit_credit: string
  external_ref: string | null
  comment: string | null
  [key: string]: unknown
}

type LiabilityBalanceCard = {
  liability_instrument_id: string
  instrument_name: string
  lender_name: string
  instrument_type: string
  instrument_type_label: string
  principal_balance: number
  interest_balance: number
  total_balance: number
  snapshot_date: string
}

const PAGE_SIZE = 20

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 2,
  }).format(value)
}

function normalizeLiabilityAmount(value: number | string | null | undefined) {
  return Math.abs(Number(value) || 0)
}

function cleanInstrumentName(value: string) {
  return value
    .replace(/^Bank loan:\s*/i, "")
    .replace(/^Loan:\s*/i, "")
    .trim()
}

function instrumentTypeLabel(value: string) {
  switch (value) {
    case "bank_loan":
      return "Банковский кредит"
    case "intercompany_loan":
      return "Займ компании"
    case "shareholder_loan":
      return "Займ физлица"
    case "cession_loan":
      return "Займ по цессии"
    case "other_loan":
      return "Прочий займ"
    default:
      return value
  }
}

function componentTypeLabel(value: string) {
  switch (value) {
    case "principal":
      return "Тело"
    case "interest":
      return "Проценты"
    default:
      return value
  }
}

function movementTypeLabel(value: string) {
  switch (value) {
    case "accrual":
      return "Начисление"
    case "payment":
      return "Выплата процентов"
    case "principal_repayment":
      return "Погашение тела"
    case "reclassification":
      return "Переклассификация"
    case "other":
      return "Прочее"
    case "opening_balance":
      return "Входящий остаток"
    default:
      return value
  }
}

export default function LiabilitiesPage() {
  const now = new Date()
  const [from, setFrom] = useState(format(startOfMonth(now), "yyyy-MM-dd"))
  const [to, setTo] = useState(format(endOfMonth(now), "yyyy-MM-dd"))
  const [instrumentType, setInstrumentType] = useState<string>("all")
  const [componentType, setComponentType] = useState<string>("all")
  const [movementType, setMovementType] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState("operation_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [loading, setLoading] = useState(true)

  const [registryRows, setRegistryRows] = useState<LiabilityRegistryApiRow[]>([])
  const [balanceRows, setBalanceRows] = useState<LiabilityBalanceApiRow[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const registryPromise = supabase
      .from("v_liability_registry")
      .select(
        "liability_movement_id, operation_date, instrument_name, instrument_type, contract_number, contract_date, contract_descriptor, rate_text, gl_account_group, lender_name, lender_type, component_type, movement_type, amount, currency_code, debit_account_code, credit_account_code, comment, external_ref"
      )
      .gte("operation_date", from)
      .lte("operation_date", to)
      .order("operation_date", { ascending: false })

    const balancesPromise = supabase
      .from("v_liability_balance_summary")
      .select(
        "liability_instrument_id, instrument_name, instrument_type, contract_number, contract_date, contract_descriptor, rate_text, gl_account_group, liability_party_id, lender_name, lender_type, snapshot_date, principal_balance, interest_balance, total_balance, currency_code"
      )
      .order("total_balance", { ascending: false })

    const [registryRes, balancesRes] = await Promise.all([
      registryPromise,
      balancesPromise,
    ])

    setRegistryRows((registryRes.data ?? []) as LiabilityRegistryApiRow[])
    setBalanceRows((balancesRes.data ?? []) as LiabilityBalanceApiRow[])
    setLoading(false)
  }, [from, to])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [from, to, instrumentType, componentType, movementType])

  const filteredRegistry = useMemo(() => {
    return registryRows.filter((row) => {
      if (instrumentType !== "all" && row.instrument_type !== instrumentType) {
        return false
      }
      if (componentType !== "all" && row.component_type !== componentType) {
        return false
      }
      if (movementType !== "all" && row.movement_type !== movementType) {
        return false
      }
      return true
    })
  }, [registryRows, instrumentType, componentType, movementType])

  const sortedRegistry = useMemo(() => {
    const mapped: LiabilityRegistryRow[] = filteredRegistry.map((row) => ({
      operation_date: row.operation_date,
      lender_name: row.lender_name,
      instrument_name: cleanInstrumentName(row.instrument_name),
      instrument_type_label: instrumentTypeLabel(row.instrument_type),
      component_type_label: componentTypeLabel(row.component_type),
      movement_type_label: movementTypeLabel(row.movement_type),
      amount: normalizeLiabilityAmount(row.amount),
      debit_credit: `${row.debit_account_code ?? "-"} / ${row.credit_account_code ?? "-"}`,
      external_ref: row.external_ref ?? null,
      comment: row.comment ?? null,
    }))

    mapped.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1
      if (sortKey === "amount") {
        return (a.amount - b.amount) * direction
      }
      const aValue = String(a[sortKey as keyof LiabilityRegistryRow] ?? "")
      const bValue = String(b[sortKey as keyof LiabilityRegistryRow] ?? "")
      return aValue.localeCompare(bValue) * direction
    })

    return mapped
  }, [filteredRegistry, sortDir, sortKey])

  const filteredBalances = useMemo(() => {
    return balanceRows
      .filter((row) => {
        if (instrumentType !== "all" && row.instrument_type !== instrumentType) {
          return false
        }
        return true
      })
      .map((row) => ({
        liability_instrument_id: row.liability_instrument_id,
        instrument_name: cleanInstrumentName(row.instrument_name),
        lender_name: row.lender_name,
        instrument_type: row.instrument_type,
        instrument_type_label: instrumentTypeLabel(row.instrument_type),
        principal_balance: normalizeLiabilityAmount(row.principal_balance),
        interest_balance: normalizeLiabilityAmount(row.interest_balance),
        total_balance: normalizeLiabilityAmount(row.total_balance),
        snapshot_date: row.snapshot_date,
      }))
  }, [balanceRows, instrumentType])

  const kpis = useMemo(() => {
    const principalRepaid = filteredRegistry
      .filter(
        (row) =>
          row.component_type === "principal" &&
          row.movement_type === "principal_repayment"
      )
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)

    const interestPaid = filteredRegistry
      .filter(
        (row) => row.component_type === "interest" && row.movement_type === "payment"
      )
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)

    const interestAccrued = filteredRegistry
      .filter(
        (row) => row.component_type === "interest" && row.movement_type === "accrual"
      )
      .reduce((sum, row) => sum + (Number(row.amount) || 0), 0)

    const endingBalance = filteredBalances.reduce(
      (sum, row) => sum + row.total_balance,
      0
    )

    return {
      principalRepaid,
      interestPaid,
      interestAccrued,
      endingBalance,
    }
  }, [filteredRegistry, filteredBalances])

  const pagedRows = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return sortedRegistry.slice(offset, offset + PAGE_SIZE)
  }, [page, sortedRegistry])

  const columns: Column<LiabilityRegistryRow>[] = [
    { key: "operation_date", label: "Дата", sortable: true },
    { key: "lender_name", label: "Кредитор", sortable: true },
    { key: "instrument_name", label: "Инструмент", sortable: true },
    { key: "component_type_label", label: "Компонент", sortable: true },
    { key: "movement_type_label", label: "Тип движения", sortable: true },
    {
      key: "amount",
      label: "Сумма",
      sortable: true,
      render: (row) => (
        <span className="font-mono">{formatCurrency(row.amount)}</span>
      ),
    },
    { key: "debit_credit", label: "Дт / Кт" },
    { key: "external_ref", label: "Документ" },
    { key: "comment", label: "Комментарий" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Кредиты и займы</h1>
        <p className="text-sm text-muted-foreground">
          Отдельный контур обязательств по счету 67: тело, проценты, выплаты и остатки.
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
          <Label className="text-xs text-muted-foreground">Тип инструмента</Label>
          <Select value={instrumentType} onValueChange={setInstrumentType}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Все инструменты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все инструменты</SelectItem>
              <SelectItem value="bank_loan">Банковские кредиты</SelectItem>
              <SelectItem value="intercompany_loan">Займы компаний</SelectItem>
              <SelectItem value="shareholder_loan">Займы физлиц</SelectItem>
              <SelectItem value="cession_loan">Займы по цессии</SelectItem>
              <SelectItem value="other_loan">Прочие займы</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Компонент</Label>
          <Select value={componentType} onValueChange={setComponentType}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Все компоненты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все компоненты</SelectItem>
              <SelectItem value="principal">Тело</SelectItem>
              <SelectItem value="interest">Проценты</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Тип движения</Label>
          <Select value={movementType} onValueChange={setMovementType}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Все движения" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все движения</SelectItem>
              <SelectItem value="accrual">Начисление</SelectItem>
              <SelectItem value="payment">Выплата процентов</SelectItem>
              <SelectItem value="principal_repayment">Погашение тела</SelectItem>
              <SelectItem value="reclassification">Переклассификация</SelectItem>
              <SelectItem value="other">Прочее</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Погашение тела за период</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(kpis.principalRepaid)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Выплачено процентов</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(kpis.interestPaid)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Начислено процентов</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(kpis.interestAccrued)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="gap-1">
            <CardDescription>Остаток обязательств на конец периода</CardDescription>
            <CardTitle className="text-2xl">
              {formatCurrency(kpis.endingBalance)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {filteredBalances.map((card) => (
          <Card key={card.liability_instrument_id}>
            <CardHeader className="gap-1">
              <CardDescription>{card.instrument_type_label}</CardDescription>
              <CardTitle>{card.instrument_name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Кредитор</span>
                <span className="font-medium">{card.lender_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Тело</span>
                <span className="font-mono">{formatCurrency(card.principal_balance)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Проценты</span>
                <span className="font-mono">{formatCurrency(card.interest_balance)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Итого</span>
                <span className="font-mono font-medium">
                  {formatCurrency(card.total_balance)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Дата среза</span>
                <span>{card.snapshot_date}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="gap-4">
        <CardHeader className="gap-1">
          <CardTitle>Реестр движений по обязательствам</CardTitle>
          <CardDescription>
            В таблице показываются начисления, выплаты процентов, погашение тела и
            бухгалтерские переклассификации по счету 67.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable<LiabilityRegistryRow>
            columns={columns}
            data={pagedRows}
            totalCount={sortedRegistry.length}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onSort={(key, direction) => {
              setSortKey(key)
              setSortDir(direction)
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
