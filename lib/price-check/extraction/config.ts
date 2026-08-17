import "../../../db/price-check/server-boundary.ts";

import { EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION } from "./schema.ts";

export type OpenAIExtractionConfig = {
  apiKey: string;
  model: string;
  schemaVersion: string;
  promptVersion: string;
  timeoutMs: number;
};

export function getOpenAIExtractionConfig(env: NodeJS.ProcessEnv = process.env): OpenAIExtractionConfig {
  if (env.CONTEXT === "production") throw new Error("OPENAI_PRODUCTION_DISABLED");
  if (env.CONTEXT && env.CONTEXT !== "dev" && !["codex/civilon-price-check-phase-8", "codex/civilon-price-check-phase-9", "codex/civilon-price-check-phase-10"].includes(env.BRANCH ?? "")) {
    throw new Error("OPENAI_PREVIEW_BRANCH_REJECTED");
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_EXTRACTION_MODEL?.trim();
  if (!apiKey || !model) throw new Error("OPENAI_EXTRACTION_NOT_CONFIGURED");
  return {
    apiKey,
    model,
    schemaVersion: env.OPENAI_EXTRACTION_SCHEMA_VERSION?.trim() || EXTRACTION_SCHEMA_VERSION,
    promptVersion: env.OPENAI_EXTRACTION_PROMPT_VERSION?.trim() || EXTRACTION_PROMPT_VERSION,
    timeoutMs: 45_000,
  };
}
