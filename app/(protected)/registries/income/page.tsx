"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { DataTable, type Column } from "@/components/data-table"
import { DateRangePicker } from "@/components/date-range-picker"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { format, startOfMonth, endOfMonth } from "date-fns"

interface IncomeRow {
  income_date: string
  amount: number
  income_article_name: string | null
  payer_name: string | null
  recipient_name: string | null
  account_name: string | null
  comment: string | null
  [key: string]: unknown
}

type IncomeArticleLookupRow = {
  income_article_id: string | null
  income_name: string | null
  include_in_operating_reports?: boolean | null
}

type EntityLookupRow = {
  entity_id: string | null
  entity_name: string | null
}

type IncomeRegistryApiRow = {
  income_date: string
  amount: number | string | null
  income_article_name: string | null
  payer_name: string | null
  recipient_name: string | null
  account_name: string | null
  comment: string | null
}

const PAGE_SIZE = 20

export default function IncomeRegistryPage() {
  const now = new Date()
  const [from, setFrom] = useState(format(startOfMonth(now), "yyyy-MM-dd"))
  const [to, setTo] = useState(format(endOfMonth(now), "yyyy-MM-dd"))
  const [incomeArticleId, setIncomeArticleId] = useState<string>("all")
  const [payerEntityId, setPayerEntityId] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState("income_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [data, setData] = useState<IncomeRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [articles, setArticles] = useState<{ id: string; name: string }[]>([])
  const [payers, setPayers] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from("dim_income_article")
        .select("income_article_id, income_name, include_in_operating_reports")
        .eq("include_in_operating_reports", true)
        .order("income_name"),
      supabase
        .from("dim_entity")
        .select("entity_id, entity_name")
        .order("entity_name"),
    ]).then(([artRes, entRes]) => {
      setArticles(
        ((artRes.data ?? []) as IncomeArticleLookupRow[]).map((row) => ({
          id: String(row.income_article_id ?? ""),
          name: row.income_name ?? "",
        }))
      )
      setPayers(
        ((entRes.data ?? []) as EntityLookupRow[]).map((row) => ({
          id: String(row.entity_id ?? ""),
          name: row.entity_name ?? "",
        }))
      )
    })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const offset = (page - 1) * PAGE_SIZE

    let query = supabase
      .from("v_income_registry")
      .select(
        "income_date, amount, income_article_id, income_article_name, payer_entity_id, payer_name, recipient_name, account_name, comment",
        { count: "exact" }
      )
      .gte("income_date", from)
      .lte("income_date", to)
      .order(sortKey as "income_date", { ascending: sortDir === "asc" })
      .range(offset, offset + PAGE_SIZE - 1)

    if (incomeArticleId !== "all") {
      query = query.eq("income_article_id", incomeArticleId)
    }
    if (payerEntityId !== "all") {
      query = query.eq("payer_entity_id", payerEntityId)
    }

    const { data: rows, count } = await query

    setData(
      ((rows ?? []) as IncomeRegistryApiRow[]).map((row) => ({
        income_date: row.income_date,
        amount: Number(row.amount) || 0,
        income_article_name: row.income_article_name ?? null,
        payer_name: row.payer_name ?? null,
        recipient_name: row.recipient_name ?? null,
        account_name: row.account_name ?? null,
        comment: row.comment ?? null,
      }))
    )
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [from, to, incomeArticleId, payerEntityId, page, sortKey, sortDir])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [from, to, incomeArticleId, payerEntityId])

  const columns: Column<IncomeRow>[] = [
    { key: "income_date", label: "Дата", sortable: true },
    {
      key: "amount",
      label: "Сумма",
      sortable: true,
      render: (row) => (
        <span className="font-mono">
          {new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            minimumFractionDigits: 2,
          }).format(row.amount)}
        </span>
      ),
    },
    { key: "income_article_name", label: "Статья поступлений" },
    { key: "payer_name", label: "Контрагент" },
    { key: "recipient_name", label: "Получатель" },
    { key: "account_name", label: "Счет" },
    { key: "comment", label: "Комментарий" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Реестр поступлений</h1>
        <p className="text-sm text-muted-foreground">
          Поступления по выбранным фильтрам.
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
          <Label className="text-xs text-muted-foreground">
            Статья поступления
          </Label>
          <Select value={incomeArticleId} onValueChange={setIncomeArticleId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Все статьи" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статьи</SelectItem>
              {articles.map((article) => (
                <SelectItem key={article.id} value={article.id}>
                  {article.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Контрагент</Label>
          <Select value={payerEntityId} onValueChange={setPayerEntityId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Все контрагенты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все контрагенты</SelectItem>
              {payers.map((payer) => (
                <SelectItem key={payer.id} value={payer.id}>
                  {payer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        totalCount={totalCount}
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
    </div>
  )
}
