import "../server-boundary.ts";

import { randomBytes } from "node:crypto";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Approved human-readable reference prefixes. Kept as a closed allowlist so a
 * caller can never derive a reference namespace from user-controlled input.
 */
export const publicReferencePrefixes = ["PC", "BR", "SS"] as const;
export type PublicReferencePrefix = (typeof publicReferencePrefixes)[number];

export function isPublicReferencePrefix(value: unknown): value is PublicReferencePrefix {
  return typeof value === "string" && (publicReferencePrefixes as readonly string[]).includes(value);
}

function encodeBase32(value: bigint, length: number) {
  let encoded = "";
  let remaining = value;

  for (let index = 0; index < length; index += 1) {
    encoded = CROCKFORD_BASE32[Number(remaining & BigInt(31))] + encoded;
    remaining >>= BigInt(5);
  }

  return encoded;
}

function bytesToBigInt(bytes: Uint8Array) {
  return bytes.reduce(
    (value, byte) => (value << BigInt(8)) | BigInt(byte),
    BigInt(0),
  );
}

export function generateOrderedId(
  timestamp = Date.now(),
  entropy: Uint8Array = randomBytes(10),
) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 2 ** 48) {
    throw new Error("ULID timestamp is outside the supported 48-bit range.");
  }
  if (entropy.length !== 10) {
    throw new Error("ULID entropy must contain exactly 10 bytes.");
  }

  return `${encodeBase32(BigInt(timestamp), 10)}${encodeBase32(
    bytesToBigInt(entropy),
    16,
  )}`;
}

/**
 * Generates a human-readable reference. The default prefix stays "PC" so every
 * existing Price Check call site and the persisted PC- format are unchanged.
 */
export function generatePublicReference(): string;
export function generatePublicReference(entropy: Uint8Array): string;
export function generatePublicReference(prefix: PublicReferencePrefix): string;
export function generatePublicReference(prefix: PublicReferencePrefix, entropy: Uint8Array): string;
export function generatePublicReference(
  prefixOrEntropy?: PublicReferencePrefix | Uint8Array,
  maybeEntropy?: Uint8Array,
) {
  let prefix: PublicReferencePrefix = "PC";
  let supplied: Uint8Array | undefined;

  if (prefixOrEntropy instanceof Uint8Array) {
    // Legacy Price Check call shape: entropy only, always PC.
    if (maybeEntropy !== undefined) {
      throw new Error("Public-reference entropy must not be supplied twice.");
    }
    supplied = prefixOrEntropy;
  } else if (prefixOrEntropy !== undefined) {
    if (!isPublicReferencePrefix(prefixOrEntropy)) {
      throw new Error("Public-reference prefix is not an approved Civilon prefix.");
    }
    prefix = prefixOrEntropy;
    supplied = maybeEntropy;
  } else if (maybeEntropy !== undefined) {
    throw new Error("Public-reference prefix is not an approved Civilon prefix.");
  }

  if (supplied !== undefined && !(supplied instanceof Uint8Array)) {
    throw new Error("Public-reference entropy must be a Uint8Array.");
  }

  const entropy = supplied ?? randomBytes(7);
  if (entropy.length < 7) {
    throw new Error("Public-reference entropy must contain at least 7 bytes.");
  }

  const randomValue =
    bytesToBigInt(entropy.slice(0, 7)) &
    ((BigInt(1) << BigInt(50)) - BigInt(1));
  return `${prefix}-${encodeBase32(randomValue, 10)}`;
}
