import { timingSafeEqual } from "node:crypto";

import { runCompatibilityExercise } from "../../spikes/price-check-db/exercise.ts";

const PROBE_KEY = "civilon-price-check-spike";
const DEPLOY_PREVIEW_HOST = /^deploy-preview-\d+--cvlon\.netlify\.app$/;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function authorized(request: Request) {
  const configuredToken = process.env.PRICE_CHECK_DB_PROBE_TOKEN;
  const suppliedToken = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");

  if (!configuredToken || !suppliedToken) {
    return false;
  }

  const expected = Buffer.from(configuredToken);
  const actual = Buffer.from(suppliedToken);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isDeployPreviewRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();

  return (
    process.env.SITE_NAME === "cvlon" && DEPLOY_PREVIEW_HOST.test(hostname)
  );
}

export default async function handler(request: Request) {
  // Netlify exposes CONTEXT during builds, not in the Functions runtime.
  // Restrict this disposable endpoint to cvlon PR preview hostnames instead.
  if (!isDeployPreviewRequest(request)) {
    return json({ error: "Not found" }, 404);
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!authorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Malformed JSON" }, 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("operation" in body) ||
    body.operation !== "exercise"
  ) {
    return json({ error: "Invalid probe operation" }, 400);
  }

  try {
    const result = await runCompatibilityExercise(PROBE_KEY);
    return json({ ok: true, probeKey: PROBE_KEY, result });
  } catch (error) {
    const correlationId = crypto.randomUUID();
    console.error("Civilon DB spike failed", {
      correlationId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Database probe failed", correlationId }, 503);
  }
}

export const config = {
  path: "/api/__spike/price-check-db",
};
