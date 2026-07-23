const defaultBaseUrl = "http://localhost:3000";
const baseUrl = (process.argv[2] || process.env.BASE_URL || defaultBaseUrl).replace(/\/$/, "");

const protectedRoutes = [
  "/dashboard",
  "/accounts",
  "/assets",
  "/import",
  "/recommendations",
  "/what-if",
  "/news",
  "/watchlist",
  "/events",
  "/settings",
];

function url(path) {
  return `${baseUrl}${path}`;
}

async function readText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function checkJson(path, validate) {
  const response = await fetch(url(path), { redirect: "manual" });
  assert(response.status === 200, `${path}: expected HTTP 200, got ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  assert(contentType.includes("application/json"), `${path}: expected JSON response`);
  const payload = await response.json();
  validate(payload);
  console.log(`ok ${path}`);
}

async function checkPage(path, expectedText) {
  const response = await fetch(url(path), { redirect: "manual" });
  assert(response.status === 200, `${path}: expected HTTP 200, got ${response.status}`);
  const body = await readText(response);
  assert(body.includes(expectedText), `${path}: expected page text "${expectedText}"`);
  console.log(`ok ${path}`);
}

async function checkProtectedRedirect(path) {
  const response = await fetch(url(path), { redirect: "manual" });
  assert([302, 303, 307, 308].includes(response.status), `${path}: expected redirect, got ${response.status}`);

  const location = response.headers.get("location") || "";
  assert(location.includes("/login"), `${path}: expected redirect to /login, got "${location}"`);
  assert(location.includes("next="), `${path}: expected redirect with next parameter, got "${location}"`);
  console.log(`ok ${path} -> /login`);
}

try {
  console.log(`Smoke target: ${baseUrl}`);

  await checkJson("/api/health", (payload) => {
    assert(payload.status === "ok", "/api/health: expected status=ok");
    assert(payload.service === "investment-portfolio", "/api/health: expected service=investment-portfolio");
  });

  await checkPage("/", "Система управления инвестиционным портфелем");
  await checkPage("/login", "Вход");

  for (const route of protectedRoutes) {
    await checkProtectedRedirect(route);
  }

  console.log("Smoke passed.");
} catch (error) {
  console.error("Smoke failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
