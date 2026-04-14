"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { cn } from "@/lib/utils"

interface CashflowChartProps {
  data: { dt: string; inflow: number | string; outflow: number | string; net: number | string }[]
  loading?: boolean
}

const labelByKey: Record<string, string> = {
  net: "Чистый поток",
  inflow: "Поступления",
  outflow: "Платежи",
}

const seriesConfig = [
  { key: "net", label: "Чистый поток", color: "var(--color-chart-1)" },
  { key: "inflow", label: "Поступления", color: "var(--color-chart-2)" },
  { key: "outflow", label: "Платежи", color: "var(--color-chart-3)" },
] as const

function getNumericValue(value: unknown) {
  if (Array.isArray(value)) {
    return Number(value[0] ?? 0) || 0
  }

  return Number(value ?? 0) || 0
}

export function CashflowChart({ data, loading }: CashflowChartProps) {
  const [visibleSeries, setVisibleSeries] = useState<Set<string>>(
    new Set(["net", "inflow", "outflow"])
  )

  const toggleSeries = (key: string) => {
    setVisibleSeries((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size > 1) next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const normalizedData = (data ?? []).map((row) => {
    const dt =
      typeof row.dt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.dt)
        ? `${row.dt}T00:00:00`
        : row.dt

    return {
      dt,
      inflow: Number(row.inflow ?? 0) || 0,
      outflow: Number(row.outflow ?? 0) || 0,
      net: Number(row.net ?? 0) || 0,
    }
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-card-foreground">
          Движение денежных средств по дням
        </CardTitle>
        <div className="flex items-center gap-1">
          {seriesConfig.map((series) => (
            <Button
              key={series.key}
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 px-2.5 text-xs",
                visibleSeries.has(series.key)
                  ? "text-foreground"
                  : "text-muted-foreground/50"
              )}
              onClick={() => toggleSeries(series.key)}
            >
              <span
                className="mr-1.5 inline-block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: visibleSeries.has(series.key)
                    ? series.color
                    : "var(--color-muted)",
                }}
              />
              {series.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-72 animate-pulse rounded bg-muted" />
        ) : data.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
            Нет данных за выбранный период.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart
              data={normalizedData}
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="dt"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return `${date.getDate()}.${date.getMonth() + 1}`
                }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) =>
                  `${new Intl.NumberFormat("ru-RU", {
                    notation: "compact",
                    compactDisplay: "short",
                  }).format(Number(value ?? 0))} ₽`
                }
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  borderColor: "var(--color-border)",
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                  color: "var(--color-card-foreground)",
                }}
                formatter={(value, name) => {
                  const numericValue = getNumericValue(value)
                  const formatted = new Intl.NumberFormat("ru-RU", {
                    style: "currency",
                    currency: "RUB",
                    maximumFractionDigits: 0,
                  }).format(numericValue)

                  const key = String(name ?? "")
                  const label = labelByKey[key] ?? key
                  return [formatted, label]
                }}
                labelFormatter={(label) => {
                  const date = new Date(label)
                  return date.toLocaleDateString("ru-RU", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                }}
              />
              {seriesConfig.map((series) =>
                visibleSeries.has(series.key) ? (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
