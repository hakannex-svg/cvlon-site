import "../server-boundary.ts";

import { randomBytes } from "node:crypto";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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

export function generatePublicReference(entropy: Uint8Array = randomBytes(7)) {
  if (entropy.length < 7) {
    throw new Error("Public-reference entropy must contain at least 7 bytes.");
  }

  const randomValue =
    bytesToBigInt(entropy.slice(0, 7)) &
    ((BigInt(1) << BigInt(50)) - BigInt(1));
  return `PC-${encodeBase32(randomValue, 10)}`;
}
