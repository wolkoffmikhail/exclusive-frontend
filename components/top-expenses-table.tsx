"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface TopExpensesTableProps {
  data: { expense_code: string; expense_name: string; total: number }[]
  loading?: boolean
}

export function TopExpensesTable({ data, loading }: TopExpensesTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-card-foreground">
          Топ 10 Статей Расходов
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Нет расходов за выбранный период.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Статья затрат
                </TableHead>
                <TableHead className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Наименование статьи
                </TableHead>
                <TableHead className="text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Сумма
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.expense_code}>
                  <TableCell className="font-mono text-sm">
                    {row.expense_code}
                  </TableCell>
                  <TableCell className="text-sm">{row.expense_name}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {new Intl.NumberFormat("ru-RU", {
                      style: "currency",
                      currency: "RUB",
                      minimumFractionDigits: 2,
                    }).format(row.total)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
