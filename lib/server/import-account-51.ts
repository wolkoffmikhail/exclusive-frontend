import { randomUUID, createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { importMapping, type ExpenseRule, type IncomeRule } from "@/lib/server/import-mapping"
import {
  readWorkbookRows,
  normalizeWorkbookCellDate,
  normalizeWorkbookText,
  type SheetRow,
} from "@/lib/server/xlsx-inspector"

type ParsedIncomeRow = {
  incomeDate: string
  amount: number
  articleCode: string
  articleName: string
  payerName: string | null
  comment: string
  externalRef: string | null
  sourceRowHash: string
}

type ParsedExpenseRow = {
  paymentDate: string
  amount: number
  expenseCode: string
  expenseName: string
  expenseGroup: string
  payeeName: string | null
  comment: string
  externalRef: string | null
  sourceRowHash: string
}

type ParsedBalanceRow = {
  snapshotDate: string
  balance: number
  sourceRowHash: string
}

type ParsedBankCard = {
  ownerName: string
  bankName: string
  accountNumber: string
  incomeRows: ParsedIncomeRow[]
  expenseRows: ParsedExpenseRow[]
  balanceRows: ParsedBalanceRow[]
}

type ImportResult = {
  imported: {
    cashIn: number
    cashOut: number
    balances: number
  }
  skipped: {
    cashIn: number
    cashOut: number
    balances: number
  }
}

const SOURCE_SYSTEM = "bank_statement_1c_web"

function normalizeKey(text: string | null | undefined) {
  return normalizeWorkbookText(text).toUpperCase()
}

function splitLines(text: string | null | undefined) {
  return (text ?? "")
    .split(/\r\n|\r|\n/g)
    .map((item) => normalizeWorkbookText(item))
    .filter(Boolean)
}

function getMeaningfulLines(text: string | null | undefined) {
  return splitLines(text).filter((line) => line !== "<...>")
}

function getArticleFromAnalytics(text: string | null | undefined) {
  const lines = getMeaningfulLines(text)
  if (lines.length >= 2) return lines[1]
  return lines[0] ?? ""
}

function looksLikeEntityName(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  if (!value) return false
  if (/^\d/.test(value)) return false
  if (/Списание с расчетного счета|Поступление на расчетный счет|Поступление \(акт|Документ расчетов/i.test(value)) return false
  if (/Комиссии и услуги банков|Подача воды|Электроэнергия|Аренда оборудования|Организация промоакций|Техобслуживание|Телефония|Вознаграждение агентов|Оплата за выполненные|Обеспечение охраны|Единый налоговый платеж/i.test(value)) return false
  if (/ООО|ИП|АО|ПАО|ГУП|ФГКУ|ФНС|РОССИИ|[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+/u.test(value)) return true
  if (/СБЕРБАНК|ЯНДЕКС|МОСВОД|МОСЭНЕРГО|ЭНЕРГО|КОНСАЛТИНГ|АГЕНТСТВО|МАРШАЛ|НОВОСИСТЕМ|ЭКОДАР/i.test(value)) return true
  return false
}

function extractBankFromAccountLine(text: string | null | undefined) {
  const line = normalizeWorkbookText(text)
  const match = /(\d{20}),\s*(.+)$/.exec(line)
  return match ? normalizeWorkbookText(match[2]) : null
}

function getDocumentRef(text: string | null | undefined) {
  const match = /00БП-\d+/.exec(normalizeWorkbookText(text))
  return match?.[0] ?? null
}

function convertCellDecimal(value: string | null | undefined) {
  const normalized = normalizeWorkbookText(value)
  if (!normalized) return null
  const candidate = normalized.replace(/ /g, "").replace(/\u00A0/g, "").replace(/,/g, ".").replace(/[^0-9.\-]/g, "")
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function getStableHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function matchRule<T extends IncomeRule | ExpenseRule>(
  rawText: string,
  rules: T[],
  fallback: Omit<T, "match">
) {
  const key = normalizeKey(rawText)
  const matched = rules.find((rule) => key.includes(normalizeKey(rule.match)))
  return matched ?? fallback
}

function parseAccount51Workbook(fileBuffer: Buffer) {
  const rows = readWorkbookRows(fileBuffer)
  const ownerName = normalizeWorkbookText(rows[0]?.A) || "OWNER"

  let accountLine = ""
  for (const row of rows) {
    for (const candidate of [row.C, row.D]) {
      if (/\d{20},/.test(candidate ?? "")) {
        accountLine = candidate ?? ""
        break
      }
    }
    if (accountLine) break
  }

  const accountMatch = /(\d{20}),\s*(.+)/.exec(accountLine)
  const accountNumber = accountMatch?.[1] ?? "UNKNOWN-ACCOUNT"
  const bankName = normalizeWorkbookText(accountMatch?.[2]) || "UNKNOWN BANK"

  const openingRow = rows.find((row) => normalizeKey(row.A).startsWith("САЛЬДО НА НАЧАЛО"))
  const movementRows = rows.slice(8).filter((row) => Boolean(normalizeWorkbookCellDate(row.A ?? "")))

  const incomeRows: ParsedIncomeRow[] = []
  const expenseRows: ParsedExpenseRow[] = []
  const dailyClosing = new Map<string, SheetRow>()

  for (const row of movementRows) {
    const date = normalizeWorkbookCellDate(row.A ?? "")
    if (!date) continue

    const rowBalance = convertCellDecimal(row.J)
    if (rowBalance !== null) {
      dailyClosing.set(date, row)
    }

    const debitAccount = normalizeWorkbookText(row.E)
    const creditAccount = normalizeWorkbookText(row.H)
    const debitAmount = convertCellDecimal(row.F)
    const creditAmount = convertCellDecimal(row.I)

    if (debitAccount === "51" && debitAmount !== null) {
      const rawArticle = getArticleFromAnalytics(row.C)
      const rule = matchRule(rawArticle, importMapping.incomeRules, importMapping.incomeFallback)
      let counterparty: string | null = null

      for (const line of getMeaningfulLines(row.D)) {
        if (/00БП-|^№|^Основной$/i.test(line) || /Поступление на расчетный счет/i.test(line)) continue
        if (looksLikeEntityName(line)) {
          counterparty = line
          break
        }
      }

      if (!counterparty) {
        for (const line of getMeaningfulLines(row.D)) {
          const bankFromLine = extractBankFromAccountLine(line)
          if (bankFromLine) {
            counterparty = bankFromLine
            break
          }
        }
      }

      const stable = ["INCOME", date, String(debitAmount), normalizeWorkbookText(row.B), normalizeWorkbookText(row.C), normalizeWorkbookText(row.D), accountNumber].join("|")
      incomeRows.push({
        incomeDate: date,
        amount: debitAmount,
        articleCode: rule.code,
        articleName: rule.name,
        payerName: counterparty,
        comment: normalizeWorkbookText(row.B),
        externalRef: getDocumentRef(row.B),
        sourceRowHash: getStableHash(stable),
      })
      continue
    }

    if (creditAccount === "51" && creditAmount !== null) {
      const rawArticle = getArticleFromAnalytics(row.D)
      const rule = matchRule(rawArticle, importMapping.expenseRules, importMapping.expenseFallback)
      let counterparty: string | null = null

      for (const line of getMeaningfulLines(row.C)) {
        if (looksLikeEntityName(line)) {
          counterparty = line
          break
        }
      }

      if (!counterparty) {
        for (const line of getMeaningfulLines(row.D)) {
          const bankFromLine = extractBankFromAccountLine(line)
          if (bankFromLine) {
            counterparty = bankFromLine
            break
          }
        }
      }

      const stable = ["EXPENSE", date, String(creditAmount), normalizeWorkbookText(row.B), normalizeWorkbookText(row.C), normalizeWorkbookText(row.D), accountNumber].join("|")
      expenseRows.push({
        paymentDate: date,
        amount: creditAmount,
        expenseCode: rule.code,
        expenseName: rule.name,
        expenseGroup: "group" in rule ? rule.group : importMapping.expenseFallback.group,
        payeeName: counterparty,
        comment: normalizeWorkbookText(row.B),
        externalRef: getDocumentRef(row.B),
        sourceRowHash: getStableHash(stable),
      })
    }
  }

  const balanceRows: ParsedBalanceRow[] = []
  const openingBalance = convertCellDecimal(openingRow?.J)
  const firstDate = normalizeWorkbookCellDate(movementRows[0]?.A ?? "")
  if (openingBalance !== null && firstDate) {
    const openingSnapshotDate = new Date(`${firstDate}T00:00:00.000Z`)
    openingSnapshotDate.setUTCDate(openingSnapshotDate.getUTCDate() - 1)
    const snapshotDate = openingSnapshotDate.toISOString().slice(0, 10)
    balanceRows.push({
      snapshotDate,
      balance: openingBalance,
      sourceRowHash: getStableHash(["BALANCE_OPEN", snapshotDate, String(openingBalance), accountNumber].join("|")),
    })
  }

  for (const [date, row] of [...dailyClosing.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const balance = convertCellDecimal(row.J)
    if (balance === null) continue
    balanceRows.push({
      snapshotDate: date,
      balance,
      sourceRowHash: getStableHash(["BALANCE_CLOSE", date, String(balance), accountNumber].join("|")),
    })
  }

  return {
    ownerName,
    bankName,
    accountNumber,
    incomeRows,
    expenseRows,
    balanceRows,
  } satisfies ParsedBankCard
}

async function loadAllRows(client: SupabaseClient, table: string, select: string, filters: Record<string, string> = {}) {
  const pageSize = 1000
  const rows: Record<string, unknown>[] = []
  let offset = 0

  while (true) {
    let query = client.from(table).select(select).range(offset, offset + pageSize - 1)
    for (const [field, value] of Object.entries(filters)) {
      query = query.eq(field, value)
    }
    const { data, error } = await query
    if (error) throw error
    const page = ((data ?? []) as unknown[]) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < pageSize) break
    offset += pageSize
  }

  return rows
}

async function loadNameIdCache(client: SupabaseClient, table: string, idField: string, nameField: string) {
  const cache = new Map<string, string>()
  const rows = await loadAllRows(client, table, `${idField},${nameField}`)
  for (const row of rows) {
    const name = normalizeWorkbookText(String(row[nameField] ?? ""))
    const id = String(row[idField] ?? "")
    if (name && id) cache.set(normalizeKey(name), id)
  }
  return cache
}

async function ensureEntity(client: SupabaseClient, cache: Map<string, string>, name: string | null, role: string) {
  const normalizedName = normalizeWorkbookText(name)
  if (!normalizedName) return null
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing

  const entityId = randomUUID()
  const { error } = await client.from("dim_entity").insert({
    entity_id: entityId,
    entity_name: normalizedName,
    entity_role: role,
    is_active: true,
  })
  if (error) throw error
  cache.set(key, entityId)
  return entityId
}

async function ensureBank(client: SupabaseClient, cache: Map<string, string>, name: string) {
  const normalizedName = normalizeWorkbookText(name)
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing
  const bankId = randomUUID()
  const { error } = await client.from("dim_bank").insert({
    bank_id: bankId,
    bank_name: normalizedName,
    is_active: true,
  })
  if (error) throw error
  cache.set(key, bankId)
  return bankId
}

async function ensureAccount(client: SupabaseClient, cache: Map<string, string>, accountName: string, bankId: string, ownerEntityId: string) {
  const normalizedName = normalizeWorkbookText(accountName)
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing
  const accountId = randomUUID()
  const { error } = await client.from("dim_account").insert({
    account_id: accountId,
    account_name: normalizedName,
    bank_id: bankId,
    owner_entity_id: ownerEntityId,
    currency_code: "RUB",
    is_active: true,
    account_type: "bank",
    ledger_account_code: "51",
    include_in_operating_reports: true,
  })
  if (error) throw error
  cache.set(key, accountId)
  return accountId
}

async function ensureIncomeArticle(client: SupabaseClient, cache: Map<string, string>, name: string, code: string) {
  const key = normalizeKey(name)
  const existing = cache.get(key)
  if (existing) return existing
  const incomeArticleId = randomUUID()
  const { error } = await client.from("dim_income_article").insert({
    income_article_id: incomeArticleId,
    income_name: name,
    income_code: code,
    is_active: true,
    include_in_operating_reports: true,
  })
  if (error) throw error
  cache.set(key, incomeArticleId)
  return incomeArticleId
}

async function ensureExpenseCode(client: SupabaseClient, cache: Map<string, string>, code: string, name: string, group: string) {
  const key = normalizeKey(code)
  const existing = cache.get(key)
  if (existing) return existing
  const { error } = await client.from("dim_expense_code").insert({
    expense_code: code,
    expense_name: name,
    expense_group: group,
    is_active: true,
    include_in_operating_reports: true,
  })
  if (error) throw error
  cache.set(key, code)
  return code
}

async function insertInChunks(client: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  const chunkSize = 500
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize)
    const { error } = await client.from(table).insert(chunk)
    if (error) throw error
  }
}

export async function importAccount51Card(client: SupabaseClient, fileName: string, fileBuffer: Buffer): Promise<ImportResult> {
  const parsed = parseAccount51Workbook(fileBuffer)

  const entityCache = await loadNameIdCache(client, "dim_entity", "entity_id", "entity_name")
  const bankCache = await loadNameIdCache(client, "dim_bank", "bank_id", "bank_name")
  const accountCache = await loadNameIdCache(client, "dim_account", "account_id", "account_name")
  const incomeArticleCache = await loadNameIdCache(client, "dim_income_article", "income_article_id", "income_name")

  const expenseCodeCache = new Map<string, string>()
  const expenseRows = await loadAllRows(client, "dim_expense_code", "expense_code")
  for (const row of expenseRows) {
    const expenseCode = String(row.expense_code ?? "")
    if (expenseCode) expenseCodeCache.set(normalizeKey(expenseCode), expenseCode)
  }

  const ownerEntityId = await ensureEntity(client, entityCache, parsed.ownerName, "owner")
  if (!ownerEntityId) {
    throw new Error("Owner entity could not be resolved")
  }

  const bankId = await ensureBank(client, bankCache, parsed.bankName)
  const accountId = await ensureAccount(client, accountCache, parsed.accountNumber, bankId, ownerEntityId)

  for (const payerName of [...new Set(parsed.incomeRows.map((row) => row.payerName).filter(Boolean))]) {
    await ensureEntity(client, entityCache, payerName, "counterparty")
  }
  for (const payeeName of [...new Set(parsed.expenseRows.map((row) => row.payeeName).filter(Boolean))]) {
    await ensureEntity(client, entityCache, payeeName, "counterparty")
  }

  for (const article of parsed.incomeRows) {
    await ensureIncomeArticle(client, incomeArticleCache, article.articleName, article.articleCode)
  }
  for (const expense of parsed.expenseRows) {
    await ensureExpenseCode(client, expenseCodeCache, expense.expenseCode, expense.expenseName, expense.expenseGroup)
  }

  const existingIncomeHashes = new Set(
    (await loadAllRows(client, "fct_cash_in", "source_row_hash", { source_file: fileName }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )
  const existingExpenseHashes = new Set(
    (await loadAllRows(client, "fct_cash_out", "source_row_hash", { source_file: fileName }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )
  const existingBalanceHashes = new Set(
    (await loadAllRows(client, "fct_balance_snapshot", "source_row_hash", { source_file: fileName }))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )

  const cashInInsert = parsed.incomeRows
    .filter((row) => !existingIncomeHashes.has(row.sourceRowHash))
    .map((row) => ({
      cash_in_id: randomUUID(),
      income_date: row.incomeDate,
      amount: row.amount,
      currency_code: "RUB",
      income_article_id: incomeArticleCache.get(normalizeKey(row.articleName)),
      payer_entity_id: row.payerName ? entityCache.get(normalizeKey(row.payerName)) ?? null : null,
      recipient_entity_id: ownerEntityId,
      account_id: accountId,
      comment: row.comment,
      external_ref: row.externalRef,
      source_system: SOURCE_SYSTEM,
      source_file: fileName,
      source_row_hash: row.sourceRowHash,
    }))

  const cashOutInsert = parsed.expenseRows
    .filter((row) => !existingExpenseHashes.has(row.sourceRowHash))
    .map((row) => ({
      cash_out_id: randomUUID(),
      payment_date: row.paymentDate,
      amount: row.amount,
      currency_code: "RUB",
      expense_code: row.expenseCode,
      payer_entity_id: ownerEntityId,
      payee_entity_id: row.payeeName ? entityCache.get(normalizeKey(row.payeeName)) ?? null : null,
      account_id: accountId,
      comment: row.comment,
      external_ref: row.externalRef,
      source_system: SOURCE_SYSTEM,
      source_file: fileName,
      source_row_hash: row.sourceRowHash,
    }))

  const balanceInsert = parsed.balanceRows
    .filter((row) => !existingBalanceHashes.has(row.sourceRowHash))
    .map((row) => ({
      snapshot_id: randomUUID(),
      snapshot_date: row.snapshotDate,
      account_id: accountId,
      balance: row.balance,
      currency_code: "RUB",
      source_system: SOURCE_SYSTEM,
      source_file: fileName,
      source_row_hash: row.sourceRowHash,
    }))

  if (cashInInsert.length > 0) {
    await insertInChunks(client, "fct_cash_in", cashInInsert)
  }
  if (cashOutInsert.length > 0) {
    await insertInChunks(client, "fct_cash_out", cashOutInsert)
  }
  if (balanceInsert.length > 0) {
    await insertInChunks(client, "fct_balance_snapshot", balanceInsert)
  }

  return {
    imported: {
      cashIn: cashInInsert.length,
      cashOut: cashOutInsert.length,
      balances: balanceInsert.length,
    },
    skipped: {
      cashIn: parsed.incomeRows.length - cashInInsert.length,
      cashOut: parsed.expenseRows.length - cashOutInsert.length,
      balances: parsed.balanceRows.length - balanceInsert.length,
    },
  }
}
