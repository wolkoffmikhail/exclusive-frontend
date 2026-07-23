import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, BriefcaseBusiness, LogOut } from "lucide-react";
import { getActiveFamily } from "@/lib/portfolio/data";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

const navigation = [
  ["dashboard", "Обзор"],
  ["accounts", "Счета"],
  ["assets", "Активы"],
  ["import", "Импорт"],
  ["recommendations", "Рекомендации"],
  ["what-if", "What-if"],
  ["news", "Новости"],
  ["watchlist", "Watchlist"],
  ["events", "События"],
  ["settings", "Настройки"],
] as const;

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const family = await getActiveFamily(supabase, userId);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-border bg-[#10271c] p-6 text-white lg:min-h-screen lg:border-r">
        <Link className="flex items-center gap-3 text-lg font-semibold" href="/dashboard">
          <span className="grid size-9 place-items-center rounded-xl bg-white/10">
            <BriefcaseBusiness size={19} />
          </span>
          Портфель
        </Link>
        <nav className="mt-10 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
          {navigation.map(([slug, label]) => (
            <Link
              className="rounded-xl px-3 py-2.5 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
              href={`/${slug}`}
              key={slug}
            >
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <div>
        <header className="flex h-20 items-center justify-between border-b border-border bg-surface px-6 lg:px-10">
          <div>
            <p className="text-xs text-muted">Активная семья</p>
            <p className="font-medium">{family?.name ?? "Семья не назначена"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label="Уведомления" className="rounded-full border border-border p-2.5">
              <Bell size={18} />
            </button>
            <form action={signOut}>
              <button aria-label="Выйти" className="rounded-full border border-border p-2.5" type="submit">
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </header>
        <main className="p-6 lg:p-10">{children}</main>
      </div>
    </div>
  );
}
