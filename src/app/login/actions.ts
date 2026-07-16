"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function normalizeNextPath(value: FormDataEntryValue | null) {
  const nextPath = String(value || "/dashboard");
  return nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";
}

function redirectToLoginError(nextPath: string): never {
  redirect(`/login?next=${encodeURIComponent(nextPath)}&error=invalid`);
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const nextPath = normalizeNextPath(formData.get("next"));

  if (!email || !password) {
    redirectToLoginError(nextPath);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirectToLoginError(nextPath);
  }

  redirect(nextPath);
}
