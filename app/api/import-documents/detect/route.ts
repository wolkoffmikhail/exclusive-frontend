import { NextResponse } from "next/server"
import {
  inspectImportedWorkbook,
  type DetectedImportDocument,
} from "@/lib/server/xlsx-inspector"

export const runtime = "nodejs"

type DetectResponse = {
  files: DetectedImportDocument[]
  summary: {
    ready: number
    warning: number
    blocked: number
    invalid: number
    duplicate: number
  }
}

function summarize(files: DetectedImportDocument[]): DetectResponse["summary"] {
  return {
    ready: files.filter((file) => file.validationStatus === "READY").length,
    warning: files.filter((file) => file.validationStatus === "WARNING").length,
    blocked: files.filter((file) => file.validationStatus === "BLOCKED").length,
    invalid: files.filter((file) => file.validationStatus === "INVALID").length,
    duplicate: files.filter((file) => file.validationStatus === "DUPLICATE").length,
  }
}

export async function POST(request: Request) {
  const formData = await request.formData()
  const uploadedFiles = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File)

  if (uploadedFiles.length === 0) {
    return NextResponse.json({ error: "Файлы не переданы" }, { status: 400 })
  }

  const detected = await Promise.all(
    uploadedFiles.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer())
      return inspectImportedWorkbook(file.name, buffer)
    })
  )

  const hashCounts = new Map<string, number>()
  for (const item of detected) {
    hashCounts.set(item.fileHash, (hashCounts.get(item.fileHash) ?? 0) + 1)
  }

  const result = detected.map((item) => {
    const duplicateInBatch = (hashCounts.get(item.fileHash) ?? 0) > 1
    if (duplicateInBatch) {
      return {
        ...item,
        validationStatus: "DUPLICATE" as const,
        validationComment: "Этот файл уже выбран в текущем наборе загрузки",
      }
    }
    return item
  })

  const has67Card = result.some(
    (item) =>
      item.documentFamily === "card" &&
      item.ledgerAccount === "67" &&
      item.validationStatus !== "INVALID"
  )

  const has67Osv = result.some(
    (item) =>
      item.documentFamily === "osv" &&
      item.ledgerAccount === "67" &&
      item.validationStatus !== "INVALID"
  )

  const normalized = result.map((item) => {
    if (item.validationStatus === "INVALID" || item.validationStatus === "DUPLICATE") {
      return item
    }
    if (
      item.ledgerAccount === "67" &&
      ((item.documentFamily === "card" && !has67Osv) ||
        (item.documentFamily === "osv" && !has67Card))
    ) {
      return {
        ...item,
        validationStatus: "BLOCKED" as const,
        validationComment: "Для счета 67 нужен комплект: карточка счета и ОСВ",
      }
    }
    return item
  })

  return NextResponse.json({
    files: normalized,
    summary: summarize(normalized),
  } satisfies DetectResponse)
}
