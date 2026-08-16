import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";
import { parseRelationshipInput } from "@/lib/price-check/admin/analysis-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("manage_relationships");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  let relationship;
  try { relationship = parseRelationshipInput(await request.json()); }
  catch (error) { return privateJson({ ok: false, error: error instanceof Error ? error.message : "Relationship input is invalid." }, 400); }
  try {
    const [{ priceCheckDb }, { createGovernedPartRelationship }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/comparable-repository"),
    ]);
    const created = await createGovernedPartRelationship(priceCheckDb, { relationship, actor: access.user });
    return privateJson({ ok: true, relationshipId: created.id }, 201);
  } catch {
    return privateJson({ ok: false, error: "The governed part relationship could not be created." }, 409);
  }
}
