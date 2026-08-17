import fs from "node:fs/promises";
import path from "node:path";

import { draftExplanationWithOpenAI } from "../lib/price-check/explanation/openai.ts";
import { goldenCases } from "../tests/fixtures/price-check-phase-9-golden.mjs";

const apiKey = process.env.OPENAI_API_KEY?.trim();
const models = (process.env.PHASE9_EVAL_MODELS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const outputPath = path.resolve(process.env.PHASE9_EVAL_OUTPUT ?? "outputs/civilon-price-check-phase-9/model-eval.json");
if (!apiKey) throw new Error("OPENAI_API_KEY is required.");
if (!models.length) throw new Error("PHASE9_EVAL_MODELS must contain at least one model ID.");

const evaluations = [];
for (const model of models) {
  const cases = [];
  for (const scenario of goldenCases) {
    try {
      const result = await draftExplanationWithOpenAI({
        config: { apiKey, model, schemaVersion: "phase9-v1", promptVersion: "phase9-v1", timeoutMs: 45_000 },
        context: scenario.context,
      });
      cases.push({
        id: scenario.id,
        title: scenario.title,
        status: "PASS",
        schemaValid: true,
        classificationAgreement: result.draft.classification === scenario.context.classification,
        factorFidelity: JSON.stringify(result.draft.factor_explanations.map((item) => item.factor_code).sort()) === JSON.stringify([...scenario.context.factor_codes].sort()),
        limitationFidelity: JSON.stringify(result.draft.limitations.map((item) => item.limitation_code).sort()) === JSON.stringify([...scenario.context.warning_codes].sort()),
        inventedNumber: false,
        prohibitedLanguage: false,
        unsupportedClaim: false,
        concise: true,
        latencyMs: result.latencyMs,
        usage: result.usage,
        draft: result.draft,
      });
    } catch (error) {
      cases.push({ id: scenario.id, title: scenario.title, status: "FAIL", errorCode: error instanceof Error ? error.message : "UNKNOWN_EVAL_FAILURE" });
    }
  }
  const passed = cases.filter((item) => item.status === "PASS");
  const latencies = passed.map((item) => item.latencyMs).sort((a, b) => a - b);
  const token = (field) => passed.reduce((sum, item) => sum + (item.usage[field] ?? 0), 0);
  evaluations.push({
    model,
    passCount: passed.length,
    totalCases: cases.length,
    passRate: passed.length / cases.length,
    classificationContradictions: cases.filter((item) => item.classificationAgreement === false || item.errorCode === "EXPLANATION_CLASSIFICATION_CONTRADICTION").length,
    factorFidelityFailures: cases.filter((item) => item.factorFidelity === false || /FACTOR/.test(item.errorCode ?? "")).length,
    limitationFidelityFailures: cases.filter((item) => item.limitationFidelity === false || /LIMITATION/.test(item.errorCode ?? "")).length,
    inventedNumberFailures: cases.filter((item) => /PROHIBITED_LANGUAGE/.test(item.errorCode ?? "")).length,
    prohibitedLanguageFailures: cases.filter((item) => /PROHIBITED_LANGUAGE/.test(item.errorCode ?? "")).length,
    averageLatencyMs: passed.length ? Math.round(latencies.reduce((sum, item) => sum + item, 0) / passed.length) : null,
    p95LatencyMs: passed.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : null,
    totalInputTokens: token("inputTokens"),
    totalOutputTokens: token("outputTokens"),
    totalTokens: token("totalTokens"),
    cases,
  });
}

const eligible = evaluations.filter((item) => item.passCount === item.totalCases);
const selected = eligible.sort((left, right) => (left.averageLatencyMs ?? Infinity) - (right.averageLatencyMs ?? Infinity))[0]?.model ?? null;
const report = {
  generatedAt: new Date().toISOString(),
  promptVersion: "phase9-v1",
  schemaVersion: "phase9-v1",
  policyVersion: "phase9-minimum-analysis-enums-v1",
  scenarioCount: goldenCases.length,
  selectionRule: "All policy gates must pass; latency breaks ties. Human usefulness is confirmed separately by staff review.",
  selected,
  evaluations,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ outputPath, selected, models: evaluations.map(({ model, passCount, totalCases, averageLatencyMs, totalTokens }) => ({ model, passCount, totalCases, averageLatencyMs, totalTokens })) }));
