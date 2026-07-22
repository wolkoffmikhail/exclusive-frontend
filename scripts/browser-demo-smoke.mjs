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

function daysFromNowIsoDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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

async function visibleCount(locator) {
  const count = await locator.count();
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) visible += 1;
  }
  return visible;
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

async function submitStage5Action(page, trigger, expectedSavedValues = [], timeout = 30_000) {
  await submitActionForm(
    page,
    trigger,
    (url) => {
      const saved = url.searchParams.get("stage5_saved");
      return Boolean((saved && (expectedSavedValues.length === 0 || expectedSavedValues.includes(saved))) || url.searchParams.get("stage5_error"));
    },
    timeout,
  );
  const error = queryParam(page, "stage5_error");
  assert(!error, `stage 5 action should not fail: ${error}`);
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
  await assertLimitAlertLifecycle(page);
  console.log("ok admin editable access");
}

async function ensureDefaultLimits(page) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("limits-settings"), "admin should see limits settings");
  await assertVisible(page.getByTestId("create-default-limits-button"), "admin should see default limit action");
  await submitStage5Action(page, page.getByTestId("create-default-limits-button"), ["limits-template", "limits-template-empty"]);
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("limit-card"), "default limits should be present");
}

async function configureLimit(page, limitId, { direction, severity, threshold, type }) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  const limitCard = page.locator(`[data-limit-id="${limitId}"]`);
  await assertVisible(limitCard, "target limit should remain available");

  await limitCard.locator('select[name="limit_type"]').selectOption(type);
  await limitCard.locator('select[name="direction"]').selectOption(direction);
  await limitCard.locator('select[name="severity"]').selectOption(severity);
  await limitCard.locator('input[name="scope_key"]').fill("");
  await limitCard.locator('input[name="threshold_value"]').fill(String(threshold));
  await submitStage5Action(page, limitCard.locator("form").nth(1).locator('button[type="submit"]'), ["limit-updated"]);
}

async function checkLimitsFromSettings(page) {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("check-limits-button"), "admin should see limit check action");
  await submitStage5Action(page, page.getByTestId("check-limits-button"), ["limits-checked", "limits-checked-partial", "limits-checked-with-alerts"]);
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  return visibleCount(page.getByTestId("limit-alert-card"));
}

async function assertLimitAlertLifecycle(page) {
  await ensureDefaultLimits(page);

  const limitId = await page.getByTestId("limit-card").first().getAttribute("data-limit-id");
  assert(limitId, "limit card should expose a stable id");

  try {
    await configureLimit(page, limitId, { type: "cash_max_share", direction: "max", severity: "warning", threshold: 1 });
    const calmAlertCount = await checkLimitsFromSettings(page);

    await configureLimit(page, limitId, { type: "cash_min_share", direction: "min", severity: "warning", threshold: 0.9999 });
    let firstViolationAlertCount = await checkLimitsFromSettings(page);

    if (firstViolationAlertCount <= calmAlertCount) {
      await configureLimit(page, limitId, { type: "cash_max_share", direction: "max", severity: "warning", threshold: 0.0001 });
      firstViolationAlertCount = await checkLimitsFromSettings(page);
    }

    assert(firstViolationAlertCount > calmAlertCount, "violated limit should create an active alert");
    const secondViolationAlertCount = await checkLimitsFromSettings(page);
    assert(secondViolationAlertCount === firstViolationAlertCount, "repeated limit checks should not duplicate active alerts");
    console.log("ok stage 5 limit alert lifecycle");
  } finally {
    await configureLimit(page, limitId, { type: "cash_max_share", direction: "max", severity: "warning", threshold: 1 });
    await checkLimitsFromSettings(page);
  }
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

  await assertVisible(page.getByTestId("dashboard-recommendation-link"), "dashboard should show recommendation links");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/recommendations", { timeout: 10_000 }),
    page.getByTestId("dashboard-recommendation-link").first().click(),
  ]);
  await page.waitForLoadState("networkidle");
  await assertVisible(page.getByTestId("recommendation-card"), "dashboard recommendation should open recommendations list");
  console.log("ok dashboard analytics");
}

async function assertStage5Signals(page) {
  await page.goto(`${baseUrl}/recommendations`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("recommendations-view"), "editor should open recommendations");
  await assertVisible(page.getByTestId("recommendation-filters-form"), "recommendations should show filters");
  await assertVisible(page.getByTestId("recommendation-card"), "recommendations should show a recommendation card");
  const recommendationCard = page.getByTestId("recommendation-card").first();
  await assertVisible(recommendationCard.getByTestId("recommendation-reason"), "recommendation should show a reason");
  await assertVisible(recommendationCard.getByTestId("recommendation-metrics"), "recommendation should show metrics");
  await assertVisible(recommendationCard.getByTestId("recommendation-source-link"), "recommendation should include a source link");

  if (await isVisible(page.getByTestId("recommendation-mark-read-button"))) {
    await submitStage5Action(page, page.getByTestId("recommendation-mark-read-button"), ["recommendation-read"]);
  }

  if (await isVisible(page.getByTestId("recommendation-read-button"))) {
    await submitStage5Action(page, page.getByTestId("recommendation-read-button"), ["watchlist-recommendation"]);
  }

  if (await isVisible(page.getByTestId("recommendation-accept-button"))) {
    await submitStage5Action(page, page.getByTestId("recommendation-accept-button"), ["recommendation-status"]);
  }
  console.log("ok stage 5 recommendations");

  await page.goto(`${baseUrl}/news`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("news-view"), "editor should open news");
  await assertVisible(page.getByTestId("news-filters-form"), "news should show filters");
  await assertVisible(page.getByTestId("news-card"), "news should show at least one news item or idea");

  if (await isVisible(page.getByTestId("news-watchlist-button"))) {
    await submitStage5Action(page, page.getByTestId("news-watchlist-button"), ["watchlist-news"]);
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
    await submitStage5Action(page, page.getByTestId("watchlist-save-button"), ["watchlist"]);
  }
  console.log("ok stage 5 watchlist");

  await page.goto(`${baseUrl}/events`, { waitUntil: "networkidle" });
  await assertVisible(page.getByTestId("events-view"), "editor should open events");
  await assertVisible(page.getByTestId("events-filters-form"), "events should show filters");
  await assertVisible(page.getByTestId("events-upcoming-section"), "events should show upcoming section");
  await assertVisible(page.getByTestId("events-history-section"), "events should show history section");
  await assertVisible(page.getByTestId("event-card"), "events should show event cards");
  await ensureLinkedEvent(page);
  await assertVisible(page.getByTestId("event-asset-link"), "events should link related assets");
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/assets" && url.searchParams.has("asset_id"), { timeout: 10_000 }),
    page.getByTestId("event-asset-link").first().click(),
  ]);
  await page.waitForLoadState("networkidle");
  await assertVisible(page.getByTestId("assets-view"), "event asset link should open assets");
  console.log("ok stage 5 events");
}

async function ensureLinkedEvent(page) {
  if (await isVisible(page.getByTestId("event-asset-link"))) return;

  const createEventForm = page.getByTestId("create-event-form");
  await assertVisible(createEventForm, "editor should be able to create an event when no linked event exists");
  const assetSelect = createEventForm.locator('select[name="asset_id"]');
  const assetOptions = await assetSelect.locator("option").evaluateAll((options) =>
    options.map((option) => option.value).filter(Boolean),
  );
  assert(assetOptions.length > 0, "event smoke needs at least one non-cash asset");

  await createEventForm.locator('select[name="event_type"]').selectOption("dividend");
  await createEventForm.locator('input[name="event_date"]').fill(daysFromNowIsoDate(10));
  await createEventForm.locator('input[name="amount"]').fill("1");
  await createEventForm.locator('input[name="title"]').fill(`Smoke linked event ${new Date().toISOString()}`);
  await assetSelect.selectOption(assetOptions[0]);
  await submitStage5Action(page, page.getByTestId("create-event-button"), ["event"]);
  await page.goto(`${baseUrl}/events`, { waitUntil: "networkidle" });
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
