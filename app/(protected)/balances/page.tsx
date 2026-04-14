"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { DataTable, type Column } from "@/components/data-table"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface BalanceRow {
  account_name: string | null
  snapshot_date: string
  balance: number
  bank_name: string | null
  owner_entity_name: string | null
  [key: string]: unknown
}

type EntityLookupRow = {
  entity_id: string | null
  entity_name: string | null
}

type BankLookupRow = {
  bank_id: string | null
  bank_name: string | null
}

type BalanceRegistryRow = {
  account_name: string | null
  snapshot_date: string
  balance: number | string | null
  bank_name: string | null
  owner_entity_name: string | null
}

const PAGE_SIZE = 20

export default function BalancesPage() {
  const [ownerEntityId, setOwnerEntityId] = useState<string>("all")
  const [bankId, setBankId] = useState<string>("all")
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState("snapshot_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [data, setData] = useState<BalanceRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const [entities, setEntities] = useState<{ id: string; name: string }[]>([])
  const [banks, setBanks] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from("dim_entity").select("entity_id, entity_name").order("entity_name"),
      supabase.from("dim_bank").select("bank_id, bank_name").order("bank_name"),
    ]).then(([entRes, bankRes]) => {
      setEntities(
        ((entRes.data ?? []) as EntityLookupRow[]).map((row) => ({
          id: String(row.entity_id ?? ""),
          name: row.entity_name ?? "",
        }))
      )
      setBanks(
        ((bankRes.data ?? []) as BankLookupRow[]).map((row) => ({
          id: String(row.bank_id ?? ""),
          name: row.bank_name ?? "",
        }))
      )
    })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const offset = (page - 1) * PAGE_SIZE

    let query = supabase
      .from("v_balances_registry")
      .select(
        "account_id, account_name, snapshot_date, balance, bank_id, bank_name, owner_entity_id, owner_entity_name",
        { count: "exact" }
      )
      .order(sortKey as "snapshot_date", { ascending: sortDir === "asc" })
      .range(offset, offset + PAGE_SIZE - 1)

    if (ownerEntityId !== "all") {
      query = query.eq("owner_entity_id", ownerEntityId)
    }
    if (bankId !== "all") {
      query = query.eq("bank_id", bankId)
    }

    const { data: rows, count } = await query

    setData(
      ((rows ?? []) as BalanceRegistryRow[]).map((row) => ({
        account_name: row.account_name ?? null,
        snapshot_date: row.snapshot_date,
        balance: Number(row.balance) || 0,
        bank_name: row.bank_name ?? null,
        owner_entity_name: row.owner_entity_name ?? null,
      }))
    )
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [ownerEntityId, bankId, page, sortKey, sortDir])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    setPage(1)
  }, [ownerEntityId, bankId])

  const columns: Column<BalanceRow>[] = [
    { key: "account_name", label: "Счет" },
    { key: "snapshot_date", label: "Дата среза", sortable: true },
    {
      key: "balance",
      label: "Остаток",
      sortable: true,
      render: (row) => (
        <span className="font-mono">
          {new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            minimumFractionDigits: 0,
          }).format(row.balance)}
        </span>
      ),
    },
    { key: "bank_name", label: "Банк" },
    { key: "owner_entity_name", label: "Владелец" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Баланс счетов</h1>
        <p className="text-sm text-muted-foreground">
          Актуальные остатки по счетам проекта.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Владелец</Label>
          <Select value={ownerEntityId} onValueChange={setOwnerEntityId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Все владельцы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все владельцы</SelectItem>
              {entities.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>
                  {entity.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Банк</Label>
          <Select value={bankId} onValueChange={setBankId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Все банки" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все банки</SelectItem>
              {banks.map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>
                  {bank.name}
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
