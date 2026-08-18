import "../../../db/price-check/server-boundary.ts";

import {
  MARKETPLACE_PHOTO_MIME,
  MARKETPLACE_UPLOAD_ALLOWED_MIME,
  marketplaceExtensionForMime,
  marketplaceMaxBytesForMime,
  marketplaceMimeForPurpose,
  marketplaceUploadPurposes,
  type MarketplaceUploadMime,
  type MarketplaceUploadPurpose,
} from "./constants.ts";

export type MarketplaceUploadDeclaration = {
  filename: string;
  mime: MarketplaceUploadMime;
  size: number;
  purpose: MarketplaceUploadPurpose;
};

/**
 * Reduces a browser-supplied filename to a display string.
 *
 * Path separators are stripped first, so `../../etc/passwd` and
 * `C:\Users\x\list.csv` both collapse to a basename — the value is never a key
 * component, but a stored name that looks like a path invites one. Control
 * characters go too: they corrupt staff-facing lists and log lines.
 */
export function sanitizeMarketplaceUploadFilename(value: unknown) {
  if (typeof value !== "string") throw new Error("Choose a supported file.");
  const basename = value.replaceAll("\\", "/").split("/").pop() ?? "";
  const clean = [...basename.normalize("NFKC")]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 && !/\p{Cf}/u.test(character);
    })
    .join("")
    .trim();
  if (!clean || clean.length > 180) throw new Error("Use a filename of 180 characters or fewer.");
  // A leading dot hides the file in staff tooling and defeats the extension
  // check below by making the whole name look like an extension.
  if (clean.startsWith(".")) throw new Error("Use a filename with a visible name and extension.");
  return clean;
}

function extensionOf(filename: string) {
  return filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
}

/**
 * Validates one declared file before anything is signed.
 *
 * Order matters: purpose, then format, then the format/purpose pairing, then
 * size, then the extension. Every rule runs against a value the server chose to
 * accept, never against the raw client string.
 */
export function validateMarketplaceUploadDeclaration(
  raw: unknown,
): MarketplaceUploadDeclaration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Choose a supported file.");
  }
  const value = raw as Record<string, unknown>;
  const allowed = new Set(["filename", "mime", "size", "purpose"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("The upload request contains an unsupported field.");
  }

  const purpose = typeof value.purpose === "string"
    && (marketplaceUploadPurposes as readonly string[]).includes(value.purpose)
    ? value.purpose as MarketplaceUploadPurpose
    : null;
  if (!purpose) throw new Error("Choose what this file shows.");

  const mime = typeof value.mime === "string"
    && (MARKETPLACE_UPLOAD_ALLOWED_MIME as readonly string[]).includes(value.mime)
    ? value.mime as MarketplaceUploadMime
    : null;
  if (!mime) {
    throw new Error("Upload a JPG, PNG, WebP, PDF, CSV or XLSX file.");
  }
  if (!marketplaceMimeForPurpose[purpose].includes(mime)) {
    throw new Error("That file type is not accepted for the selected purpose.");
  }

  const filename = sanitizeMarketplaceUploadFilename(value.filename);
  const size = typeof value.size === "number" && Number.isSafeInteger(value.size) ? value.size : 0;
  const maximum = marketplaceMaxBytesForMime(mime);
  if (size < 1 || size > maximum) {
    throw new Error(
      (MARKETPLACE_PHOTO_MIME as readonly string[]).includes(mime)
        ? "Each photo must be 25 MB or smaller."
        : "Each file must be 50 MB or smaller.",
    );
  }
  if (!marketplaceExtensionForMime[mime].includes(extensionOf(filename))) {
    throw new Error("The filename extension does not match the selected file type.");
  }
  return { filename, mime, size, purpose };
}

/* ------------------------------------------------------------------ content */

/** Binary shapes that must never arrive wearing a text or spreadsheet name. */
const BINARY_MAGIC: ReadonlyArray<{ label: string; bytes: readonly number[] }> = [
  { label: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  { label: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { label: "jpeg", bytes: [0xff, 0xd8, 0xff] },
  { label: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { label: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { label: "riff", bytes: [0x52, 0x49, 0x46, 0x46] },
  // OLE compound document: legacy XLS/DOC, and also how an *encrypted* OOXML
  // file is packaged. Rejecting it covers both refusals at once.
  { label: "ole", bytes: [0xd0, 0xcf, 0x11, 0xe0] },
  { label: "gzip", bytes: [0x1f, 0x8b] },
  { label: "7z", bytes: [0x37, 0x7a, 0xbc, 0xaf] },
  { label: "rar", bytes: [0x52, 0x61, 0x72, 0x21] },
];

function startsWith(bytes: Uint8Array, magic: readonly number[]) {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

function latin1(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("latin1");
}

function indexOfAscii(bytes: Uint8Array, needle: string) {
  return Buffer.from(bytes).indexOf(needle, 0, "latin1");
}

function imageLimits(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The image dimensions could not be verified.");
  }
  // A decompression bomb is a small file that expands to gigabytes of pixels.
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
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += length + 2;
  }
  throw new Error("The JPEG structure could not be verified.");
}

function webpDimensions(bytes: Uint8Array) {
  const chunk = latin1(bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  throw new Error("The WebP structure could not be verified.");
}

/**
 * CSV has no magic number, so it is verified by exclusion: it must not be any
 * binary format we recognise, must contain no NUL or stray control bytes, and
 * must decode as UTF-8. That is enough to refuse an XLS, a ZIP or an executable
 * renamed `.csv` without parsing a single cell — this pipeline never reads
 * spreadsheet contents, so no formula, macro or external reference is ever
 * evaluated, and nothing is extracted for AI or any other consumer.
 */
function verifyCsv(head: Uint8Array, tail: Uint8Array, size: number) {
  for (const magic of BINARY_MAGIC) {
    if (startsWith(head, magic.bytes)) {
      throw new Error("The file is not a plain CSV file.");
    }
  }
  for (const chunk of [head, tail]) {
    for (const byte of chunk) {
      const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
      if (byte === 0 || (byte < 0x20 && !isAllowedControl) || byte === 0x7f) {
        throw new Error("The file is not a plain CSV file.");
      }
    }
  }
  // When the range covers the whole object the decode is exact. When it does
  // not, the last few bytes are dropped so a multi-byte character split across
  // the range boundary is not misreported as invalid encoding.
  const decodable = head.length >= size ? head : head.slice(0, Math.max(0, head.length - 4));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(decodable);
  } catch {
    throw new Error("The CSV file must be UTF-8 text.");
  }
}

/**
 * XLSX is a ZIP of XML parts, so "is it a spreadsheet" and "is it macro-free"
 * are both answered from the archive structure without unzipping anything.
 *
 *  - The local header's general-purpose bit 0 is the encryption flag. Set means
 *    the archive is password-protected and its contents cannot be scanned;
 *    refused rather than stored as unreadable evidence.
 *  - OOXML writers store `[Content_Types].xml` as the first entry. A generic
 *    ZIP renamed `.xlsx` does not, which is how "accepted merely by extension"
 *    is refused.
 *  - The central directory at the tail names every part. `vbaProject.bin` there
 *    is a macro project — that is an XLSM wearing an XLSX name — and `xl/` must
 *    be present or the archive is some other OOXML document.
 */
function verifyXlsx(head: Uint8Array, tail: Uint8Array) {
  if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    throw new Error("The spreadsheet is not a valid XLSX file.");
  }
  const generalPurposeFlags = head[6] | (head[7] << 8);
  if ((generalPurposeFlags & 0x0001) !== 0) {
    throw new Error("Password-protected spreadsheets are not supported.");
  }
  if (indexOfAscii(head.slice(0, 200), "[Content_Types].xml") !== 30) {
    throw new Error("The spreadsheet is not a valid XLSX file.");
  }
  if (indexOfAscii(tail, "PK\u0005\u0006") < 0) {
    throw new Error("The spreadsheet is not a valid XLSX file.");
  }
  if (indexOfAscii(tail, "vbaProject.bin") >= 0) {
    throw new Error("Macro-enabled spreadsheets are not accepted. Save the file as .xlsx or .csv.");
  }
  if (indexOfAscii(tail, "xl/") < 0) {
    throw new Error("The spreadsheet is not a valid XLSX file.");
  }
}

function verifyPdf(head: Uint8Array, tail: Uint8Array) {
  if (!startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw new Error("The document is not a valid PDF file.");
  }
  const headText = latin1(head);
  const tailText = latin1(tail);
  // An encrypted PDF cannot be reviewed by staff or inspected by a scanner, so
  // it is refused rather than filed as evidence nobody can open.
  if (/\/Encrypt\b/.test(headText) || /\/Encrypt\b/.test(tailText)) {
    throw new Error("Password-protected PDFs are not supported.");
  }
  if (!/%%EOF\s*$/.test(tailText.slice(-2048))) {
    throw new Error("The PDF structure is incomplete.");
  }
}

export type MarketplaceContentVerdict = { detectedMime: MarketplaceUploadMime };

/**
 * Verifies that an object's bytes are the format its declaration claimed.
 *
 * `head` and `tail` are bounded ranges from the stored object, not the whole
 * file. `size` is the object's real length as S3 reported it, so the structural
 * checks that depend on total length use the truth rather than a client claim.
 */
export function verifyMarketplaceUploadContent(input: {
  head: Uint8Array;
  tail: Uint8Array;
  size: number;
  declaredMime: string;
}): MarketplaceContentVerdict {
  const { head, tail, size, declaredMime } = input;
  if (!(MARKETPLACE_UPLOAD_ALLOWED_MIME as readonly string[]).includes(declaredMime)) {
    throw new Error("The stored file type is not accepted.");
  }
  if (size < 1 || size > marketplaceMaxBytesForMime(declaredMime as MarketplaceUploadMime)) {
    throw new Error("The stored file size is not allowed.");
  }
  if (head.length < 1) throw new Error("The stored file is empty.");

  let detectedMime: MarketplaceUploadMime;
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    verifyPdf(head, tail);
    detectedMime = "application/pdf";
  } else if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (head.length < 24 || latin1(head.slice(12, 16)) !== "IHDR") {
      throw new Error("The PNG structure could not be verified.");
    }
    if (latin1(tail.slice(-8, -4)) !== "IEND") {
      throw new Error("The PNG structure could not be verified.");
    }
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (view.getUint32(8) !== 13) throw new Error("The PNG structure could not be verified.");
    imageLimits(view.getUint32(16), view.getUint32(20));
    detectedMime = "image/png";
  } else if (startsWith(head, [0xff, 0xd8, 0xff])) {
    if (tail.at(-2) !== 0xff || tail.at(-1) !== 0xd9) {
      throw new Error("The JPEG structure could not be verified.");
    }
    const dimensions = jpegDimensions(head);
    imageLimits(dimensions.width, dimensions.height);
    detectedMime = "image/jpeg";
  } else if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && latin1(head.slice(8, 12)) === "WEBP") {
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (view.getUint32(4, true) + 8 !== size) {
      throw new Error("The WebP structure could not be verified.");
    }
    const dimensions = webpDimensions(head);
    imageLimits(dimensions.width, dimensions.height);
    detectedMime = "image/webp";
  } else if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    verifyXlsx(head, tail);
    detectedMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (declaredMime === "text/csv") {
    // Nothing recognised as binary: the only remaining accepted format is CSV,
    // and it must prove it is text rather than simply not matching anything.
    verifyCsv(head, tail, size);
    detectedMime = "text/csv";
  } else {
    // A file that claimed a binary format and carries no recognisable signature
    // is reported as the mismatch it is, rather than being pushed through the
    // CSV checks and refused with a message about a format it never claimed.
    throw new Error("The uploaded content does not match its declared type.");
  }

  if (detectedMime !== declaredMime) {
    throw new Error("The uploaded content does not match its declared type.");
  }
  return { detectedMime };
}
