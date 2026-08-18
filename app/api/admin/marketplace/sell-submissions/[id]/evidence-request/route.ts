import { createEvidenceRequestRoute, methodNotAllowed } from "@/lib/marketplace/admin/write-routes";

export const runtime = "nodejs";

export const POST = createEvidenceRequestRoute();

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
