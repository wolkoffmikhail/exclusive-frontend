"use client";

import { useFormStatus } from "react-dom";

export function AdvisorSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      aria-disabled={pending}
      className="h-11 rounded-2xl bg-accent px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
      disabled={pending}
      type="submit"
    >
      {pending ? "Отвечаю..." : "Спросить"}
    </button>
  );
}
