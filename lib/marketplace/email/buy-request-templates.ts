import "../../../db/price-check/server-boundary.ts";

import type { TransactionalEmail } from "../../price-check/email/provider.ts";

/**
 * Buy Request mail templates.
 *
 * Both templates are built from a deliberately tiny input set — a reference, a
 * URL, a timestamp — because a template cannot leak a part number, a buyer
 * identity, a price, or a supplier that it was never handed. The customer's own
 * address appears only as the destination of their own verification mail.
 *
 * Copy rules encoded here: Civilon sells to the buyer and reviews and sources
 * the request itself; it does not distribute the request to a supplier network.
 * No certification claim, no airworthiness approval, and no authenticity,
 * fitness, quality or specification guarantee appears in either body, and
 * availability is always stated as subject to confirmation.
 */
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function buyRequestVerifyEmail(input: {
  from: string;
  to: string;
  reference: string;
  verificationUrl: string;
  expiresAt: Date;
}): TransactionalEmail {
  const reference = escapeHtml(input.reference);
  const verificationUrl = escapeHtml(input.verificationUrl);
  const expiry = formatDate(input.expiresAt);
  const subject = `Confirm your Civilon parts request — ${input.reference}`;
  const textBody = [
    "CIVILON PARTS",
    "",
    `Reference: ${input.reference}`,
    "",
    "Please confirm this email address so Civilon can continue with your request.",
    "",
    `Confirm: ${input.verificationUrl}`,
    "",
    `This secure link expires ${expiry}.`,
    "",
    "Civilon reviews and sources each request internally. Availability, stated condition, documentation, delivery and price all remain subject to confirmation. Documentation varies by part and source.",
    "",
    "If you did not make this request, no action is needed.",
    "",
    "Civilon - sales@cvlon.com - +1 909 344 4444",
  ].join("\n");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS</strong><h1 style="font-size:25px;margin:12px 0 0">Confirm your email address.</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p>Please confirm this email address so Civilon can continue with your request.</p><p style="margin:28px 0"><a href="${verificationUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Confirm email address</a></p><p style="color:#526b7d;font-size:14px">This secure link expires ${escapeHtml(expiry)}. This email intentionally excludes your request details.</p><p style="color:#526b7d;font-size:14px">Civilon reviews and sources each request internally. Availability, stated condition, documentation, delivery and price all remain subject to confirmation. Documentation varies by part and source.</p><hr style="border:0;border-top:1px solid #d7e2e9;margin:26px 0"><p style="font-size:13px">Civilon - sales@cvlon.com - +1 909 344 4444</p></div></div></body></html>`;
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-buy-request-verify",
    metadata: { reference: input.reference },
  };
}

export function buyRequestInternalEmail(input: {
  from: string;
  to: string;
  reference: string;
  status: string;
  submittedAt: Date;
  adminUrl: string;
}): TransactionalEmail {
  const reference = escapeHtml(input.reference);
  const status = escapeHtml(input.status);
  const adminUrl = escapeHtml(input.adminUrl);
  const submitted = input.submittedAt.toISOString();
  const subject = `New Civilon Buy Request — ${input.reference}`;
  const textBody = [
    "CIVILON PARTS - INTERNAL",
    "",
    `Reference: ${input.reference}`,
    `Status: ${input.status}`,
    `Received: ${submitted}`,
    "",
    `Open the Civilon staff console (sign-in required): ${input.adminUrl}`,
    "",
    "Request content is intentionally excluded from this notification. Review it in the signed-in console.",
  ].join("\n");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS / INTERNAL</strong><h1 style="font-size:25px;margin:12px 0 0">New Buy Request received.</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p><b>Status:</b> ${status}</p><p><b>Received:</b> ${escapeHtml(submitted)}</p><p style="margin:28px 0"><a href="${adminUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Open staff console</a></p><p style="color:#526b7d;font-size:14px">Request content is intentionally excluded from this notification. Review it in the signed-in console.</p></div></div></body></html>`;
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-buy-request-internal",
    metadata: { reference: input.reference, status: input.status },
  };
}
