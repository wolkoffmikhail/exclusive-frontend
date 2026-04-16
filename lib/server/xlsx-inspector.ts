import { createHash } from "node:crypto"
import { inflateRawSync } from "node:zlib"

type ZipEntry = {
  name: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export type SheetRow = Record<string, string>

export type DocumentFamily = "card" | "osv" | "unknown"
export type ValidationStatus = "READY" | "WARNING" | "INVALID" | "DUPLICATE" | "BLOCKED"

export type DetectedImportDocument = {
  fileName: string
  fileHash: string
  documentFamily: DocumentFamily
  ledgerAccount: string | null
  organizationName: string | null
  periodFrom: string | null
  periodTo: string | null
  importerCode: string | null
  validationStatus: ValidationStatus
  validationComment: string
  matchedSignals: string[]
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
}

function decodeXmlEntities(input: string) {
  return input.replace(/&(amp|lt|gt|quot|apos);/g, (match) => XML_ENTITIES[match] ?? match)
}

export function normalizeWorkbookText(input: string | null | undefined) {
  return (input ?? "").replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim()
}

export function normalizeWorkbookCellDate(input: string) {
  const value = normalizeWorkbookText(input)
  if (!value) return null
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function readUInt32LE(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset)
}

function readUInt16LE(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset)
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      return index
    }
  }
  throw new Error("ZIP end of central directory not found")
}

function parseCentralDirectory(buffer: Buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer)
  const centralDirectorySize = readUInt32LE(buffer, eocdOffset + 12)
  const centralDirectoryOffset = readUInt32LE(buffer, eocdOffset + 16)
  const entries: ZipEntry[] = []

  let cursor = centralDirectoryOffset
  const end = centralDirectoryOffset + centralDirectorySize

  while (cursor < end) {
    const signature = readUInt32LE(buffer, cursor)
    if (signature !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry signature")
    }

    const compressionMethod = readUInt16LE(buffer, cursor + 10)
    const compressedSize = readUInt32LE(buffer, cursor + 20)
    const uncompressedSize = readUInt32LE(buffer, cursor + 24)
    const fileNameLength = readUInt16LE(buffer, cursor + 28)
    const extraFieldLength = readUInt16LE(buffer, cursor + 30)
    const fileCommentLength = readUInt16LE(buffer, cursor + 32)
    const localHeaderOffset = readUInt32LE(buffer, cursor + 42)
    const fileName = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString("utf8")

    entries.push({
      name: fileName,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength
  }

  return entries
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const localHeaderOffset = entry.localHeaderOffset
  const signature = readUInt32LE(buffer, localHeaderOffset)
  if (signature !== 0x04034b50) {
    throw new Error(`Invalid ZIP local header for ${entry.name}`)
  }

  const fileNameLength = readUInt16LE(buffer, localHeaderOffset + 26)
  const extraFieldLength = readUInt16LE(buffer, localHeaderOffset + 28)
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength
  const dataEnd = dataStart + entry.compressedSize
  const payload = buffer.subarray(dataStart, dataEnd)

  if (entry.compressionMethod === 0) {
    return payload
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(payload)
  }

  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.name}`)
}

function extractXmlTextParts(fragment: string) {
  const pieces: string[] = []
  const richTextMatches = fragment.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)
  for (const match of richTextMatches) {
    pieces.push(decodeXmlEntities(match[1]))
  }
  return pieces.join("")
}

function parseSharedStrings(xml: string) {
  const strings: string[] = []
  const matches = xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)
  for (const match of matches) {
    strings.push(normalizeWorkbookText(extractXmlTextParts(match[1])))
  }
  return strings
}

function parseSheetRows(xml: string, sharedStrings: string[]) {
  const rows: SheetRow[] = []
  const rowMatches = xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)

  for (const rowMatch of rowMatches) {
    const cells: SheetRow = {}
    const cellMatches = rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)
    for (const cellMatch of cellMatches) {
      const attrs = cellMatch[1]
      const body = cellMatch[2]
      const refMatch = /r="([A-Z]+)\d+"/.exec(attrs)
      if (!refMatch) continue
      const columnRef = refMatch[1]
      const typeMatch = /t="([^"]+)"/.exec(attrs)
      const cellType = typeMatch?.[1] ?? ""
      let value = ""

      if (cellType === "s") {
        const indexMatch = /<v>([\s\S]*?)<\/v>/.exec(body)
        const sharedIndex = Number(indexMatch?.[1] ?? "")
        value = Number.isFinite(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : ""
      } else if (cellType === "inlineStr") {
        value = extractXmlTextParts(body)
      } else {
        const valueMatch = /<v>([\s\S]*?)<\/v>/.exec(body)
        value = decodeXmlEntities(valueMatch?.[1] ?? "")
      }

      cells[columnRef] = normalizeWorkbookText(value)
    }
    rows.push(cells)
  }

  return rows
}

function getWorkbookSheetTargets(workbookXml: string, relsXml: string) {
  const relTargetById = new Map<string, string>()
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    relTargetById.set(match[1], match[2])
  }

  const targets: string[] = []
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const target = relTargetById.get(match[1])
    if (target) {
      const normalizedTarget = target.startsWith("worksheets/")
        ? `xl/${target}`
        : target.startsWith("/xl/")
          ? target.slice(1)
          : `xl/${target.replace(/^\/+/, "")}`
      targets.push(normalizedTarget)
    }
  }
  return targets
}

export function readWorkbookRows(buffer: Buffer) {
  const zipEntries = parseCentralDirectory(buffer)
  const entryByName = new Map(zipEntries.map((entry) => [entry.name, entry]))

  const workbookEntry = entryByName.get("xl/workbook.xml")
  const workbookRelsEntry = entryByName.get("xl/_rels/workbook.xml.rels")
  if (!workbookEntry || !workbookRelsEntry) {
    throw new Error("Workbook metadata not found in xlsx file")
  }

  const workbookXml = readZipEntry(buffer, workbookEntry).toString("utf8")
  const workbookRelsXml = readZipEntry(buffer, workbookRelsEntry).toString("utf8")
  const sheetTargets = getWorkbookSheetTargets(workbookXml, workbookRelsXml)

  const sharedStringsEntry = entryByName.get("xl/sharedStrings.xml")
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(readZipEntry(buffer, sharedStringsEntry).toString("utf8"))
    : []

  const firstSheetTarget = sheetTargets[0] ?? "xl/worksheets/sheet1.xml"
  const firstSheetEntry = entryByName.get(firstSheetTarget)
  if (!firstSheetEntry) {
    throw new Error("First worksheet not found in xlsx file")
  }

  const firstSheetXml = readZipEntry(buffer, firstSheetEntry).toString("utf8")
  const rows = parseSheetRows(firstSheetXml, sharedStrings)
  return rows
}

function detectDocumentFromRows(rows: SheetRow[]) {
  const firstRows = rows.slice(0, 40)
  const allValues = firstRows.flatMap((row) => Object.values(row))
  const headerJoined = allValues.join(" | ")
  const matchedSignals: string[] = []

  const cardHeaderSignals = [
    "Период",
    "Документ",
    "Аналитика Дт",
    "Аналитика Кт",
    "Дебет",
    "Кредит",
    "Текущее сальдо",
  ]
  const cardHeaderHits = cardHeaderSignals.filter((signal) => headerJoined.includes(signal))
  const hasCardColumns = cardHeaderHits.length >= 5

  const hasOsv67Sections = ["67.01", "67.02", "67.03", "67.04"].every((section) =>
    rows.some((row) => normalizeWorkbookText(row.A).startsWith(`${section},`))
  )

  if (hasCardColumns) matchedSignals.push("card_columns")
  if (hasOsv67Sections) matchedSignals.push("osv_67_sections")

  let documentFamily: DocumentFamily = "unknown"
  if (hasCardColumns) {
    documentFamily = "card"
  } else if (hasOsv67Sections) {
    documentFamily = "osv"
  }

  const organizationName = normalizeWorkbookText(rows[0]?.A ?? "") || null

  const dates = rows
    .map((row) => normalizeWorkbookCellDate(row.A ?? ""))
    .filter((value): value is string => Boolean(value))
    .sort()

  const periodFrom = dates[0] ?? null
  const periodTo = dates[dates.length - 1] ?? null

  let ledgerAccount: string | null = null
  if (documentFamily === "card") {
    const counters = new Map<string, number>()
    for (const row of rows) {
      for (const cellValue of [
        normalizeWorkbookText(row.E),
        normalizeWorkbookText(row.G),
        normalizeWorkbookText(row.H),
        normalizeWorkbookText(row.I),
      ]) {
        if (!cellValue) continue
        if (/^50(\.\d+)?$/.test(cellValue)) {
          counters.set("50", (counters.get("50") ?? 0) + 1)
        } else if (/^51$/.test(cellValue)) {
          counters.set("51", (counters.get("51") ?? 0) + 1)
        } else if (/^55(\.\d+)?$/.test(cellValue)) {
          counters.set("55", (counters.get("55") ?? 0) + 1)
        } else if (/^67(\.\d+)?$/.test(cellValue)) {
          counters.set("67", (counters.get("67") ?? 0) + 1)
        }
      }
    }

    const topAccount = [...counters.entries()].sort((a, b) => b[1] - a[1])[0]
    ledgerAccount = topAccount?.[0] ?? null
    if (ledgerAccount) {
      matchedSignals.push(`ledger_${ledgerAccount}`)
    }
    if (!ledgerAccount && rows.some((row) => /^67\.\d+,$/.test(normalizeWorkbookText(row.A)))) {
      ledgerAccount = "67"
      matchedSignals.push("ledger_67_by_sections")
    }
  } else if (documentFamily === "osv" && hasOsv67Sections) {
    ledgerAccount = "67"
    matchedSignals.push("ledger_67")
  }

  let importerCode: string | null = null
  if (documentFamily === "card" && ledgerAccount) {
    importerCode = `account_${ledgerAccount}_card`
  } else if (documentFamily === "osv" && ledgerAccount === "67") {
    importerCode = "account_67_osv"
  }

  let validationStatus: ValidationStatus = "READY"
  let validationComment = "Структура документа распознана"

  if (documentFamily === "unknown" || !ledgerAccount) {
    validationStatus = "INVALID"
    validationComment = "Не удалось однозначно распознать тип документа по содержимому"
  } else if (!organizationName) {
    validationStatus = "WARNING"
    validationComment = "Тип документа распознан, но организация не определилась"
  } else if (!periodFrom || !periodTo) {
    validationStatus = "WARNING"
    validationComment = "Тип документа распознан, но период определился не полностью"
  }

  return {
    documentFamily,
    ledgerAccount,
    organizationName,
    periodFrom,
    periodTo,
    importerCode,
    validationStatus,
    validationComment,
    matchedSignals,
  }
}

export async function inspectImportedWorkbook(fileName: string, fileBuffer: Buffer): Promise<DetectedImportDocument> {
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex")

  try {
    const rows = readWorkbookRows(fileBuffer)
    const detected = detectDocumentFromRows(rows)
    return {
      fileName,
      fileHash,
      ...detected,
    }
  } catch (error) {
    return {
      fileName,
      fileHash,
      documentFamily: "unknown",
      ledgerAccount: null,
      organizationName: null,
      periodFrom: null,
      periodTo: null,
      importerCode: null,
      validationStatus: "INVALID",
      validationComment:
        error instanceof Error ? error.message : "Файл не удалось распознать",
      matchedSignals: [],
    }
  }
}
