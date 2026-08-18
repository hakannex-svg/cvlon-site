import {
  POST_sellInventoryFreshnessRespond,
  sellInventoryFreshnessMethodNotAllowed,
} from "@/lib/marketplace/sell-inventory-freshness-public-routes";

export const runtime = "nodejs";

export const POST = POST_sellInventoryFreshnessRespond;

/**
 * Recording an answer is a POST and nothing else.
 *
 * A GET here would be the whole workflow's failure mode: mail scanners, link
 * previewers and browser prefetchers follow emailed links, and a readable
 * endpoint that recorded "all available" because a corporate filter fetched a
 * URL would be Civilon putting a statement in a seller's mouth.
 */
export const GET = sellInventoryFreshnessMethodNotAllowed;
export const PUT = sellInventoryFreshnessMethodNotAllowed;
export const PATCH = sellInventoryFreshnessMethodNotAllowed;
export const DELETE = sellInventoryFreshnessMethodNotAllowed;
export const HEAD = sellInventoryFreshnessMethodNotAllowed;
export const OPTIONS = sellInventoryFreshnessMethodNotAllowed;
