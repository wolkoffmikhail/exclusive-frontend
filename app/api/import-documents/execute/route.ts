import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

type ExecuteDocument = {
  fileName: string
  documentFamily: "card" | "osv" | "unknown"
  ledgerAccount: string | null
  importerCode: string | null
  validationStatus: "READY" | "WARNING" | "BLOCKED" | "INVALID" | "DUPLICATE"
}

type ExecuteRequest = {
  files: ExecuteDocument[]
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
  const payload = (await request.json()) as ExecuteRequest
  const files = Array.isArray(payload?.files) ? payload.files : []

  if (files.length === 0) {
    return NextResponse.json({ error: "Нет документов для импорта" }, { status: 400 })
  }

  const executable = files.filter((file) =>
    file.validationStatus === "READY" || file.validationStatus === "WARNING"
  )

  if (executable.length === 0) {
    return NextResponse.json(
      { error: "Нет документов, готовых к запуску импорта" },
      { status: 400 }
    )
  }

  const includes67 = executable.some((file) => file.ledgerAccount === "67")
  if (includes67 && !has67Pair(executable)) {
    return NextResponse.json(
      { error: "Для счета 67 нужен комплект: карточка счета и ОСВ" },
      { status: 400 }
    )
  }

  try {
    createAdminClient()
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Не настроен серверный доступ к Supabase",
      },
      { status: 500 }
    )
  }

  return NextResponse.json(
    {
      status: "not_implemented",
      message:
        "Контур подтверждения импорта готов, но серверный боевой импорт в web UI пока не подключён. Следующий шаг — перенести существующие импортёры 50/51/55/67 из PowerShell в серверный Node-контур.",
      executableFiles: executable.map((file) => ({
        fileName: file.fileName,
        importerCode: file.importerCode,
      })),
    },
    { status: 501 }
  )
}
