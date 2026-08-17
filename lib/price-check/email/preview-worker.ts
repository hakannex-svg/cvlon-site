const previewWorkerFlags = [
  "PRICE_CHECK_PHASE6_PREVIEW_WORKER_ENABLED",
  "PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED",
] as const;

export function isPreviewResultDeliveryWorkerEnabled(env: NodeJS.ProcessEnv = process.env, hostname?: string | null): boolean {
  if (!previewWorkerFlags.some((flag) => env[flag] === "true")) return false;
  if (env.CONTEXT === "production") return false;
  if (env.CONTEXT === "deploy-preview") return true;
  return /^deploy-preview-\d+--[a-z0-9-]+\.netlify\.app$/i.test(hostname ?? "");
}
