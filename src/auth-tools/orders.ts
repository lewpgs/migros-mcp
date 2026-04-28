import { api } from "../auth/api.js";
import { credsFromEnv } from "./_shared.js";

type OrderStatus = "PENDING" | "DELIVERED" | "CANCELLED" | "ALL";

/**
 * Fetch the user's order history, paginated by status.
 * - status: PENDING (open), DELIVERED, CANCELLED, or ALL. Default: ALL.
 * - page: 0-based.
 */
export async function getOrders(args: { status?: OrderStatus; page?: number } = {}): Promise<string> {
  const status = args.status ?? "ALL";
  const page = args.page ?? 0;
  const data = (await api(
    "GET",
    `/ordergateway/public/web/v1/customers/customer-orders?status=${encodeURIComponent(status)}&page=${page}`,
    undefined,
    { creds: credsFromEnv() }
  )) as { orders?: unknown[]; numberOfOrders?: number; totalPages?: number; pageNumber?: number } | unknown[];

  // Endpoint may return either an envelope { orders, numberOfOrders, ... } or
  // a bare array depending on backend version. Normalize.
  const orders = Array.isArray(data) ? data : (data.orders ?? []);
  return JSON.stringify(
    {
      status,
      page,
      orderCount: orders.length,
      totalCount: Array.isArray(data) ? undefined : data.numberOfOrders,
      totalPages: Array.isArray(data) ? undefined : data.totalPages,
      orders,
      hint:
        orders.length === 0
          ? `No ${status === "ALL" ? "" : status.toLowerCase() + " "}orders on this page.`
          : "Use get_order_details with an order id to inspect a specific order.",
    },
    null,
    2
  );
}

/** Fetch the full details of one order by its id (numeric, e.g. from get_orders). */
export async function getOrderDetails(args: { orderId: string | number }): Promise<string> {
  const data = await api(
    "GET",
    `/ordergateway/public/web/v1/orders/${encodeURIComponent(String(args.orderId))}`,
    undefined,
    { creds: credsFromEnv() }
  );
  return JSON.stringify(data, null, 2);
}
