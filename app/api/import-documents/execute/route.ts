import { NextResponse } from "next/server"
import { importAccount50Card } from "@/lib/server/import-account-50"
import { importAccount51Card } from "@/lib/server/import-account-51"
import { importAccount55Card } from "@/lib/server/import-account-55"
import { createAdminClient } from "@/lib/supabase/admin"

type ExecuteDocument = {
  fileName: string
  documentFamily: "card" | "osv" | "unknown"
  ledgerAccount: string | null
  importerCode: string | null
  validationStatus: "READY" | "WARNING" | "BLOCKED" | "INVALID" | "DUPLICATE"
}

function has67Pair(files: ExecuteDocument[]) {
  const has67Card = files.some(
    (file) =>
      file.documentFamily === "card" &&
      file.ledgerAccount === "67" &&
      (file.validationStatus === "READY" || file.validationStatus === "WARNING")
  )
  const has67Osv = files.some(
    (file) =>
      file.documentFamily === "osv" &&
      file.ledgerAccount === "67" &&
      (file.validationStatus === "READY" || file.validationStatus === "WARNING")
  )
  return has67Card && has67Osv
}

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const rawDocuments = formData.get("documents")
    const files = rawDocuments ? (JSON.parse(String(rawDocuments)) as ExecuteDocument[]) : []
    const uploadedFiles = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File)

    if (files.length === 0 || uploadedFiles.length === 0) {
      return NextResponse.json({ error: "Нет документов для импорта" }, { status: 400 })
    }

    const executable = files.filter(
      (file) => file.validationStatus === "READY" || file.validationStatus === "WARNING"
    )

    if (executable.length === 0) {
      return NextResponse.json(
        { error: "Нет документов, готовых к запуску импорта" },
        { status: 400 }
      )
    }

    if (executable.some((file) => file.ledgerAccount === "67") && !has67Pair(executable)) {
      return NextResponse.json(
        { error: "Для счета 67 нужен комплект: карточка счета и ОСВ" },
        { status: 400 }
      )
    }

    const adminClient = createAdminClient()
    const fileByName = new Map(uploadedFiles.map((file) => [file.name, file]))
    const importedSummaries: string[] = []
    const pendingSummaries: string[] = []

    for (const document of executable) {
      const matchingFile = fileByName.get(document.fileName)
      if (!matchingFile) {
        pendingSummaries.push(`${document.fileName}: файл не найден в текущем наборе`)
        continue
      }

      if (document.importerCode === "account_51_card") {
        const fileBuffer = Buffer.from(await matchingFile.arrayBuffer())
        const result = await importAccount51Card(adminClient, matchingFile.name, fileBuffer)
        importedSummaries.push(
          `51: +${result.imported.cashIn} поступлений, +${result.imported.cashOut} платежей, +${result.imported.balances} остатков`
        )
        if (result.skipped.cashIn || result.skipped.cashOut || result.skipped.balances) {
          pendingSummaries.push(
            `51: пропущено как уже загруженное — ${result.skipped.cashIn} поступлений, ${result.skipped.cashOut} платежей, ${result.skipped.balances} остатков`
          )
        }
        continue
      }

      if (document.importerCode === "account_50_card") {
        const fileBuffer = Buffer.from(await matchingFile.arrayBuffer())
        const result = await importAccount50Card(adminClient, matchingFile.name, fileBuffer)
        importedSummaries.push(
          `50: +${result.imported.cashIn} поступлений, +${result.imported.cashOut} выдач, +${result.imported.balances} остатков`
        )
        if (result.skipped.cashIn || result.skipped.cashOut || result.skipped.balances) {
          pendingSummaries.push(
            `50: пропущено как уже загруженное — ${result.skipped.cashIn} поступлений, ${result.skipped.cashOut} выдач, ${result.skipped.balances} остатков`
          )
        }
        continue
      }

      if (document.importerCode === "account_55_card") {
        const fileBuffer = Buffer.from(await matchingFile.arrayBuffer())
        const result = await importAccount55Card(adminClient, matchingFile.name, fileBuffer)
        importedSummaries.push(`55: +${result.imported.balances} остатков`)
        if (result.skipped.balances) {
          pendingSummaries.push(
            `55: пропущено как уже загруженное — ${result.skipped.balances} остатков`
          )
        }
        continue
      }

      pendingSummaries.push(
        `${document.fileName}: web-импорт для ${document.ledgerAccount ?? "этого документа"} подключим следующим этапом`
      )
    }

    return NextResponse.json({
      status: "partial_success",
      message: [
        importedSummaries.length > 0 ? `Импорт завершён. ${importedSummaries.join(". ")}` : null,
        pendingSummaries.length > 0 ? `Следующий этап: ${pendingSummaries.join(". ")}` : null,
      ]
        .filter(Boolean)
        .join(" "),
      imported: importedSummaries,
      pending: pendingSummaries,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не удалось запустить импорт",
      },
      { status: 500 }
    )
  }
}
