/**
 * Method handling shared by the two public intake routes.
 *
 * Buy and Sell intake each accept exactly one method. Until now every other
 * method fell through to the framework's generic 405, and that response was
 * weaker than anything the same route produces itself: no `Allow`, no cache
 * policy, no robots directive, no referrer policy and no JSON content type. A
 * refusal should not be the least protected answer an endpoint can give.
 *
 * These handlers close that gap and nothing more. The body is a fixed string
 * that names no route, no record, no feature flag and no configuration, so a
 * caller learns only that the method is wrong — the same thing they would learn
 * from the framework, told properly. Nothing here reads, lists or searches.
 *
 * OPTIONS is answered with the same refusal on purpose. Intake is same-origin
 * by design, so a cross-origin preflight must fail; returning an allowance here
 * would be the first half of a CORS policy the marketplace does not have.
 */

/**
 * Stricter than the intake routes' own success headers, which set a bare
 * `no-store` and omit `noarchive`. A refusal is never cacheable, never
 * indexable and never a referrer source.
 */
const METHOD_NOT_ALLOWED_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  Allow: "POST",
} as const;

/** The only body these handlers can produce. */
export const INTAKE_METHOD_NOT_ALLOWED_BODY = {
  ok: false,
  error: "Method not allowed.",
} as const;

/** 405 for every non-POST method that may carry a body. */
export function intakeMethodNotAllowed() {
  return Response.json(INTAKE_METHOD_NOT_ALLOWED_BODY, {
    status: 405,
    headers: { ...METHOD_NOT_ALLOWED_HEADERS },
  });
}

/**
 * The same refusal for HEAD, carrying the status and every header but no body,
 * because a HEAD response must not have one.
 */
export function intakeHeadNotAllowed() {
  const refusal = intakeMethodNotAllowed();
  return new Response(null, { status: refusal.status, headers: refusal.headers });
}
