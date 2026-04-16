"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  TrendingUp,
  Landmark,
  HandCoins,
  FileArchive,
} from "lucide-react"
import { cn } from "@/lib/utils"

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Реестр поступлений",
    href: "/registries/income",
    icon: ArrowDownLeft,
  },
  {
    label: "Реестр платежей",
    href: "/registries/expense",
    icon: ArrowUpRight,
  },
  {
    label: "Баланс счетов",
    href: "/balances",
    icon: Wallet,
  },
  {
    label: "Депозиты",
    href: "/deposits",
    icon: Landmark,
  },
  {
    label: "Кредиты и займы",
    href: "/liabilities",
    icon: HandCoins,
  },
]

const utilityItems = [
  {
    label: "Загрузка данных",
    href: "/upload",
    icon: FileArchive,
  },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 border-b border-sidebar-border px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
          <TrendingUp className="h-4 w-4 text-sidebar-primary-foreground" />
        </div>
        <span className="text-base font-semibold tracking-tight text-sidebar-foreground">
          EXCLUSIVE
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
          Navigation
        </p>
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/40">
          Data
        </p>
        <div className="space-y-1">
          {utilityItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </div>
        <p className="px-3 py-3 text-xs text-sidebar-foreground/40">
          Single-object cashflow
        </p>
      </div>
    </aside>
  )
}
