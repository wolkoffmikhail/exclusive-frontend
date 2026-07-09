import { notFound } from "next/navigation";

const sections: Record<string, { title: string; description: string }> = {
  dashboard: { title: "Обзор портфеля", description: "Структура, доходность, денежные потоки и ближайшие действия." },
  accounts: { title: "Счета", description: "Брокерские и банковские счета семьи." },
  assets: { title: "Активы", description: "Позиции, оценки и доли активов." },
  import: { title: "Импорт", description: "Загрузка брокерских отчётов и журнал обработки." },
  recommendations: { title: "Рекомендации", description: "Сигналы и предложения по управлению портфелем." },
  news: { title: "Новости", description: "Новости, связанные с активами портфеля." },
  watchlist: { title: "Watchlist", description: "Активы и идеи для наблюдения." },
  events: { title: "События", description: "Дивиденды, купоны и погашения." },
  settings: { title: "Настройки", description: "Семья, пользователи, валюты и правила импорта." },
};

export function generateStaticParams() {
  return Object.keys(sections).map((section) => ({ section }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const current = sections[section];
  if (!current) notFound();

  return (
    <section>
      <p className="text-sm font-medium text-accent">Первый этап</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{current.title}</h1>
      <p className="mt-3 max-w-2xl text-muted">{current.description}</p>
      <div className="mt-10 rounded-3xl border border-dashed border-border bg-surface p-10">
        <p className="text-sm font-medium">Каркас раздела готов</p>
        <p className="mt-2 text-sm text-muted">Данные и действия будут подключены на соответствующем этапе разработки.</p>
      </div>
    </section>
  );
}
