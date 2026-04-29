"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

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

type ImportHistoryEntry = {
  importJobId: string
  status: "success" | "partial_success" | "failed"
  documentsCount: number
  filesCount: number
  message: string | null
  errorText: string | null
  importedSummaries: string[]
  pendingSummaries: string[]
  createdAt: string
  completedAt: string
  files: DetectedImportDocument[]
}

type ImportHistoryResponse = {
  jobs: ImportHistoryEntry[]
}

type HistoryStatusFilter = "all" | ImportHistoryEntry["status"]

type ImportHistoryFile = {
  fileName: string
  fileHash?: string | null
  documentFamily: DocumentFamily
  ledgerAccount: string | null
  importerCode: string | null
  organizationName?: string | null
  periodFrom?: string | null
  periodTo?: string | null
}

type ReimportMatch = {
  file: DetectedImportDocument
  job: ImportHistoryEntry
  matchedHistoryFile: ImportHistoryFile
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

function journalStatusLabel(status: ImportHistoryEntry["status"]) {
  switch (status) {
    case "success":
      return "Успешно"
    case "partial_success":
      return "Частично"
    case "failed":
      return "Ошибка"
    default:
      return status
  }
}

function journalStatusVariant(
  status: ImportHistoryEntry["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "success":
      return "default"
    case "partial_success":
      return "secondary"
    case "failed":
      return "destructive"
    default:
      return "outline"
  }
}

function formatJournalDate(value: string) {
  if (!value) return "вЂ”"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date)
}

function getDocumentKey(file: {
  documentFamily: DocumentFamily
  ledgerAccount: string | null
  importerCode: string | null
  organizationName?: string | null
  periodFrom?: string | null
  periodTo?: string | null
}) {
  return [
    file.documentFamily,
    file.ledgerAccount ?? "",
    file.importerCode ?? "",
    file.organizationName ?? "",
    file.periodFrom ?? "",
    file.periodTo ?? "",
  ].join("|")
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [files, setFiles] = useState<DetectedImportDocument[]>([])
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [executionMessage, setExecutionMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<ImportHistoryEntry[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [allowRepeatedPeriods, setAllowRepeatedPeriods] = useState(false)
  const [historyStatusFilter, setHistoryStatusFilter] = useState<HistoryStatusFilter>("all")

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

  const runnableFiles = useMemo(() => {
    return files.filter(
      (file) => file.validationStatus === "READY" || file.validationStatus === "WARNING"
    )
  }, [files])

  const importPreview = useMemo(() => {
    const groups = new Map<string, { label: string; count: number }>()

    for (const file of runnableFiles) {
      const key = `${file.ledgerAccount ?? "?"}|${file.importerCode ?? "unknown"}`
      const label = `${file.ledgerAccount ?? "?"} • ${documentFamilyLabel(file.documentFamily)}`
      const current = groups.get(key)
      if (current) {
        current.count += 1
      } else {
        groups.set(key, { label, count: 1 })
      }
    }

    return [...groups.values()]
  }, [runnableFiles])

  const reimportMatches = useMemo(() => {
    if (history.length === 0 || files.length === 0) return [] as ReimportMatch[]

    const matches: ReimportMatch[] = []
    const seen = new Set<string>()

    for (const file of files) {
      const key = getDocumentKey(file)
      if (!file.ledgerAccount || (!file.periodFrom && !file.periodTo)) continue

      for (const job of history) {
        if (job.status === "failed") continue

        for (const historyFile of job.files) {
          const historyKey = getDocumentKey(historyFile)
          if (key !== historyKey) continue

          const dedupeKey = `${file.fileHash}|${job.importJobId}|${historyFile.fileHash ?? historyFile.fileName}`
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)
          matches.push({ file, job, matchedHistoryFile: historyFile })
        }
      }
    }

    return matches
  }, [files, history])

  const filteredHistory = useMemo(() => {
    if (historyStatusFilter === "all") return history
    return history.filter((job) => job.status === historyStatusFilter)
  }, [history, historyStatusFilter])

  async function loadHistory() {
    setIsHistoryLoading(true)
    setHistoryError(null)

    try {
      const response = await fetch("/api/import-documents/history", {
        method: "GET",
        cache: "no-store",
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? "Не удалось загрузить журнал импортов")
      }

      const payload = (await response.json()) as ImportHistoryResponse
      setHistory(payload.jobs ?? [])
    } catch (historyRequestError) {
      setHistoryError(
        historyRequestError instanceof Error
          ? historyRequestError.message
          : "Не удалось загрузить журнал импортов"
      )
    } finally {
      setIsHistoryLoading(false)
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  useEffect(() => {
    if (reimportMatches.length === 0) {
      setAllowRepeatedPeriods(false)
    }
  }, [reimportMatches.length])

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
      setSelectedFiles(candidates)
      setFiles(payload.files)
      setExecutionMessage(null)
      setAllowRepeatedPeriods(false)
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

  async function executeImport() {
    if (runnableFiles.length === 0) {
      setExecutionMessage("Нет документов, готовых к запуску импорта.")
      return
    }

    if (selectedFiles.length === 0) {
      setExecutionMessage("Не найдены исходные файлы для серверного импорта. Загрузите набор заново.")
      return
    }

    if (reimportMatches.length > 0 && !allowRepeatedPeriods) {
      setExecutionMessage(
        "Найдены документы за уже загруженный счет и период. Подтвердите повторную загрузку перед запуском."
      )
      return
    }

    setIsExecuting(true)
    setExecutionMessage(null)

    try {
      const formData = new FormData()
      formData.append("documents", JSON.stringify(runnableFiles))
      selectedFiles.forEach((file) => formData.append("files", file))

      const response = await fetch("/api/import-documents/execute", {
        method: "POST",
        body: formData,
      })

      const rawText = await response.text()
      const payload = (() => {
        try {
          return JSON.parse(rawText) as { error?: string; message?: string }
        } catch {
          return null
        }
      })()

      if (!response.ok) {
        const fallbackText = rawText
          ? rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)
          : null
        throw new Error(
          payload?.error ??
            payload?.message ??
            fallbackText ??
            "Не удалось запустить импорт"
        )
      }

      setExecutionMessage(payload?.message ?? "Импорт запущен")
      await loadHistory()
    } catch (executionError) {
      setExecutionMessage(
        executionError instanceof Error
          ? executionError.message
          : "Не удалось запустить импорт"
      )
    } finally {
      setIsExecuting(false)
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

      {reimportMatches.length > 0 ? (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Найдена повторная загрузка периода</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              В журнале уже есть импорт по тем же счетам и периодам. Повторная загрузка может
              перезаписать ожидания по данным или добавить только часть новых строк.
            </p>
            <div className="space-y-1 text-sm">
              {reimportMatches.slice(0, 6).map((match) => (
                <div
                  key={`${match.file.fileHash}-${match.job.importJobId}-${match.matchedHistoryFile.fileName}`}
                >
                  {match.file.fileName} → уже загружался {formatJournalDate(
                    match.job.completedAt || match.job.createdAt
                  )}
                </div>
              ))}
              {reimportMatches.length > 6 ? (
                <div>И еще {reimportMatches.length - 6} совпадений.</div>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Предпросмотр импорта</CardTitle>
          <CardDescription>
            Сводка по документам, которые сейчас готовы к запуску на сервере.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {importPreview.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Готовых документов пока нет.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {importPreview.map((item) => (
                <Card key={item.label} className="gap-3 py-4">
                  <CardHeader className="pb-0">
                    <CardDescription>{item.label}</CardDescription>
                    <CardTitle className="text-2xl">{item.count}</CardTitle>
                  </CardHeader>
                </Card>
              ))}
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
      <Card>
        <CardHeader>
          <CardTitle>Подтверждение импорта</CardTitle>
          <CardDescription>
            Запуск берёт только документы со статусом `Готов` или `Предупреждение`.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reimportMatches.length > 0 ? (
            <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <Checkbox
                checked={allowRepeatedPeriods}
                onCheckedChange={(checked) => setAllowRepeatedPeriods(checked === true)}
                className="mt-0.5"
              />
              <span className="space-y-1">
                <span className="block font-medium">
                  Разрешить повторную загрузку уже импортированного периода
                </span>
                <span className="block text-muted-foreground">
                  Используй это только если ты осознанно переимпортируешь те же документы или
                  догружаешь обновленную выгрузку за тот же период.
                </span>
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={() => void executeImport()}
              disabled={
                isExecuting ||
                runnableFiles.length === 0 ||
                (reimportMatches.length > 0 && !allowRepeatedPeriods)
              }
            >
              {isExecuting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Запускаем…
                </>
              ) : (
                "Импортировать"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFiles([])
                setSelectedFiles([])
                setError(null)
                setExecutionMessage(null)
                setAllowRepeatedPeriods(false)
              }}
              disabled={isExecuting}
            >
              Очистить список
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            Готово к запуску:{" "}
            <span className="font-medium text-foreground">{runnableFiles.length}</span>
          </div>

          {executionMessage ? (
            <Alert>
              <Upload className="h-4 w-4" />
              <AlertTitle>Результат запуска</AlertTitle>
              <AlertDescription>{executionMessage}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Журнал загрузок</CardTitle>
          <CardDescription>
            Последние запуски импорта с итогами по файлам, вставленным данным и предупреждениям.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              ["all", "Все"],
              ["success", "Успешно"],
              ["partial_success", "Частично"],
              ["failed", "Ошибки"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={historyStatusFilter === value ? "default" : "outline"}
                size="sm"
                onClick={() => setHistoryStatusFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          {historyError ? (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Не удалось загрузить журнал</AlertTitle>
              <AlertDescription>{historyError}</AlertDescription>
            </Alert>
          ) : isHistoryLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем последние импорты...
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Для выбранного фильтра пока нет записей.
            </div>
          ) : (
            <Accordion type="single" collapsible className="rounded-lg border px-4">
              {filteredHistory.map((job) => (
                <AccordionItem key={job.importJobId} value={job.importJobId}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex min-w-0 flex-1 flex-col gap-2 text-left sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={journalStatusVariant(job.status)}>
                            {journalStatusLabel(job.status)}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {formatJournalDate(job.completedAt || job.createdAt)}
                          </span>
                        </div>
                        <div className="text-sm font-medium">
                          Документов: {job.documentsCount}, файлов: {job.filesCount}
                        </div>
                        {job.message ? (
                          <p className="line-clamp-2 text-sm text-muted-foreground">
                            {job.message}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4">
                    {job.errorText ? (
                      <p className="text-sm text-destructive">{job.errorText}</p>
                    ) : null}

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Файлы
                      </div>
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {job.files.map((file) => (
                          <div key={`${job.importJobId}-${file.fileHash ?? file.fileName}`}>
                            {file.fileName} • {file.ledgerAccount ?? "—"} •{" "}
                            {formatPeriod(file.periodFrom ?? null, file.periodTo ?? null)}
                          </div>
                        ))}
                      </div>
                    </div>

                    {job.importedSummaries.length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Импортировано
                        </div>
                        {job.importedSummaries.map((summaryItem, index) => (
                          <div key={`${job.importJobId}-imported-${index}`} className="text-sm">
                            {summaryItem}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {job.pendingSummaries.length > 0 ? (
                      <div className="space-y-1">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Примечания
                        </div>
                        {job.pendingSummaries.map((summaryItem, index) => (
                          <div
                            key={`${job.importJobId}-pending-${index}`}
                            className="text-sm text-muted-foreground"
                          >
                            {summaryItem}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
