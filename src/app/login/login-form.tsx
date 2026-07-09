"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError("Неверная почта или пароль");
      setPending(false);
      return;
    }

    const nextPath = searchParams.get("next");
    router.replace(nextPath?.startsWith("/") ? nextPath : "/dashboard");
    router.refresh();
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <label className="block text-sm font-medium">
        Электронная почта
        <input
          autoComplete="email"
          className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-3 outline-none focus:border-accent"
          name="email"
          required
          type="email"
        />
      </label>
      <label className="block text-sm font-medium">
        Пароль
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-border bg-white px-4 py-3 outline-none focus:border-accent"
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
