import "../../../db/price-check/server-boundary.ts";

import type { TransactionalEmail } from "../../price-check/email/provider.ts";

/**
 * Sell Submission mail templates.
 *
 * Both templates are built from a deliberately tiny input set — a reference, a
 * URL, a timestamp — because a template cannot leak what it was never handed.
 * The disclosure risk on the Sell side is larger than on the Buy side: a
 * supplier's stock, asking price and warehouse location are exactly the facts a
 * competitor would want, and the internal notice fans out to three mailboxes.
 * So neither body carries a part number, a quantity, an inventory description,
 * a price, a currency, a location, a company name, a buyer, a supplier cost or
 * a document reference. The supplier's own address appears only as the
 * destination of their own verification mail.
 *
 * Copy rules encoded here: Civilon reviews offers internally and buys under a
 * separate transaction. No body states or implies acceptance, a purchase, an
 * agreed price, a certification, an airworthiness approval, or an authenticity,
 * fitness, quality or specification guarantee.
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

export function sellSubmissionVerifyEmail(input: {
  from: string;
  to: string;
  reference: string;
  verificationUrl: string;
  expiresAt: Date;
}): TransactionalEmail {
  const reference = escapeHtml(input.reference);
  const verificationUrl = escapeHtml(input.verificationUrl);
  const expiry = formatDate(input.expiresAt);
  const subject = `Confirm your Civilon parts submission — ${input.reference}`;
  const textBody = [
    "CIVILON PARTS",
    "",
    `Reference: ${input.reference}`,
    "",
    "Please confirm this email address so Civilon can review what you have offered.",
    "",
    `Confirm: ${input.verificationUrl}`,
    "",
    `This secure link expires ${expiry}.`,
    "",
    "Every submission gets an internal review; offers are at Civilon's discretion. Nothing in this email confirms acceptance, a purchase, or a price. Your submission is not published or listed anywhere.",
    "",
    "If you did not make this submission, no action is needed.",
    "",
    "Civilon - sales@cvlon.com - +1 909 344 4444",
  ].join("\n");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS</strong><h1 style="font-size:25px;margin:12px 0 0">Confirm your email address.</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p>Please confirm this email address so Civilon can review what you have offered.</p><p style="margin:28px 0"><a href="${verificationUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Confirm email address</a></p><p style="color:#526b7d;font-size:14px">This secure link expires ${escapeHtml(expiry)}. This email intentionally excludes your submission details.</p><p style="color:#526b7d;font-size:14px">Every submission gets an internal review; offers are at Civilon's discretion. Nothing in this email confirms acceptance, a purchase, or a price. Your submission is not published or listed anywhere.</p><hr style="border:0;border-top:1px solid #d7e2e9;margin:26px 0"><p style="font-size:13px">Civilon - sales@cvlon.com - +1 909 344 4444</p></div></div></body></html>`;
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-sell-submission-verify",
    metadata: { reference: input.reference },
  };
}

export function sellSubmissionInternalEmail(input: {
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
  const subject = `New Civilon Sell Submission — ${input.reference}`;
  const textBody = [
    "CIVILON PARTS - INTERNAL",
    "",
    `Reference: ${input.reference}`,
    `Status: ${input.status}`,
    `Received: ${submitted}`,
    "",
    `Open the Civilon staff console (sign-in required): ${input.adminUrl}`,
    "",
    "Submission content is intentionally excluded from this notification. Review it in the signed-in console.",
  ].join("\n");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS / INTERNAL</strong><h1 style="font-size:25px;margin:12px 0 0">New Sell Submission received.</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p><b>Status:</b> ${status}</p><p><b>Received:</b> ${escapeHtml(submitted)}</p><p style="margin:28px 0"><a href="${adminUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Open staff console</a></p><p style="color:#526b7d;font-size:14px">Submission content is intentionally excluded from this notification. Review it in the signed-in console.</p></div></div></body></html>`;
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-sell-submission-internal",
    metadata: { reference: input.reference, status: input.status },
  };
}
