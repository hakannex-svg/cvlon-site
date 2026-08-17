import "../../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";
import type { OpenAIExplanationConfig } from "./config.ts";
import { EXPLANATION_SYSTEM_PROMPT, EXPLANATION_USER_PROMPT } from "./prompt.ts";
import { explanationJsonSchema, validateExplanationDraft, type ExplanationContext, type ExplanationDraft } from "./schema.ts";

export type ExplanationUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
export type OpenAIExplanationResult = {
  draft: ExplanationDraft;
  requestDigest: string;
  latencyMs: number;
  usage: ExplanationUsage;
  model: string;
};

const MAX_RESPONSE_BYTES = 64_000;

export function buildExplanationResponsesRequest(input: { config: OpenAIExplanationConfig; context: ExplanationContext }) {
  return {
    model: input.config.model,
    store: false,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: [{ type: "input_text", text: EXPLANATION_SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "input_text", text: `${EXPLANATION_USER_PROMPT}\n${JSON.stringify(input.context)}` }] },
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "civilon_price_check_explanation",
        strict: true,
        schema: explanationJsonSchema,
      },
    },
    max_output_tokens: 1_200,
  };
}

function responseText(value: Record<string, unknown>) {
  const output = Array.isArray(value.output) ? value.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.type === "refusal") throw new Error("OPENAI_EXPLANATION_REFUSAL");
      if (record.type === "output_text" && typeof record.text === "string") return record.text;
    }
  }
  throw new Error(value.status === "incomplete" ? "OPENAI_EXPLANATION_INCOMPLETE" : "OPENAI_EXPLANATION_OUTPUT_MISSING");
}

function safeUsage(value: Record<string, unknown>): ExplanationUsage {
  const usage = value.usage && typeof value.usage === "object" ? value.usage as Record<string, unknown> : {};
  const token = (candidate: unknown) => Number.isSafeInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : null;
  return { inputTokens: token(usage.input_tokens), outputTokens: token(usage.output_tokens), totalTokens: token(usage.total_tokens) };
}

export async function draftExplanationWithOpenAI(
  input: { config: OpenAIExplanationConfig; context: ExplanationContext },
  dependencies: { fetchImpl?: typeof fetch } = {},
): Promise<OpenAIExplanationResult> {
  const body = buildExplanationResponsesRequest(input);
  const contextJson = JSON.stringify(input.context);
  const requestDigest = createHash("sha256")
    .update(input.config.model).update("\0").update(input.config.schemaVersion).update("\0")
    .update(input.config.promptVersion).update("\0").update(contextJson).digest("hex");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  const started = performance.now();
  try {
    const response = await (dependencies.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 429) throw new Error("OPENAI_EXPLANATION_RATE_LIMITED");
      if (response.status >= 500) throw new Error("OPENAI_EXPLANATION_UNAVAILABLE");
      throw new Error("OPENAI_EXPLANATION_REQUEST_REJECTED");
    }
    const rawText = await response.text();
    if (Buffer.byteLength(rawText, "utf8") > MAX_RESPONSE_BYTES) throw new Error("OPENAI_EXPLANATION_OUTPUT_TOO_LARGE");
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(rawText) as Record<string, unknown>; }
    catch { throw new Error("OPENAI_EXPLANATION_RESPONSE_INVALID"); }
    let parsed: unknown;
    try { parsed = JSON.parse(responseText(raw)); }
    catch (error) {
      if (error instanceof Error && error.message.startsWith("OPENAI_EXPLANATION_")) throw error;
      throw new Error("OPENAI_EXPLANATION_STRUCTURED_OUTPUT_INVALID");
    }
    return {
      draft: validateExplanationDraft(parsed, input.context),
      requestDigest,
      latencyMs: Math.max(0, Math.round(performance.now() - started)),
      usage: safeUsage(raw),
      model: input.config.model,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("OPENAI_EXPLANATION_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
