import {
  POST_sellInventoryFreshnessView,
  sellInventoryFreshnessMethodNotAllowed,
} from "@/lib/marketplace/sell-inventory-freshness-public-routes";

export const runtime = "nodejs";

export const POST = POST_sellInventoryFreshnessView;

/**
 * Nothing here is readable. A GET that described a check would turn an emailed
 * credential into a link anything that crawls it could resolve.
 */
export const GET = sellInventoryFreshnessMethodNotAllowed;
export const PUT = sellInventoryFreshnessMethodNotAllowed;
export const PATCH = sellInventoryFreshnessMethodNotAllowed;
export const DELETE = sellInventoryFreshnessMethodNotAllowed;
export const HEAD = sellInventoryFreshnessMethodNotAllowed;
export const OPTIONS = sellInventoryFreshnessMethodNotAllowed;
