const CIVILON_PRODUCTION_HOST = "cvlon.com";
const NETLIFY_SITE_HOST = "cvlon.netlify.app";
const NETLIFY_PREVIEW_SUFFIX = `--${NETLIFY_SITE_HOST}`;

/**
 * The label Netlify gives a Deploy Preview: `deploy-preview-<pull request>`.
 *
 * Anchored, ASCII-only, and no leading zero, so it admits exactly the canonical
 * spelling and none of the near-misses — `deploy-preview-x`, `deploy-preview-0`,
 * `deploy-preview-007` and any label with leading or trailing junk all fail.
 */
const NETLIFY_DEPLOY_PREVIEW_LABEL = /^deploy-preview-[1-9][0-9]*$/;

const normalizeHost = (hostname: string) => hostname.toLowerCase().replace(/\.$/, "");

export function isApprovedSubmissionHost(hostname: string) {
  const normalizedHost = normalizeHost(hostname);

  return normalizedHost === CIVILON_PRODUCTION_HOST
    || normalizedHost === NETLIFY_SITE_HOST
    || (normalizedHost.endsWith(NETLIFY_PREVIEW_SUFFIX) && normalizedHost.length > NETLIFY_PREVIEW_SUFFIX.length);
}

/**
 * True only for a canonical Civilon Netlify *Deploy Preview* host, i.e.
 * `deploy-preview-<pull request>--cvlon.netlify.app`.
 *
 * Deliberately narrower than `isApprovedSubmissionHost`, which also approves
 * production (`cvlon.com`, and the bare `cvlon.netlify.app` alias) and every
 * branch-deploy alias (`codex-foo--cvlon.netlify.app`). Callers of this helper
 * use it as proof of a *deploy preview* specifically, and a branch alias is not
 * one: its name is whatever a branch happens to be called, so it is not the
 * per-pull-request identity the deploy-preview shape guarantees.
 *
 * Every host this accepts is a strict subset of the approved submission hosts —
 * it shares the same tenant suffix and never widens that policy.
 */
export function isCivilonDeployPreviewHost(hostname: string) {
  const normalizedHost = normalizeHost(hostname);
  if (!normalizedHost.endsWith(NETLIFY_PREVIEW_SUFFIX)) return false;

  const label = normalizedHost.slice(0, -NETLIFY_PREVIEW_SUFFIX.length);
  return NETLIFY_DEPLOY_PREVIEW_LABEL.test(label);
}
