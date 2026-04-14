import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface KpiCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  description?: string
  trend?: "up" | "down" | "neutral"
  loading?: boolean
}

export function KpiCard({
  title,
  value,
  icon: Icon,
  description,
  trend,
  loading,
}: KpiCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon
          className={cn(
            "h-4 w-4",
            trend === "up" && "text-success",
            trend === "down" && "text-destructive",
            !trend && "text-muted-foreground"
          )}
        />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        ) : (
          <div className="text-2xl font-bold text-card-foreground">{value}</div>
        )}
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}
