import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  accessErrorResponse,
  privateJson,
  requireAdminApi,
} from "@/lib/price-check/admin/auth";
import { createUploadS3Client, getUploadStorageConfig } from "@/lib/price-check/uploads/config";

export const runtime = "nodejs";

function safeDownloadName(value: string) {
  const ascii = value.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 160) || "civilon-document";
  return `attachment; filename="${ascii.replaceAll('"', "")}"`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  const access = await requireAdminApi("download_attachment");
  if (access.status !== "authorized") return accessErrorResponse(access.status);
  try {
    const { id, attachmentId } = await context.params;
    const [{ priceCheckDb }, repository] = await Promise.all([
      import("@/db/price-check"),
      import("@/db/price-check/repositories/attachment-repository"),
    ]);
    const attachment = await repository.getPriceCheckAttachment(priceCheckDb, id, attachmentId);
    if (!attachment || attachment.deletedAt || attachment.scanState !== "CLEAN") {
      return privateJson({ ok: false, error: "This document is not available for download." }, 404);
    }
    const config = getUploadStorageConfig();
    const signedUrl = await getSignedUrl(createUploadS3Client(config), new GetObjectCommand({
      Bucket: config.bucket,
      Key: attachment.objectKey,
      ResponseContentType: attachment.detectedMime ?? "application/octet-stream",
      ResponseContentDisposition: safeDownloadName(attachment.displayFilename),
    }), { expiresIn: 120 });
    await repository.recordAttachmentViewAuthorized(priceCheckDb, {
      attachmentId,
      priceCheckId: id,
      actorId: access.user.id,
    });
    return new Response(null, {
      status: 303,
      headers: {
        Location: signedUrl,
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch {
    return privateJson({ ok: false, error: "The secure download could not be created." }, 503);
  }
}

export function POST() { return privateJson({ ok: false, error: "Method not allowed." }, 405); }
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

