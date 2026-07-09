import Link from "next/link";
import { ArrowRight, ChartNoAxesCombined, ShieldCheck, Upload } from "lucide-react";

const features = [
  { icon: Upload, title: "Контролируемый импорт", text: "PDF и XLSX с журналом обработки и сверкой." },
  { icon: ChartNoAxesCombined, title: "Единая картина", text: "Позиции, потоки и доходность в одном контуре." },
  { icon: ShieldCheck, title: "Прослеживаемость", text: "Роли, история изменений и изоляция семей." },
];

export default function Home() {
  return (
    <main className="min-h-screen px-6 py-8 sm:px-10 lg:px-16">
      <nav className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="text-sm font-semibold tracking-[0.18em] text-accent uppercase">
          Private Office
        </div>
        <Link className="rounded-full border border-border bg-surface px-5 py-2 text-sm font-medium" href="/login">
          Войти
        </Link>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-14 py-24 lg:grid-cols-[1.2fr_0.8fr] lg:py-32">
        <div>
          <p className="mb-6 text-sm font-medium text-muted">Система управления инвестиционным портфелем</p>
          <h1 className="max-w-3xl text-5xl leading-[1.05] font-semibold tracking-[-0.045em] sm:text-7xl">
            Решения начинаются с точных данных.
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-8 text-muted">
            Консолидируйте брокерские отчёты, проверяйте структуру и доходность,
            отслеживайте денежные потоки и получайте сигналы к действию.
          </p>
          <Link className="mt-10 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-medium text-white" href="/dashboard">
            Открыть приложение <ArrowRight size={18} />
          </Link>
        </div>
        <div className="grid content-end gap-4">
          {features.map(({ icon: Icon, title, text }) => (
            <article className="rounded-3xl border border-border bg-surface p-6" key={title}>
              <Icon className="mb-8 text-accent" size={24} />
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
