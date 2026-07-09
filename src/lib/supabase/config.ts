const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is missing");
  }
  const resolvedUrl = url.startsWith("/")
    ? new URL(url, window.location.origin).toString()
    : url;
  return { url: resolvedUrl, key: publishableKey };
}

export function getSupabaseServerConfig() {
  const url =
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !publishableKey) {
    throw new Error("Supabase server configuration is missing");
  }
  return { url, key: publishableKey };
}
