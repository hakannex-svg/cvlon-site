import {
  POST_sellEvidenceView,
  sellEvidenceMethodNotAllowed,
} from "@/lib/marketplace/sell-evidence-public-routes";

export const runtime = "nodejs";

export const POST = POST_sellEvidenceView;

/**
 * Nothing here is readable. A GET that described a request would turn an
 * emailed credential into a link anything that crawls it could resolve.
 */
export const GET = sellEvidenceMethodNotAllowed;
export const PUT = sellEvidenceMethodNotAllowed;
export const PATCH = sellEvidenceMethodNotAllowed;
export const DELETE = sellEvidenceMethodNotAllowed;
export const HEAD = sellEvidenceMethodNotAllowed;
export const OPTIONS = sellEvidenceMethodNotAllowed;
