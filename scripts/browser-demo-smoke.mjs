import { existsSync } from "node:fs";
import path from "node:path";

const defaultBaseUrl = "http://192.168.0.22:31010";
const baseUrl = (process.env.DEMO_BASE_URL || process.argv[2] || defaultBaseUrl).replace(/\/$/, "");
const fixturePath = path.resolve(process.env.DEMO_BROKER_REPORT_PATH || "../Брокерский пример .xls");
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || process.env.DEMO_BROWSER_CHANNEL || detectBrowserChannel();

const viewer = {
  email: process.env.DEMO_VIEWER_EMAIL,
  password: process.env.DEMO_VIEWER_PASSWORD,
};

const editor = {
  email: process.env.DEMO_EDITOR_EMAIL,
  password: process.env.DEMO_EDITOR_PASSWORD,
};

const admin = {
  email: process.env.DEMO_ADMIN_EMAIL,
  password: process.env.DEMO_ADMIN_PASSWORD,
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function required(value, name) {
  assert(value, `Missing ${name}`);
  return value;
}

function detectBrowserChannel() {
  if (process.platform !== "win32") return undefined;

  if (existsSync("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")) {
    return "msedge";
  }

  if (
    existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") ||
    existsSync("C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe")
  ) {
    return "chrome";
  }

  return undefined;
}

function validateDemoEnv() {
  required(viewer.email, "DEMO_VIEWER_EMAIL");
  required(viewer.password, "DEMO_VIEWER_PASSWORD");
  required(editor.email, "DEMO_EDITOR_EMAIL");
  required(editor.password, "DEMO_EDITOR_PASSWORD");
  required(admin.email, "DEMO_ADMIN_EMAIL");
  required(admin.password, "DEMO_ADMIN_PASSWORD");
}

function queryParam(page, name) {
  return new URL(page.url()).searchParams.get(name);
}

async function assertVisible(locator, message) {
  assert((await locator.count()) > 0, message);
  await locator.first().waitFor({ state: "visible", timeout: 15_000 });
}

async function assertNoVisible(locator, message) {
  assert((await locator.count()) === 0, message);
}

async function isVisible(locator) {
  if ((await locator.count()) === 0) return false;
  return locator.first().isVisible();
}

async function waitForLatestImportStatus(page, statuses) {
  await page.waitForFunction(
    (expectedStatuses) => {
      const firstCard = document.querySelector('[data-testid="import-card"]');
      return Boolean(firstCard && expectedStatuses.includes(firstCard.getAttribute("data-status")));
    },
    statuses,
    { timeout: 30_000 },
  );

  return page.getByTestId("import-card").first();
}

async function submitActionForm(page, trigger, urlPredicate, timeout = 30_000) {
  await Promise.all([
    page.waitForURL(urlPredicate, { timeout }),
    trigger.first().evaluate((element) => element.closest("form")?.requestSubmit()),
  ]);
  await page.waitForLoadState("networkidle");
}

async function selectFirstAccount(page) {
  const accountSelect = page.getByTestId("import-account-select");
  await assertVisible(accountSelect, "editor should see account selector");

  const accountOptions = await accountSelect.locator("option").evaluateAll((options) =>
    options.map((option) => ({ value: option.value, text: option.textContent || "" })).filter((option) => option.value),
  );
  assert(accountOptions.length > 0, "editor needs at least one active account");

  await accountSelect.selectOption(accountOptions[0].value);
  return accountOptions[0].value;
}

async function uploadFixture(page, accountId) {
  await assertVisible(page.getByTestId("import-upload-form"), "editor should see upload form");
  await page.getByTestId("import-account-select").selectOption(accountId);
  await page.getByTestId("import-file-input").setInputFiles(fixturePath);
  await submitActionForm(page, page.getByTestId("import-upload-button"), (url) => url.href.includes("uploaded=1") || url.href.includes("error="));
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright is not installed. Run `npm install -D playwright` before browser demo smoke.");
  }
}

async function login(page, user) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill(required(user.email, "email"));
  await page.locator('input[name="password"]').fill(required(user.password, "password"));
  await Promise.all([
    page.waitForURL((url) => url.origin === new URL(baseUrl).origin && url.pathname !== "/login", { timeout: 20_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.waitForFunction(
    () => document.cookie.split(";").some((cookie) => cookie.trim().startsWith("sb-") && cookie.includes("auth-token")),
    { timeout: 10_000 },
  );
  await page.waitForLoadState("networkidle");
}

async function assertViewerReadOnly(page) {
  await login(page, {
    email: required(viewer.email, "DEMO_VIEWER_EMAIL"),
    password: required(viewer.password, "DEMO_VIEWER_PASSWORD"),
  });

  await page.goto(`${baseUrl}/import`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("import-readonly"), "viewer should see read-only import mode");
  await assertNoVisible(page.getByTestId("import-upload-form"), "viewer should not see upload form");
  await assertNoVisible(page.getByTestId("import-file-input"), "viewer should not see upload input");
  await assertNoVisible(page.getByTestId("import-parse-button"), "viewer should not see parse action");
  await assertNoVisible(page.getByTestId("import-apply-button"), "viewer should not see apply action");

  await page.goto(`${baseUrl}/recommendations`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("recommendations-view"), "viewer should open recommendations");
  await assertNoVisible(page.getByTestId("recommendation-accept-button"), "viewer should not accept recommendations");
  await assertNoVisible(page.getByTestId("recommendation-reject-button"), "viewer should not reject recommendations");

  await page.goto(`${baseUrl}/news`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("news-view"), "viewer should open news");
  await assertNoVisible(page.getByTestId("news-watchlist-button"), "viewer should not save news to watchlist");

  await page.goto(`${baseUrl}/watchlist`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("watchlist-view"), "viewer should open watchlist");
  await assertNoVisible(page.getByTestId("watchlist-save-button"), "viewer should not edit watchlist");

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("limits-settings"), "viewer should see limits settings section");
  await assertNoVisible(page.getByTestId("create-default-limits-button"), "viewer should not create default limits");
  await assertNoVisible(page.getByTestId("check-limits-button"), "viewer should not check limits");
  console.log("ok viewer read-only import");
}

async function assertAdminEditableAccess(page) {
  await login(page, {
    email: required(admin.email, "DEMO_ADMIN_EMAIL"),
    password: required(admin.password, "DEMO_ADMIN_PASSWORD"),
  });

  await page.goto(`${baseUrl}/import`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("import-upload-form"), "admin should see upload form");
  await assertNoVisible(page.getByTestId("import-readonly"), "admin should not see read-only import mode");

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  assert((await page.locator("text=Audit").count()) > 0, "admin should open settings and see audit block");
  await assertVisible(page.getByTestId("limits-settings"), "admin should see limits settings");
  if ((await page.getByTestId("limit-card").count()) === 0 && (await isVisible(page.getByTestId("create-default-limits-button")))) {
    await submitActionForm(page, page.getByTestId("create-default-limits-button"), (url) => url.href.includes("stage5_saved=") || url.href.includes("stage5_error="));
  }
  await assertVisible(page.getByTestId("check-limits-button"), "admin should see limit check action");
  await submitActionForm(page, page.getByTestId("check-limits-button"), (url) => url.href.includes("stage5_saved=") || url.href.includes("stage5_error="));
  console.log("ok admin editable access");
}

async function assertDashboardAnalytics(page) {
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("dashboard-view"), "editor should open dashboard");
  await assertVisible(page.getByTestId("dashboard-kpi-grid"), "dashboard should show KPI grid");
  await assertVisible(page.getByTestId("dashboard-kpi-total-value"), "dashboard should show total value KPI");
  await assertVisible(page.getByTestId("dashboard-kpi-cash"), "dashboard should show cash KPI");
  await assertVisible(page.getByTestId("dashboard-kpi-pnl"), "dashboard should show P&L KPI");
  await assertVisible(page.getByTestId("dashboard-kpi-xirr"), "dashboard should show XIRR KPI");
  await assertVisible(page.getByTestId("dashboard-kpi-inflow"), "dashboard should show inflow KPI");
  await assertVisible(page.getByTestId("dashboard-structure-asset-type"), "dashboard should show asset-type structure");
  await assertVisible(page.getByTestId("dashboard-cash-flows"), "dashboard should show cash-flow section");
  await assertVisible(page.getByTestId("dashboard-cash-flow-table"), "dashboard should show cash-flow table or empty state");
  await assertVisible(page.getByTestId("dashboard-structure-secondary"), "dashboard should show currency/account structure");
  await assertVisible(page.getByTestId("dashboard-xirr-detail"), "dashboard should show XIRR detail");
  await assertVisible(page.getByTestId("dashboard-xirr-cash-flows"), "dashboard should show XIRR cash-flow rows");
  await assertVisible(page.getByTestId("dashboard-stage-5-signals"), "dashboard should show stage 5 signals");

  await page.getByRole("link", { name: "YTD" }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard" && url.searchParams.get("dashboard_period") === "YTD", { timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  await assertVisible(page.getByTestId("dashboard-cash-flows"), "dashboard should keep cash-flow section after period switch");
  console.log("ok dashboard analytics");
}

async function assertStage5Signals(page) {
  await page.goto(`${baseUrl}/recommendations`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("recommendations-view"), "editor should open recommendations");
  await assertVisible(page.getByTestId("recommendation-filters-form"), "recommendations should show filters");
  await assertVisible(page.getByTestId("recommendation-card"), "recommendations should show a recommendation card");

  if (await isVisible(page.getByTestId("recommendation-read-button"))) {
    await submitActionForm(page, page.getByTestId("recommendation-read-button"), (url) => url.href.includes("stage5_saved=") || url.href.includes("stage5_error="));
  }

  if (await isVisible(page.getByTestId("recommendation-accept-button"))) {
    await submitActionForm(page, page.getByTestId("recommendation-accept-button"), (url) => url.href.includes("stage5_saved=") || url.href.includes("stage5_error="));
  }
  console.log("ok stage 5 recommendations");

  await page.goto(`${baseUrl}/news`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("news-view"), "editor should open news");
  await assertVisible(page.getByTestId("news-filters-form"), "news should show filters");
  await assertVisible(page.getByTestId("news-card"), "news should show at least one news item or idea");

  if (await isVisible(page.getByTestId("news-watchlist-button"))) {
    await submitActionForm(page, page.getByTestId("news-watchlist-button"), (url) => url.href.includes("stage5_saved=") || url.href.includes("stage5_error="));
  }
  console.log("ok stage 5 news");

  await page.goto(`${baseUrl}/watchlist`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("watchlist-view"), "editor should open watchlist");
  await assertVisible(page.getByTestId("watchlist-filters-form"), "watchlist should show filters");

  if (await isVisible(page.getByTestId("watchlist-save-button"))) {
    const noteInput = page.locator('input[name="notes"]').first();
    if (await noteInput.isVisible()) {
      await noteInput.fill(`smoke ${new Date().toISOString()}`);
    }
    await submitActionForm(page, page.getByTestId("watchlist-save-button"), (url) => url.href.includes("stage5_saved=") || url.href.includes("stage5_error="));
  }
  console.log("ok stage 5 watchlist");

  await page.goto(`${baseUrl}/events`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("events-view"), "editor should open events");
  await assertVisible(page.getByTestId("events-filters-form"), "events should show filters");
  await assertVisible(page.getByTestId("event-card"), "events should show event cards");
  console.log("ok stage 5 events");
}

async function assertEditorImportFlow(page) {
  await login(page, {
    email: required(editor.email, "DEMO_EDITOR_EMAIL"),
    password: required(editor.password, "DEMO_EDITOR_PASSWORD"),
  });

  await page.goto(`${baseUrl}/import`, { waitUntil: "networkidle" });
  const accountId = await selectFirstAccount(page);

  await uploadFixture(page, accountId);
  if (queryParam(page, "error") === "duplicate") {
    console.log("ok duplicate upload protection before fresh import; continuing with existing demo data");
    await assertDashboardAnalytics(page);
    await assertStage5Signals(page);

    await page.goto(`${baseUrl}/assets`, { waitUntil: "networkidle" });
    await assertVisible(page.getByTestId("assets-view"), "editor should open assets");
    await assertVisible(page.getByTestId("positions-view"), "assets should show positions from existing demo data");
    console.log("ok assets opened");

    await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
    assert((await page.locator("text=Audit").count()) > 0, "settings should show audit block");
    console.log("ok audit visible");
    return;
  }
  assert(queryParam(page, "uploaded") === "1", "upload should redirect with uploaded=1");
  await waitForLatestImportStatus(page, ["uploaded"]);
  console.log("ok uploaded status");

  await submitActionForm(
    page,
    page.getByTestId("import-parse-button"),
    (url) => url.href.includes("parsed=1") || url.href.includes("parse_error="),
  );
  assert(queryParam(page, "parsed") === "1" || queryParam(page, "parse_error") === "row-validation", "parse should finish or enter reconciliation");
  await waitForLatestImportStatus(page, ["parsed", "failed"]);
  await assertVisible(page.getByTestId("import-row-summary"), "parsed import should show row summary");
  await assertVisible(page.getByTestId("import-rows-table"), "parsed import should show rows table");
  await assertVisible(page.getByTestId("import-row-raw-details"), "parsed import should expose raw row data");
  await assertVisible(page.getByTestId("import-row-normalized-details"), "parsed import should expose normalized row data");
  console.log("ok parsed/reconcile details");

  await assertVisible(page.getByTestId("import-apply-button"), "parsed import should expose apply action");
  await submitActionForm(page, page.getByTestId("import-apply-button"), (url) => url.href.includes("applied=1") || url.href.includes("apply_error="));
  assert(queryParam(page, "applied") === "1", "apply should redirect with applied=1");
  await waitForLatestImportStatus(page, ["applied"]);
  console.log("ok applied status");

  await assertDashboardAnalytics(page);
  await assertStage5Signals(page);

  await page.goto(`${baseUrl}/assets`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("assets-view"), "editor should open assets");
  await assertVisible(page.getByTestId("positions-view"), "assets should show positions after apply");
  console.log("ok assets opened");

  await page.goto(`${baseUrl}/import`, { waitUntil: "networkidle" });
  await uploadFixture(page, accountId);
  assert(queryParam(page, "error") === "duplicate", "re-uploading the same file should be blocked as duplicate");
  console.log("ok duplicate upload protection");

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  assert((await page.locator("text=Audit").count()) > 0, "settings should show audit block");
  console.log("ok audit visible");
}

async function main() {
  assert(existsSync(fixturePath), `Broker report fixture not found: ${fixturePath}`);
  validateDemoEnv();
  const { chromium } = await loadPlaywright();
  const launchOptions = browserChannel ? { channel: browserChannel, headless: true } : { headless: true };
  let browser;

  try {
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    const hint =
      "Unable to launch a browser. Run `npx playwright install chromium` or set PLAYWRIGHT_CHANNEL/DEMO_BROWSER_CHANNEL to an installed channel such as `msedge` or `chrome`.";
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`${hint}\n${details}`);
  }

  try {
    const viewerContext = await browser.newContext();
    await assertViewerReadOnly(await viewerContext.newPage());
    await viewerContext.close();

    const adminContext = await browser.newContext();
    await assertAdminEditableAccess(await adminContext.newPage());
    await adminContext.close();

    const editorContext = await browser.newContext();
    await assertEditorImportFlow(await editorContext.newPage());
    await editorContext.close();

    console.log("Browser demo smoke passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Browser demo smoke failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
