import { randomUUID, createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  readWorkbookRows,
  normalizeWorkbookCellDate,
  normalizeWorkbookText,
  type SheetRow,
} from "@/lib/server/xlsx-inspector"

type LiabilityMovementDef = {
  instrumentKey: string
  operationDate: string
  componentType: "principal" | "interest"
  movementType: "accrual" | "payment" | "principal_repayment" | "reclassification" | "other"
  amount: number
  debitAccountCode: string | null
  creditAccountCode: string | null
  comment: string
  externalRef: string | null
  sourceFile: string
  sourceRowHash: string
}

type LiabilitySnapshotDef = {
  instrumentKey: string
  snapshotDate: string
  componentType: "principal" | "interest"
  balance: number
  sourceFile: string
  sourceRowHash: string
}

type InstrumentDef = {
  instrumentKey: string
  instrumentName: string
  instrumentType: string
  lenderName: string
  contractNumber: string | null
  contractDate: string | null
  contractDescriptor: string | null
  rateText: string | null
  glAccountGroup: string
}

type ImportResult = {
  imported: {
    instruments: number
    movements: number
    snapshots: number
  }
  skipped: {
    movements: number
    snapshots: number
  }
}

const SOURCE_SYSTEM = "liability_statement_1c_web"

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
  return splitLines(text).filter((line) => line && line !== "<...>")
}

function convertCellDecimal(value: string | null | undefined) {
  const normalized = normalizeWorkbookText(value)
  if (!normalized) return null
  const candidate = normalized
    .replace(/ /g, "")
    .replace(/\u00A0/g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.\-]/g, "")
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function getStableHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function getPartyType(name: string) {
  const normalized = normalizeWorkbookText(name)
  if (!normalized) return "other"
  if (/\s[А-ЯЁA-Z]{2,6}$/.test(normalized)) return "company"
  if (/^[А-ЯЁA-Z][а-яёa-z]+ [А-ЯЁA-Z][а-яёa-z]+(?: [А-ЯЁA-Z][а-яёa-z]+)?$/u.test(normalized)) {
    return "individual"
  }
  return "other"
}

function isLikelyEntityName(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  if (!value) return false
  if (/^67(\.|,|$)|^91\.02$|^51$/.test(value)) return false
  if (/^\d{20},/.test(value)) return false
  if (/\s[А-ЯЁA-Z]{2,6}$/.test(value)) return true
  if (/^[А-ЯЁA-Z][а-яёa-z]+ [А-ЯЁA-Z][а-яёa-z]+(?: [А-ЯЁA-Z][а-яёa-z]+)?$/u.test(value)) return true
  return false
}

function extractPartyAndDescriptor(text: string | null | undefined) {
  const lines = getMeaningfulLines(text)
  for (let index = 0; index < lines.length; index += 1) {
    if (isLikelyEntityName(lines[index])) {
      return {
        partyName: normalizeWorkbookText(lines[index]),
        descriptor: index + 1 < lines.length ? normalizeWorkbookText(lines[index + 1]) : null,
      }
    }
  }
  return null
}

function getLiabilityContext(row: SheetRow, groupCode: string) {
  const c = extractPartyAndDescriptor(row.C)
  const d = extractPartyAndDescriptor(row.D)
  if (groupCode === "67.01_67.02") return c ?? d
  return d ?? c
}

function parseContractNumber(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  if (!value) return null
  const patterns = [
    /([0-9]{4,}\/[0-9]{1,}\/[0-9]{4}\/[0-9]{4})/,
    /([0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9]+)/,
    /([0-9]+(?:[\/-][0-9A-Za-z.]+){1,})/,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(value)
    if (match) return normalizeWorkbookText(match[1])
  }
  return null
}

function parseContractDate(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  if (!value) return null
  const match = /(\d{2}\.\d{2}\.\d{4})/.exec(value)
  return match ? normalizeWorkbookCellDate(match[1]) : null
}

function parseRateText(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  if (!value) return null
  const match = /\(([^)]*%[^)]*)\)/.exec(value)
  return match ? normalizeWorkbookText(match[1]) : null
}

function get67Codes(row: SheetRow) {
  return {
    debit: normalizeWorkbookText(row.E),
    credit: normalizeWorkbookText(row.H),
  }
}

function getAmountFor67Row(row: SheetRow) {
  const debit67 = /^67(\.\d+)?$/.test(normalizeWorkbookText(row.E))
  const credit67 = /^67(\.\d+)?$/.test(normalizeWorkbookText(row.H))
  if (debit67) return convertCellDecimal(row.F)
  if (credit67) return convertCellDecimal(row.I)
  return null
}

function getGlGroup(code: string | null | undefined) {
  switch (normalizeWorkbookText(code)) {
    case "67.01":
    case "67.02":
      return "67.01_67.02"
    case "67.03":
    case "67.04":
      return "67.03_67.04"
    default:
      return null
  }
}

function getDefaultInstrumentType(partyName: string, descriptor: string | null, glGroup: string) {
  if (glGroup === "67.01_67.02") return "bank_loan"
  const partyType = getPartyType(partyName)
  if (normalizeKey(descriptor).includes("CESSION")) return "cession_loan"
  if (partyType === "individual") return "shareholder_loan"
  if (partyType === "company") return "intercompany_loan"
  return "other_loan"
}

function getInstrumentName(partyName: string, descriptor: string | null, glGroup: string) {
  const normalizedParty = normalizeWorkbookText(partyName)
  const contractNumber = parseContractNumber(descriptor)
  if (glGroup === "67.01_67.02") {
    return contractNumber ? `${normalizedParty} / ${contractNumber}` : normalizedParty
  }
  return contractNumber ? `${normalizedParty} / ${contractNumber}` : normalizedParty
}

function getInstrumentKey(partyName: string, glGroup: string) {
  return normalizeKey(`${glGroup}|${partyName}`)
}

function getExternalRef(text: string | null | undefined) {
  const value = normalizeWorkbookText(text)
  const match = /00[^ ]+/.exec(value)
  return match?.[0] ?? null
}

function deriveSnapshotBoundaryDates(cardRows: SheetRow[], osvRows: SheetRow[]) {
  const titleLine = normalizeWorkbookText(osvRows[1]?.A ?? cardRows[1]?.A ?? "")
  const yearMatches = [...titleLine.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]))
  const dates = cardRows
    .map((row) => normalizeWorkbookCellDate(row.A ?? ""))
    .filter((value): value is string => Boolean(value))
    .sort()

  const firstYear = yearMatches[0] ?? (dates[0] ? Number(dates[0].slice(0, 4)) : new Date().getUTCFullYear())
  const lastYear = yearMatches[yearMatches.length - 1] ?? (dates[dates.length - 1] ? Number(dates[dates.length - 1].slice(0, 4)) : firstYear)

  return {
    openingDate: `${firstYear}-01-01`,
    closingDate: `${lastYear}-12-31`,
  }
}

function parseLiabilityPack(cardBuffer: Buffer, osvBuffer: Buffer, cardSourceFile: string, osvSourceFile: string) {
  const cardRows = readWorkbookRows(cardBuffer)
  const osvRows = readWorkbookRows(osvBuffer)
  const ownerName = normalizeWorkbookText(cardRows[0]?.A) || 'ООО "ЭКСКЛЮЗИВ СЕРВИС"'
  const { openingDate, closingDate } = deriveSnapshotBoundaryDates(cardRows, osvRows)

  const movementRows = cardRows.filter((row, index) => index >= 7 && Boolean(normalizeWorkbookCellDate(row.A ?? "")))
  const rows67 = movementRows.filter(
    (row) =>
      /^67(\.\d+)?$/.test(normalizeWorkbookText(row.E)) ||
      /^67(\.\d+)?$/.test(normalizeWorkbookText(row.H))
  )

  const instrumentDefs = new Map<string, InstrumentDef>()
  const instrumentOsv: Array<{
    instrumentKey: string
    componentType: "principal" | "interest"
    openingBalance: number
    endingBalance: number
  }> = []

  let currentSection: string | null = null
  for (const row of osvRows.filter((item) => Number(item.__rowNo ?? 0) >= 0)) {
    const label = normalizeWorkbookText(row.A)
    if (!label) continue
    if (/^67\.01,/.test(label)) { currentSection = "67.01"; continue }
    if (/^67\.02,/.test(label)) { currentSection = "67.02"; continue }
    if (/^67\.03,/.test(label)) { currentSection = "67.03"; continue }
    if (/^67\.04,/.test(label)) { currentSection = "67.04"; continue }
    if (/^67,/.test(label)) continue

    const partyName = label
    if (!isLikelyEntityName(partyName) || !currentSection) continue

    const glGroup = getGlGroup(currentSection)
    if (!glGroup) continue

    const openingBalance = convertCellDecimal(row.C) ?? 0
    const endingBalance = convertCellDecimal(row.G) ?? 0

    let descriptor: string | null = null
    let contractNumber: string | null = null
    let contractDate: string | null = null
    let rateText: string | null = null

    const matchingCard = rows67.find((item) => {
      const ctx = getLiabilityContext(item, glGroup)
      if (glGroup === "67.01_67.02") {
        return getGlGroup(normalizeWorkbookText(item.E)) === glGroup || getGlGroup(normalizeWorkbookText(item.H)) === glGroup
      }
      return ctx && normalizeKey(ctx.partyName) === normalizeKey(partyName)
    })

    if (matchingCard) {
      const ctx = getLiabilityContext(matchingCard, glGroup)
      if (ctx) {
        descriptor = ctx.descriptor
        contractNumber = parseContractNumber(descriptor)
        contractDate = parseContractDate(descriptor)
        rateText = parseRateText(descriptor)
      }
    }

    const instrumentKey = getInstrumentKey(partyName, glGroup)
    if (!instrumentDefs.has(instrumentKey)) {
      instrumentDefs.set(instrumentKey, {
        instrumentKey,
        instrumentName: getInstrumentName(partyName, descriptor, glGroup),
        instrumentType: getDefaultInstrumentType(partyName, descriptor, glGroup),
        lenderName: normalizeWorkbookText(partyName),
        contractNumber,
        contractDate,
        contractDescriptor: descriptor,
        rateText,
        glAccountGroup: glGroup,
      })
    }

    const componentType = currentSection === "67.01" || currentSection === "67.03" ? "principal" : "interest"
    instrumentOsv.push({
      instrumentKey,
      componentType,
      openingBalance,
      endingBalance,
    })
  }

  const movementDefs: LiabilityMovementDef[] = []
  for (const row of rows67) {
    const date = normalizeWorkbookCellDate(row.A ?? "")
    const amount = getAmountFor67Row(row)
    if (!date || amount === null) continue

    const { debit, credit } = get67Codes(row)
    const main67 = /^67(\.\d+)?$/.test(debit) ? debit : /^67(\.\d+)?$/.test(credit) ? credit : null
    const glGroup = getGlGroup(main67)
    if (!main67 || !glGroup) continue

    const ctx = getLiabilityContext(row, glGroup)
    const partyName = ctx?.partyName ?? (glGroup === "67.01_67.02" ? "СБЕРБАНК ПАО" : "Unknown lender")
    const instrumentKey = getInstrumentKey(partyName, glGroup)

    if (!instrumentDefs.has(instrumentKey)) {
      const descriptor = ctx?.descriptor ?? null
      instrumentDefs.set(instrumentKey, {
        instrumentKey,
        instrumentName: getInstrumentName(partyName, descriptor, glGroup),
        instrumentType: getDefaultInstrumentType(partyName, descriptor, glGroup),
        lenderName: normalizeWorkbookText(partyName),
        contractNumber: parseContractNumber(descriptor),
        contractDate: parseContractDate(descriptor),
        contractDescriptor: descriptor,
        rateText: parseRateText(descriptor),
        glAccountGroup: glGroup,
      })
    }

    const effects: Array<{
      componentType: "principal" | "interest"
      movementType: LiabilityMovementDef["movementType"]
      delta: number
    }> = []

    if (debit === "91.02" && credit === "67.02") {
      effects.push({ componentType: "interest", movementType: "accrual", delta: amount })
    } else if (debit === "67.02" && credit === "51") {
      effects.push({ componentType: "interest", movementType: "payment", delta: -amount })
    } else if (debit === "67.01" && credit === "51") {
      effects.push({ componentType: "principal", movementType: "principal_repayment", delta: -amount })
    } else if (debit === "67.01" && credit === "67.02") {
      effects.push({ componentType: "principal", movementType: "reclassification", delta: -amount })
      effects.push({ componentType: "interest", movementType: "reclassification", delta: amount })
    } else if (debit === "91.02" && credit === "67.04") {
      effects.push({ componentType: "interest", movementType: "accrual", delta: amount })
    } else if (debit === "67.04" && credit === "51") {
      effects.push({ componentType: "interest", movementType: "payment", delta: -amount })
    } else if (debit === "67.03" && credit === "51") {
      effects.push({ componentType: "principal", movementType: "principal_repayment", delta: -amount })
    } else if (debit === "67.03" || credit === "67.03") {
      effects.push({
        componentType: "principal",
        movementType: "other",
        delta: credit === "67.03" ? amount : -amount,
      })
    } else if (debit === "67.04" || credit === "67.04") {
      effects.push({
        componentType: "interest",
        movementType: "other",
        delta: credit === "67.04" ? amount : -amount,
      })
    } else {
      continue
    }

    const baseRowHash = getStableHash(
      [date, debit, credit, String(amount), normalizeWorkbookText(row.B), normalizeWorkbookText(row.C), normalizeWorkbookText(row.D)].join("|")
    )

    effects.forEach((effect, index) => {
      movementDefs.push({
        instrumentKey,
        operationDate: date,
        componentType: effect.componentType,
        movementType: effect.movementType,
        amount: Math.abs(effect.delta),
        debitAccountCode: debit || null,
        creditAccountCode: credit || null,
        comment: normalizeWorkbookText(row.B),
        externalRef: getExternalRef(row.B),
        sourceFile: cardSourceFile,
        sourceRowHash: `${baseRowHash}-${index + 1}`,
      })
    })
  }

  const snapshotDedup = new Map<string, LiabilitySnapshotDef>()
  for (const osv of instrumentOsv) {
    if (osv.openingBalance !== 0) {
      const opening: LiabilitySnapshotDef = {
        instrumentKey: osv.instrumentKey,
        snapshotDate: openingDate,
        componentType: osv.componentType,
        balance: osv.openingBalance,
        sourceFile: osvSourceFile,
        sourceRowHash: getStableHash(`opening|${osv.instrumentKey}|${osv.componentType}|${osv.openingBalance}|${openingDate}`),
      }
      snapshotDedup.set(`${opening.instrumentKey}|${opening.componentType}|${opening.snapshotDate}`, opening)
    }

    const closing: LiabilitySnapshotDef = {
      instrumentKey: osv.instrumentKey,
      snapshotDate: closingDate,
      componentType: osv.componentType,
      balance: osv.endingBalance,
      sourceFile: osvSourceFile,
      sourceRowHash: getStableHash(`closing|${osv.instrumentKey}|${osv.componentType}|${osv.endingBalance}|${closingDate}`),
    }
    snapshotDedup.set(`${closing.instrumentKey}|${closing.componentType}|${closing.snapshotDate}`, closing)
  }

  return {
    ownerName,
    instruments: [...instrumentDefs.values()],
    movements: movementDefs,
    snapshots: [...snapshotDedup.values()].sort((a, b) =>
      `${a.snapshotDate}|${a.instrumentKey}|${a.componentType}`.localeCompare(
        `${b.snapshotDate}|${b.instrumentKey}|${b.componentType}`
      )
    ),
  }
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

async function loadPartyCache(client: SupabaseClient) {
  const cache = new Map<string, string>()
  for (const row of await loadAllRows(client, "dim_liability_party", "liability_party_id,party_name")) {
    const name = normalizeWorkbookText(String(row.party_name ?? ""))
    const id = String(row.liability_party_id ?? "")
    if (name && id) cache.set(normalizeKey(name), id)
  }
  return cache
}

async function loadInstrumentCache(client: SupabaseClient) {
  const cache = new Map<string, string>()
  for (const row of await loadAllRows(client, "dim_liability_instrument", "liability_instrument_id,instrument_name")) {
    const name = normalizeWorkbookText(String(row.instrument_name ?? ""))
    const id = String(row.liability_instrument_id ?? "")
    if (name && id) cache.set(normalizeKey(name), id)
  }
  return cache
}

async function ensureLiabilityParty(client: SupabaseClient, cache: Map<string, string>, name: string) {
  const normalizedName = normalizeWorkbookText(name)
  const key = normalizeKey(normalizedName)
  const existing = cache.get(key)
  if (existing) return existing
  const liabilityPartyId = randomUUID()
  const { error } = await client.from("dim_liability_party").insert({
    liability_party_id: liabilityPartyId,
    party_name: normalizedName,
    party_type: getPartyType(normalizedName),
    is_active: true,
  })
  if (error) throw error
  cache.set(key, liabilityPartyId)
  return liabilityPartyId
}

async function ensureLiabilityInstrument(
  client: SupabaseClient,
  cache: Map<string, string>,
  instrument: InstrumentDef,
  lenderPartyId: string
) {
  const key = normalizeKey(instrument.instrumentName)
  const existing = cache.get(key)
  if (existing) return existing

  const liabilityInstrumentId = randomUUID()
  const { error } = await client.from("dim_liability_instrument").insert({
    liability_instrument_id: liabilityInstrumentId,
    instrument_name: instrument.instrumentName,
    instrument_type: instrument.instrumentType,
    lender_party_id: lenderPartyId,
    contract_number: instrument.contractNumber,
    contract_date: instrument.contractDate,
    contract_descriptor: instrument.contractDescriptor,
    rate_text: instrument.rateText,
    gl_account_group: instrument.glAccountGroup,
    include_in_reporting: true,
    is_active: true,
  })
  if (error) throw error
  cache.set(key, liabilityInstrumentId)
  return liabilityInstrumentId
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

export async function importAccount67Pack(
  client: SupabaseClient,
  cardSourceFile: string,
  cardBuffer: Buffer,
  osvSourceFile: string,
  osvBuffer: Buffer
): Promise<ImportResult> {
  const parsed = parseLiabilityPack(cardBuffer, osvBuffer, cardSourceFile, osvSourceFile)

  const partyCache = await loadPartyCache(client)
  const instrumentCache = await loadInstrumentCache(client)
  const existingMovementHashes = new Set(
    (await loadAllRows(client, "fct_liability_movement", "source_row_hash"))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )
  const existingSnapshotHashes = new Set(
    (await loadAllRows(client, "fct_liability_snapshot", "source_row_hash"))
      .map((row) => String(row.source_row_hash ?? ""))
      .filter(Boolean)
  )
  const existingSnapshotKeys = new Set(
    (await loadAllRows(client, "fct_liability_snapshot", "snapshot_date,liability_instrument_id,component_type"))
      .map(
        (row) =>
          `${String(row.snapshot_date ?? "")}|${String(row.liability_instrument_id ?? "")}|${String(row.component_type ?? "")}`
      )
      .filter((value) => value !== "||")
  )

  const instrumentIdByKey = new Map<string, string>()
  for (const instrument of parsed.instruments) {
    const lenderPartyId = await ensureLiabilityParty(client, partyCache, instrument.lenderName)
    const instrumentId = await ensureLiabilityInstrument(client, instrumentCache, instrument, lenderPartyId)
    instrumentIdByKey.set(instrument.instrumentKey, instrumentId)
  }

  const movementRowsToInsert = parsed.movements
    .filter((movement) => !existingMovementHashes.has(movement.sourceRowHash))
    .map((movement) => ({
      liability_movement_id: randomUUID(),
      operation_date: movement.operationDate,
      liability_instrument_id: instrumentIdByKey.get(movement.instrumentKey)!,
      component_type: movement.componentType,
      movement_type: movement.movementType,
      amount: movement.amount,
      currency_code: "RUB",
      debit_account_code: movement.debitAccountCode,
      credit_account_code: movement.creditAccountCode,
      comment: movement.comment,
      external_ref: movement.externalRef,
      source_system: SOURCE_SYSTEM,
      source_file: movement.sourceFile,
      source_row_hash: movement.sourceRowHash,
    }))

  const snapshotRowsToInsert = parsed.snapshots
    .filter((snapshot) => {
      if (existingSnapshotHashes.has(snapshot.sourceRowHash)) return false
      const instrumentId = instrumentIdByKey.get(snapshot.instrumentKey)
      if (!instrumentId) return false
      return !existingSnapshotKeys.has(`${snapshot.snapshotDate}|${instrumentId}|${snapshot.componentType}`)
    })
    .map((snapshot) => ({
      liability_snapshot_id: randomUUID(),
      snapshot_date: snapshot.snapshotDate,
      liability_instrument_id: instrumentIdByKey.get(snapshot.instrumentKey)!,
      component_type: snapshot.componentType,
      balance: snapshot.balance,
      currency_code: "RUB",
      source_system: SOURCE_SYSTEM,
      source_file: snapshot.sourceFile,
      source_row_hash: snapshot.sourceRowHash,
    }))

  for (const chunk of chunkArray(movementRowsToInsert, 500)) {
    const { error } = await client.from("fct_liability_movement").insert(chunk)
    if (error) throw error
  }

  for (const chunk of chunkArray(snapshotRowsToInsert, 500)) {
    const { error } = await client.from("fct_liability_snapshot").insert(chunk)
    if (error) throw error
  }

  return {
    imported: {
      instruments: parsed.instruments.length,
      movements: movementRowsToInsert.length,
      snapshots: snapshotRowsToInsert.length,
    },
    skipped: {
      movements: parsed.movements.length - movementRowsToInsert.length,
      snapshots: parsed.snapshots.length - snapshotRowsToInsert.length,
    },
  }
}
