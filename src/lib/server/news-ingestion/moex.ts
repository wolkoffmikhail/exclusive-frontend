export const moexIssBaseUrl = "https://iss.moex.com/iss";
export const moexSourceCode = "moex_iss";

export type MoexIssBlock = {
  columns?: string[];
  data?: unknown[][];
};

export type MoexIssResponse = Record<string, MoexIssBlock | unknown>;

export type MoexSecurityReference = {
  secid: string;
  isin: string | null;
  shortName: string | null;
  secName: string | null;
  latName: string | null;
  aliases: string[];
};

export type MoexAliasRow = {
  asset_id: string;
  alias: string;
  source: "moex";
  confidence: number;
  status: "active";
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function columnIndex(columns: string[] | undefined, name: string) {
  return (columns ?? []).findIndex((column) => column.toLowerCase() === name.toLowerCase());
}

function rowValue(row: unknown[], columns: string[] | undefined, name: string) {
  const index = columnIndex(columns, name);
  return index >= 0 ? normalizeText(row[index]) : "";
}

function descriptionMap(block: MoexIssBlock | unknown) {
  if (!block || typeof block !== "object") return new Map<string, string>();
  const candidate = block as MoexIssBlock;
  const nameIndex = columnIndex(candidate.columns, "name");
  const valueIndex = columnIndex(candidate.columns, "value");
  const result = new Map<string, string>();

  for (const row of candidate.data ?? []) {
    const key = nameIndex >= 0 ? normalizeText(row[nameIndex]).toUpperCase() : "";
    const value = valueIndex >= 0 ? normalizeText(row[valueIndex]) : "";
    if (key && value) result.set(key, value);
  }

  return result;
}

function firstSecuritiesRow(block: MoexIssBlock | unknown) {
  if (!block || typeof block !== "object") return null;
  const candidate = block as MoexIssBlock;
  const row = candidate.data?.[0];
  if (!row) return null;

  return {
    columns: candidate.columns,
    row,
  };
}

function uniqueAliases(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const value of values) {
    const alias = value?.trim().replace(/\s+/g, " ");
    if (!alias || alias.length < 2) continue;
    const key = alias.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }

  return aliases;
}

export function parseMoexSecurityReference(payload: MoexIssResponse): MoexSecurityReference | null {
  const description = descriptionMap(payload.description);
  const security = firstSecuritiesRow(payload.securities);
  const secid = description.get("SECID") || (security ? rowValue(security.row, security.columns, "SECID") : "");
  if (!secid) return null;

  const shortName = description.get("SHORTNAME")
    || (security ? rowValue(security.row, security.columns, "SHORTNAME") : "")
    || null;
  const secName = description.get("SECNAME")
    || description.get("NAME")
    || (security ? rowValue(security.row, security.columns, "SECNAME") || rowValue(security.row, security.columns, "NAME") : "")
    || null;
  const isin = description.get("ISIN")
    || (security ? rowValue(security.row, security.columns, "ISIN") : "")
    || null;
  const latName = description.get("LATNAME")
    || (security ? rowValue(security.row, security.columns, "LATNAME") : "")
    || null;

  return {
    secid,
    isin,
    shortName,
    secName,
    latName,
    aliases: uniqueAliases([secid, shortName, secName, latName, isin]),
  };
}

export function buildMoexSecurityUrl(secidOrIsin: string) {
  const encoded = encodeURIComponent(secidOrIsin.trim().toUpperCase());
  return `${moexIssBaseUrl}/securities/${encoded}.json?iss.only=description,securities`;
}

export async function fetchMoexSecurityReference({
  fetchImpl = fetch,
  secidOrIsin,
}: {
  fetchImpl?: typeof fetch;
  secidOrIsin: string;
}) {
  const response = await fetchImpl(buildMoexSecurityUrl(secidOrIsin), {
    headers: {
      Accept: "application/json",
      "User-Agent": "investment-portfolio-stage7/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`moex_security_fetch_failed:${response.status}`);
  }

  return parseMoexSecurityReference(await response.json() as MoexIssResponse);
}

export function buildMoexAliasRowsForAsset({
  assetId,
  reference,
}: {
  assetId: string;
  reference: MoexSecurityReference;
}): MoexAliasRow[] {
  return reference.aliases.map((alias) => ({
    asset_id: assetId,
    alias,
    source: "moex",
    confidence: alias === reference.isin ? 0.98 : alias === reference.secid ? 0.95 : 0.86,
    status: "active",
  }));
}
