import { Suspense } from "react";
import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string | string[];
    next?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeNextPath(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(firstParam(params?.next));
  const hasLoginError = firstParam(params?.error) === "invalid";

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <section className="w-full max-w-md rounded-3xl border border-border bg-surface p-8">
        <p className="text-sm font-medium text-accent">Private Office</p>
        <h1 className="mt-3 text-3xl font-semibold">Вход</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Используйте учетную запись, выданную администратором семьи.
        </p>
        <Suspense fallback={<p className="mt-8 text-sm text-muted">Загрузка формы...</p>}>
          <LoginForm error={hasLoginError} nextPath={nextPath} />
        </Suspense>
      </section>
    </main>
  );
}
