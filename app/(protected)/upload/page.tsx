"use client"

import { useMemo, useRef, useState } from "react"
import { FileUp, Loader2, Upload, XCircle } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type ValidationStatus = "READY" | "WARNING" | "BLOCKED" | "INVALID" | "DUPLICATE"
type DocumentFamily = "card" | "osv" | "unknown"

type DetectedImportDocument = {
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

function statusLabel(status: ValidationStatus) {
  switch (status) {
    case "READY":
      return "Готов"
    case "WARNING":
      return "Предупреждение"
    case "BLOCKED":
      return "Заблокирован"
    case "DUPLICATE":
      return "Дубликат"
    case "INVALID":
      return "Ошибка"
    default:
      return status
  }
}

function statusVariant(status: ValidationStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "READY":
      return "default"
    case "WARNING":
      return "secondary"
    case "BLOCKED":
      return "outline"
    case "DUPLICATE":
      return "outline"
    case "INVALID":
      return "destructive"
    default:
      return "outline"
  }
}

function documentFamilyLabel(family: DocumentFamily) {
  switch (family) {
    case "card":
      return "Карточка счета"
    case "osv":
      return "ОСВ"
    default:
      return "Не распознан"
  }
}

function formatPeriod(periodFrom: string | null, periodTo: string | null) {
  if (!periodFrom && !periodTo) return "—"
  if (periodFrom && periodTo) return `${periodFrom} — ${periodTo}`
  return periodFrom ?? periodTo ?? "—"
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [files, setFiles] = useState<DetectedImportDocument[]>([])
  const [error, setError] = useState<string | null>(null)

  const summary = useMemo(() => {
    return {
      total: files.length,
      ready: files.filter((file) => file.validationStatus === "READY").length,
      warning: files.filter((file) => file.validationStatus === "WARNING").length,
      blocked: files.filter((file) => file.validationStatus === "BLOCKED").length,
      invalid: files.filter((file) => file.validationStatus === "INVALID").length,
      duplicate: files.filter((file) => file.validationStatus === "DUPLICATE").length,
    }
  }, [files])

  async function detectFiles(fileList: FileList | File[]) {
    const candidates = Array.from(fileList).filter((file) =>
      file.name.toLowerCase().endsWith(".xlsx")
    )

    if (candidates.length === 0) {
      setError("Нужны Excel-файлы формата .xlsx")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      candidates.forEach((file) => formData.append("files", file))

      const response = await fetch("/api/import-documents/detect", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? "Не удалось распознать загруженные файлы")
      }

      const payload = (await response.json()) as DetectResponse
      setFiles(payload.files)
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось обработать файлы"
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Загрузка данных</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Загрузите один или несколько Excel-файлов. Система сама определит тип
          документа по содержимому, проверит структуру и подготовит набор к
          следующему шагу импорта.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Файлы для распознавания</CardTitle>
          <CardDescription>
            Поддерживаются карточки 50, 51, 55, 67 и ОСВ по счету 67.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".xlsx"
            multiple
            onChange={(event) => {
              if (event.target.files) {
                void detectFiles(event.target.files)
              }
            }}
          />

          <div
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              void detectFiles(event.dataTransfer.files)
            }}
            className={[
              "rounded-xl border border-dashed p-8 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-border bg-muted/20",
            ].join(" ")}
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <FileUp className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Перетащите Excel-файлы сюда или выберите их вручную
              </p>
              <p className="text-xs text-muted-foreground">
                Имена файлов могут быть любыми. Проверка выполняется по форме
                документа.
              </p>
            </div>
            <div className="mt-5 flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Распознаём…
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Выбрать файлы
                  </>
                )}
              </Button>
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Ошибка распознавания</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Всего файлов</CardDescription>
                <CardTitle className="text-2xl">{summary.total}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Готовы</CardDescription>
                <CardTitle className="text-2xl">{summary.ready}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Предупреждения</CardDescription>
                <CardTitle className="text-2xl">{summary.warning}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Заблокированы</CardDescription>
                <CardTitle className="text-2xl">{summary.blocked}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ошибки / дубликаты</CardDescription>
                <CardTitle className="text-2xl">
                  {summary.invalid + summary.duplicate}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результаты распознавания</CardTitle>
          <CardDescription>
            Здесь показано, какие документы распознаны и что готово к следующему
            этапу импорта.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Файлы ещё не загружены.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Файл</th>
                    <th className="px-3 py-2 font-medium">Тип</th>
                    <th className="px-3 py-2 font-medium">Счёт</th>
                    <th className="px-3 py-2 font-medium">Период</th>
                    <th className="px-3 py-2 font-medium">Организация</th>
                    <th className="px-3 py-2 font-medium">Статус</th>
                    <th className="px-3 py-2 font-medium">Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={`${file.fileHash}-${file.fileName}`} className="border-b align-top">
                      <td className="px-3 py-3">
                        <div className="font-medium">{file.fileName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {file.importerCode ?? "importer not assigned"}
                        </div>
                      </td>
                      <td className="px-3 py-3">{documentFamilyLabel(file.documentFamily)}</td>
                      <td className="px-3 py-3">{file.ledgerAccount ?? "—"}</td>
                      <td className="px-3 py-3">
                        {formatPeriod(file.periodFrom, file.periodTo)}
                      </td>
                      <td className="px-3 py-3">{file.organizationName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={statusVariant(file.validationStatus)}>
                          {statusLabel(file.validationStatus)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {file.validationComment}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert>
        <Upload className="h-4 w-4" />
        <AlertTitle>Следующий этап импорта</AlertTitle>
        <AlertDescription>
          В этой версии страница уже умеет принимать файлы и валидировать их
          форму по содержимому. Подтверждённый боевой импорт подключим следующим
          шагом поверх этого контура.
        </AlertDescription>
      </Alert>
    </div>
  )
}
