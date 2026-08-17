import { accessErrorResponse, privateJson, requireAdminApi, verifyAdminMutationOrigin } from "@/lib/price-check/admin/auth";

export const runtime = "nodejs";

function isAuthorizedPreview() {
  return process.env.PRICE_CHECK_PHASE5_PREVIEW_SEED_ENABLED === "true" || process.env.PRICE_CHECK_PHASE6_PREVIEW_SEED_ENABLED === "true";
}
export async function POST(request: Request) {
  if (!isAuthorizedPreview()) return privateJson({ ok: false, error: "Not found." }, 404);
  try { verifyAdminMutationOrigin(request); } catch { return privateJson({ ok: false, error: "Request origin was rejected." }, 403); }
  const access = await requireAdminApi("manage_relationships");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const [{ priceCheckDb }, { seedPhase5SyntheticPreview }] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/phase5-seed"),
    ]);
    const result = await seedPhase5SyntheticPreview(priceCheckDb, access.user);
    return privateJson({ ok: true, ...result }, result.seeded ? 201 : 200);
  } catch {
    return privateJson({ ok: false, error: "Synthetic preview evidence could not be created." }, 409);
  }
}
