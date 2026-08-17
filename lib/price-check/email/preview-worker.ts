const previewWorkerFlags = [
  "PRICE_CHECK_PHASE6_PREVIEW_WORKER_ENABLED",
  "PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED",
] as const;

export function isPreviewResultDeliveryWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CONTEXT !== "deploy-preview") return false;
  return previewWorkerFlags.some((flag) => env[flag] === "true");
}
