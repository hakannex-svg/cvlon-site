import "../../../db/price-check/server-boundary.ts";
import { EXPLANATION_PROMPT_VERSION, EXPLANATION_SCHEMA_VERSION } from "./schema.ts";

export type OpenAIExplanationConfig = {
  apiKey: string;
  model: string;
  schemaVersion: string;
  promptVersion: string;
  timeoutMs: number;
};

const allowedPreviewBranches = new Set(["codex/civilon-price-check-phase-9", "codex/civilon-price-check-phase-10"]);

export function getOpenAIExplanationConfig(env: NodeJS.ProcessEnv = process.env): OpenAIExplanationConfig {
  if (env.CONTEXT === "production" && env.NEXT_PUBLIC_PRICE_CHECK_ENABLED !== "true") throw new Error("OPENAI_EXPLANATION_PRODUCTION_DISABLED");
  if (env.CONTEXT && !["dev", "production"].includes(env.CONTEXT) && !allowedPreviewBranches.has(env.BRANCH ?? "")) throw new Error("OPENAI_EXPLANATION_PREVIEW_BRANCH_REJECTED");
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_EXPLANATION_MODEL?.trim();
  if (!apiKey || !model) throw new Error("OPENAI_EXPLANATION_NOT_CONFIGURED");
  return {
    apiKey,
    model,
    schemaVersion: env.OPENAI_EXPLANATION_SCHEMA_VERSION?.trim() || EXPLANATION_SCHEMA_VERSION,
    promptVersion: env.OPENAI_EXPLANATION_PROMPT_VERSION?.trim() || EXPLANATION_PROMPT_VERSION,
    timeoutMs: 30_000,
  };
}
