import { NextRequest } from "next/server"; export const dynamic = "force-dynamic"; const INTERNAL = 
process.env.SUPABASE_INTERNAL_URL; async function handler(req: NextRequest) {
  if (!INTERNAL) { return new Response("SUPABASE_INTERNAL_URL is not set", { status: 500 });
  }
  const url = new URL(req.url); const path = url.pathname.replace(/^\/supabase/, "") || "/"; const target = 
  INTERNAL.replace(/\/$/, "") + path + url.search;
  // Копируем заголовки (важно для apikey/authorization)
  const headers = new Headers(req.headers);
  // Убираем заголовки, которые могут мешать проксированию
  headers.delete("host"); headers.delete("connection"); headers.delete("content-length"); const method = 
  req.method.toUpperCase(); const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer(); 
  const upstream = await fetch(target, {
    method, headers, body, redirect: "manual",
  });
  const resHeaders = new Headers(upstream.headers);
  // иногда мешает при проксировании
  resHeaders.delete("content-encoding"); return new Response(upstream.body, { status: upstream.status, headers: 
    resHeaders,
  });
}
export const GET = handler; export const POST = handler; export const PUT = handler; export const PATCH = handler; 
export const DELETE = handler; export const OPTIONS = handler;
