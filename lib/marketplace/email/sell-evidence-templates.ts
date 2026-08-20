import "../../../db/price-check/server-boundary.ts";

import {
  sellEvidenceCategoryLabels,
  type SellEvidenceRequestCategory,
} from "../../../db/price-check/domain/sell-evidence-request.ts";
import type { TransactionalEmail } from "../../price-check/email/provider.ts";

/**
 * The follow-up evidence request sent to a seller.
 *
 * The input set is deliberately tiny — a reference, category labels, an expiry
 * and a URL — because a template cannot leak what it was never handed. Nothing
 * here carries a part number, a quantity, an inventory description, a price, a
 * currency, a location, a filename, a document's contents, a company name, or
 * any buyer or supplier identity. The seller's own address appears only as the
 * destination of their own message.
 *
 * Copy rules encoded here, all of them load-bearing rather than decorative:
 *
 *  - Files are optional evidence for Civilon's internal review. Civilon already
 *    has the offer; nothing was lost by not attaching anything the first time.
 *  - Nothing is published, listed, or shown to a buyer.
 *  - Offers are at Civilon's discretion, and nothing in the message is an offer, an
 *    acceptance, or an agreed price.
 *  - Documentation varies by part and source.
 *  - Uploading, and Civilon's review of what is uploaded, do not certify or
 *    authenticate anything, are not airworthiness approval or any other
 *    regulatory approval, and are not a guarantee of authenticity or fitness.
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

const BOUNDARIES = [
  "Files are optional evidence for Civilon's internal review. Civilon already has your submission and nothing you send here is published, listed, or shown to a buyer.",
  "Every submission gets an internal review; offers are at Civilon's discretion. Nothing in this email is an offer, an acceptance, or an agreed price.",
  "Documentation varies by part and source. Uploading files, and Civilon's review of them, do not certify or authenticate anything, are not airworthiness approval or any other regulatory approval, and are not a guarantee of authenticity or fitness.",
] as const;

export function sellEvidenceRequestEmail(input: {
  from: string;
  to: string;
  reference: string;
  categories: readonly SellEvidenceRequestCategory[];
  evidenceUrl: string;
  expiresAt: Date;
}): TransactionalEmail {
  const labels = input.categories.map((category) => sellEvidenceCategoryLabels[category]);
  const reference = escapeHtml(input.reference);
  const evidenceUrl = escapeHtml(input.evidenceUrl);
  const expiry = formatDate(input.expiresAt);
  const subject = `Civilon can use a little more on your submission — ${input.reference}`;

  const textBody = [
    "CIVILON PARTS",
    "",
    `Reference: ${input.reference}`,
    "",
    "Civilon would find the following helpful while reviewing what you have offered:",
    "",
    ...labels.map((label) => `- ${label}`),
    "",
    "Photos you already have are fine. No camera, live capture, or location is required or requested.",
    "",
    `Send them securely: ${input.evidenceUrl}`,
    "",
    `This secure link expires ${expiry}. It does not create an account.`,
    "",
    ...BOUNDARIES,
    "",
    "Civilon - sales@cvlon.com - +1 909 344 4444",
  ].join("\n");

  const htmlLabels = labels.map((label) => `<li>${escapeHtml(label)}</li>`).join("");
  const htmlBoundaries = BOUNDARIES
    .map((line) => `<p style="color:#526b7d;font-size:14px">${escapeHtml(line)}</p>`)
    .join("");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS</strong><h1 style="font-size:25px;margin:12px 0 0">A little more would help.</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p>Civilon would find the following helpful while reviewing what you have offered:</p><ul>${htmlLabels}</ul><p>Photos you already have are fine. No camera, live capture, or location is required or requested.</p><p style="margin:28px 0"><a href="${evidenceUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Send files securely</a></p><p style="color:#526b7d;font-size:14px">This secure link expires ${escapeHtml(expiry)}. It does not create an account. This email intentionally excludes your submission details.</p>${htmlBoundaries}<hr style="border:0;border-top:1px solid #d7e2e9;margin:26px 0"><p style="font-size:13px">Civilon - sales@cvlon.com - +1 909 344 4444</p></div></div></body></html>`;

  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-sell-evidence-request",
    // Reference only. A category list here would put the request into the
    // provider's message metadata, where it does not belong.
    metadata: { reference: input.reference },
  };
}
