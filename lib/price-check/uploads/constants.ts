export const PRICE_CHECK_UPLOAD_COOKIE = "__Host-cvlon_pc_upload";
export const PRICE_CHECK_UPLOAD_SESSION_SECONDS = 2 * 60 * 60;
export const PRICE_CHECK_UPLOAD_AUTHORIZATION_SECONDS = 5 * 60;
export const PRICE_CHECK_UPLOAD_MAX_FILES = 3;
export const PRICE_CHECK_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const PRICE_CHECK_UPLOAD_MAX_SESSION_BYTES =
  PRICE_CHECK_UPLOAD_MAX_FILES * PRICE_CHECK_UPLOAD_MAX_BYTES;
export const PRICE_CHECK_UPLOAD_ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type PriceCheckUploadMime =
  (typeof PRICE_CHECK_UPLOAD_ALLOWED_MIME)[number];

