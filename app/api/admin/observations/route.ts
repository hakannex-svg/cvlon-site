import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { parseObservationInput } from "@/lib/price-check/admin/analysis-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("create_observation");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let parsed;
  try { parsed = parseObservationInput(await request.json()); }
  catch (error) { return privateJson({ ok: false, error: error instanceof Error ? error.message : "Observation input is invalid." }, 400); }
  const { documentationCodes, normalizedPartNumber, ...observation } = parsed;
  const governedObservation = access.user.role === "ADMIN"
    ? { ...observation, normalizedPartNumber }
    : { ...observation, normalizedPartNumber, verificationState: "PENDING" as const, permittedUseState: "PENDING" as const };
  try {
    const [{ priceCheckDb }, { createGovernedObservation }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/comparable-repository"),
    ]);
    const created = await createGovernedObservation(priceCheckDb, { observation: governedObservation, documentationCodes, actor: access.user });
    return privateJson({ ok: true, observationId: created.id }, 201);
  } catch {
    return privateJson({ ok: false, error: "The governed observation could not be created." }, 409);
  }
}
