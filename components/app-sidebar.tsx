"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState, type ComponentType } from "react"
import {
  LayoutDashboard,
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  TrendingUp,
  Landmark,
  HandCoins,
  FileArchive,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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

const SIDEBAR_STATE_KEY = "exclusive.sidebar.collapsed"

type SidebarLinkProps = {
  href: string
  label: string
  icon: ComponentType<{ className?: string }>
  isActive: boolean
  collapsed: boolean
  tone?: "primary" | "muted"
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  isActive,
  collapsed,
  tone = "primary",
}: SidebarLinkProps) {
  const link = (
    <Link
      href={href}
      className={cn(
        "flex items-center rounded-md text-sm font-medium transition-colors",
        collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : tone === "muted"
            ? "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed ? <span>{label}</span> : null}
    </Link>
  )

  if (!collapsed) {
    return link
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function AppSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const savedValue = window.localStorage.getItem(SIDEBAR_STATE_KEY)
    setCollapsed(savedValue === "true")
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    window.localStorage.setItem(SIDEBAR_STATE_KEY, String(collapsed))
  }, [collapsed, ready])

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-20" : "w-60"
      )}
    >
      <div
        className={cn(
          "flex items-center border-b border-sidebar-border py-5",
          collapsed ? "justify-center px-3" : "justify-between gap-2 px-5"
        )}
      >
        <div
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "gap-2"
          )}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
            <TrendingUp className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          {!collapsed ? (
            <span className="text-base font-semibold tracking-tight text-sidebar-foreground">
              EXCLUSIVE
            </span>
          ) : null}
        </div>
        {!collapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Свернуть меню"
            onClick={() => setCollapsed(true)}
            className="h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Развернуть меню"
                onClick={() => setCollapsed(false)}
                className="absolute top-5 h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              Развернуть меню
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {!collapsed ? (
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
            Navigation
          </p>
        ) : null}
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <SidebarLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              isActive={isActive}
              collapsed={collapsed}
            />
          )
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        {!collapsed ? (
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/40">
            Data
          </p>
        ) : null}
        <div className="space-y-1">
          {utilityItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/")
            return (
              <SidebarLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                isActive={isActive}
                collapsed={collapsed}
                tone="muted"
              />
            )
          })}
        </div>
        {!collapsed ? (
          <p className="px-3 py-3 text-xs text-sidebar-foreground/40">
            Single-object cashflow
          </p>
        ) : null}
      </div>
    </aside>
  )
}
