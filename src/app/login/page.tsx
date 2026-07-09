import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="w-full max-w-md rounded-3xl border border-border bg-surface p-8">
        <p className="text-sm font-medium text-accent">Private Office</p>
        <h1 className="mt-3 text-3xl font-semibold">Вход</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Форма будет подключена к существующему Supabase Auth после фиксации схемы пользователей и семей.
        </p>
        <Link className="mt-8 block rounded-xl bg-accent px-4 py-3 text-center font-medium text-white" href="/dashboard">
          Открыть демо-каркас
        </Link>
      </section>
    </main>
  );
}
