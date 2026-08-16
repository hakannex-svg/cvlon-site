import "../../../db/price-check/server-boundary.ts";

import { createHash } from "node:crypto";
import {
  PRICE_CHECK_UPLOAD_ALLOWED_MIME,
  PRICE_CHECK_UPLOAD_MAX_BYTES,
  type PriceCheckUploadMime,
} from "./constants.ts";

const extensionForMime: Record<PriceCheckUploadMime, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

export type UploadDeclaration = {
  filename: string;
  mime: PriceCheckUploadMime;
  size: number;
};

export function sanitizeUploadFilename(value: unknown) {
  if (typeof value !== "string") throw new Error("Choose a supported document.");
  const basename = value.replaceAll("\\", "/").split("/").pop() ?? "";
  const clean = [...basename.normalize("NFKC")]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (!clean || clean.length > 180) throw new Error("Use a filename of 180 characters or fewer.");
  return clean;
}

export function validateUploadDeclaration(raw: unknown): UploadDeclaration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Choose a supported document.");
  }
  const value = raw as Record<string, unknown>;
  const filename = sanitizeUploadFilename(value.filename);
  const mime = typeof value.mime === "string" && PRICE_CHECK_UPLOAD_ALLOWED_MIME.includes(value.mime as PriceCheckUploadMime)
    ? value.mime as PriceCheckUploadMime
    : null;
  const size = typeof value.size === "number" && Number.isInteger(value.size) ? value.size : 0;
  if (!mime) throw new Error("Upload a PDF, JPG, PNG or WebP document.");
  if (size < 1 || size > PRICE_CHECK_UPLOAD_MAX_BYTES) {
    throw new Error("Each document must be 10 MB or smaller.");
  }
  const extension = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (!extensionForMime[mime].includes(extension)) {
    throw new Error("The filename extension does not match the selected document type.");
  }
  return { filename, mime, size };
}

type ValidatedFile = {
  detectedMime: PriceCheckUploadMime;
  byteSize: number;
  contentDigest: string;
};

function imageLimits(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The image dimensions could not be verified.");
  }
  if (width > 12_000 || height > 12_000 || width * height > 40_000_000) {
    throw new Error("The image dimensions are too large.");
  }
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += length + 2;
  }
  throw new Error("The JPEG dimensions could not be verified.");
}

function webpDimensions(bytes: Uint8Array) {
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return { width, height };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error("The WebP dimensions could not be verified.");
}

export function validateUploadedFile(bytes: Uint8Array, declaredMime: string): ValidatedFile {
  if (bytes.length < 1 || bytes.length > PRICE_CHECK_UPLOAD_MAX_BYTES) {
    throw new Error("The uploaded document size is not allowed.");
  }
  let detectedMime: PriceCheckUploadMime;
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") {
    const text = Buffer.from(bytes).toString("latin1");
    if (!/%%EOF\s*$/.test(text.slice(-2048))) throw new Error("The PDF structure is incomplete.");
    if (/\/Encrypt\b/.test(text)) throw new Error("Password-protected PDFs are not supported.");
    const pages = text.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
    if (pages < 1 || pages > 200) throw new Error("The PDF page count is not supported.");
    detectedMime = "application/pdf";
  } else if (bytes.length >= 45
    && Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
    && String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
    && String.fromCharCode(...bytes.slice(-8, -4)) === "IEND") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) !== 13) throw new Error("The PNG structure could not be verified.");
    imageLimits(view.getUint32(16), view.getUint32(20));
    detectedMime = "image/png";
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    const dimensions = jpegDimensions(bytes);
    imageLimits(dimensions.width, dimensions.height);
    detectedMime = "image/jpeg";
  } else if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error("The WebP structure could not be verified.");
    const dimensions = webpDimensions(bytes);
    imageLimits(dimensions.width, dimensions.height);
    detectedMime = "image/webp";
  } else {
    throw new Error("The uploaded document format could not be verified.");
  }
  if (detectedMime !== declaredMime) throw new Error("The uploaded content does not match its declared type.");
  return {
    detectedMime,
    byteSize: bytes.length,
    contentDigest: createHash("sha256").update(bytes).digest("hex"),
  };
}
