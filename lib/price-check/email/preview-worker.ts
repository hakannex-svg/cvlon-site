const previewWorkerFlags: Readonly<Record<string, string>> = {
  "codex/civilon-price-check-phase-6": "PRICE_CHECK_PHASE6_PREVIEW_WORKER_ENABLED",
  "codex/civilon-price-check-phase-10": "PRICE_CHECK_PHASE10_PREVIEW_WORKER_ENABLED",
};

export function isPreviewResultDeliveryWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CONTEXT !== "deploy-preview") return false;
  const flag = previewWorkerFlags[env.BRANCH ?? ""];
  return Boolean(flag && env[flag] === "true");
}
