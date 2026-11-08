import { api } from "../auth/api.js";
import { credsFromEnv } from "./_shared.js";

/**
 * The address the migros.ch website reads the Cumulus card from. The old one,
 * `/retentionapi/public/web/v1/customers/cumulus/details`, answers 404 since
 * November 2026.
 */
export const CUMULUS_PROFILE_PATH = "/retentionapi/public/web/v1/cumulus-profile";

/** Shape the Cumulus profile for the LLM. `null` means the account has no Cumulus card. */
export function formatCumulusProfile(data: Record<string, unknown> | null): string {
  if (!data) {
    return JSON.stringify(
      { hasCumulus: false, message: "No Cumulus card is linked to this Migros account." },
      null,
      2
    );
  }
  const owner = data.cumulusCardOwner as Record<string, unknown> | undefined;
  const cardholder = owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() : "";
  const memberships = Array.isArray(data.memberships) ? (data.memberships as unknown[]) : [];
  return JSON.stringify(
    {
      hasCumulus: true,
      cumulusNumber: data.cumulusNumber,
      pointsBalance: data.periodToDatePointsBalance,
      cardholder: cardholder || undefined,
      memberships,
      isFamigrosMember: memberships.includes("FAMIGROS"),
      hint: "pointsBalance is the points collected in the current period.",
      raw: data, // keep raw for the LLM in case it wants other fields
    },
    null,
    2
  );
}

/**
 * Cumulus card: points collected this period, card number, cardholder and
 * memberships (such as Famigros). Like the website, a 404 means the account
 * has no Cumulus card.
 */
export async function getCumulusStatus(
  fetchProfile: () => Promise<unknown> = () =>
    api("GET", CUMULUS_PROFILE_PATH, undefined, { creds: credsFromEnv() })
): Promise<string> {
  try {
    return formatCumulusProfile((await fetchProfile()) as Record<string, unknown>);
  } catch (err) {
    if (err instanceof Error && / -> 404\b/.test(err.message)) return formatCumulusProfile(null);
    throw err;
  }
}

/**
 * List in-store receipts (Kassenbons) over a date range. Default range: last
 * 30 days. The supermarketOnly flag excludes online order invoices, so this
 * tool answers "what did I buy at the physical store?".
 */
export async function getInStoreReceipts(args: {
  startDate?: string;
  endDate?: string;
  limit?: number;
} = {}): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const startDate = args.startDate ?? thirtyDaysAgo;
  const endDate = args.endDate ?? today;
  const limit = args.limit ?? 50;

  const url =
    `/retentionapi/public/web/v1/receipts?startDate=${encodeURIComponent(startDate)}` +
    `&endDate=${encodeURIComponent(endDate)}` +
    `&supermarketOnly=true&limit=${limit}`;
  const data = await api("GET", url, undefined, { creds: credsFromEnv() });

  // Response may be an array or an envelope; normalize.
  const list = Array.isArray(data) ? data : (data as { receipts?: unknown[] }).receipts ?? [];
  return JSON.stringify(
    {
      startDate,
      endDate,
      count: list.length,
      receipts: list,
      hint:
        list.length > 0
          ? "Use get_receipt_details with a receipt id to inspect line items."
          : `No in-store receipts in ${startDate} to ${endDate}.`,
    },
    null,
    2
  );
}

/**
 * In-store receipt line items live on `account.migros.ch` behind a legacy
 * CSRF-cookie auth flow that the modern Bearer JWT doesn't access. Rather
 * than implement a parallel auth path, return the URL where the user can
 * inspect the receipt in their browser. The list endpoint
 * (get_in_store_receipts) already gives store, date, total, and points;
 * line-by-line is rarely the deciding factor for LLM workflows.
 */
export async function getReceiptDetails(args: { receiptId: string | number }): Promise<string> {
  const id = String(args.receiptId);
  return JSON.stringify(
    {
      receiptId: id,
      message:
        "Full line items aren't accessible via the public API used by this MCP. Open the URL below in your browser to view the receipt details directly.",
      url: `https://account.migros.ch/purchases/receipts`,
      hint:
        "The receipt list (get_in_store_receipts) returns store, date, amount, and Cumulus points which is enough for most spending-analysis queries.",
    },
    null,
    2
  );
}

/**
 * Active Cumulus coupons targeted at the user. Migros personalises these based
 * on shopping history — they typically expire after a few weeks.
 */
export async function getCumulusCoupons(): Promise<string> {
  // The SPA calls cumulus-coupons with a deliveryRequestKey when in checkout
  // context (filters to coupons valid for the active delivery). For a general
  // "what coupons do I have" view, omit the key — the server returns all.
  const data = await api(
    "GET",
    "/retentionapi/public/web/v1/cumulus-coupons",
    undefined,
    { creds: credsFromEnv() }
  );
  const list = Array.isArray(data) ? data : (data as { coupons?: unknown[] }).coupons ?? [];
  return JSON.stringify(
    {
      count: list.length,
      coupons: list,
      hint:
        list.length > 0
          ? "Each coupon has an id, discount, eligible products / categories, and expiry."
          : "No active personal coupons.",
    },
    null,
    2
  );
}
