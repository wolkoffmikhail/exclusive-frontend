import { signIn } from "./actions";

type LoginFormProps = {
  error?: boolean;
  nextPath?: string;
};

export function LoginForm({ error = false, nextPath = "/dashboard" }: LoginFormProps) {
  return (
    <form action={signIn} className="mt-8 space-y-5">
      <input name="next" type="hidden" value={nextPath} />
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
      {error ? <p className="text-sm text-red-700">Неверная почта или пароль</p> : null}
      <button className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-white" type="submit">
        Войти
      </button>
    </form>
  );
}
