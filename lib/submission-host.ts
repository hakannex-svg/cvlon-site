const NETLIFY_SITE_HOST = "cvlon.netlify.app";
const NETLIFY_PREVIEW_SUFFIX = `--${NETLIFY_SITE_HOST}`;

export function isApprovedSubmissionHost(hostname: string) {
  const normalizedHost = hostname.toLowerCase().replace(/\.$/, "");

  return normalizedHost === "cvlon.com"
    || normalizedHost === NETLIFY_SITE_HOST
    || (normalizedHost.endsWith(NETLIFY_PREVIEW_SUFFIX) && normalizedHost.length > NETLIFY_PREVIEW_SUFFIX.length);
}
