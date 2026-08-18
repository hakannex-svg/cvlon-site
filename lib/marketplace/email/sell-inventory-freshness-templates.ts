import "../../../db/price-check/server-boundary.ts";

import type { TransactionalEmail } from "../../price-check/email/provider.ts";

/**
 * The bulk-inventory freshness check sent to a seller.
 *
 * The input set is three values — a reference, an expiry and a URL — because a
 * template cannot leak what it was never handed. Nothing here carries a part
 * number, a quantity, a line count, an inventory description, a price, a
 * currency, a warehouse or location, a filename, a document's contents, a
 * company name, or any buyer or supplier identity. The seller's own address
 * appears only as the destination of their own message.
 *
 * That minimalism is the point rather than a side effect. This message goes to
 * an inbox Civilon does not control, is forwarded, is read on shared screens and
 * is scanned by corporate mail systems. A message that listed what Civilon
 * believes is in a seller's warehouse would be publishing a supplier's inventory
 * to whoever ends up holding the mail.
 *
 * Copy rules encoded here, all of them load-bearing rather than decorative:
 *
 *  - Answering is a statement by the seller about their own stock, at that
 *    moment. Availability remains subject to confirmation either way.
 *  - Nothing is published, listed, or shown to a buyer, and there is no account.
 *  - Civilon is not obliged to buy, and nothing in the message is an offer, an
 *    acceptance, or an agreed price.
 *  - Documentation varies by part and source, and neither the question nor the
 *    answer certifies or authenticates anything, is airworthiness approval or
 *    any other regulatory approval, or guarantees authenticity or fitness.
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
  "Your answer is your own statement about your stock right now. Nothing you answer is published, listed, or shown to a buyer, and it does not create an account.",
  "Civilon reviews each submission internally and is not obliged to buy. Nothing in this email is an offer, an acceptance, or an agreed price, and availability stays subject to confirmation either way.",
  "Documentation varies by part and source. Neither this question nor your answer certifies or authenticates anything, is airworthiness approval or any other regulatory approval, or is a guarantee of authenticity or fitness.",
] as const;

export function sellInventoryFreshnessEmail(input: {
  from: string;
  to: string;
  reference: string;
  availabilityUrl: string;
  expiresAt: Date;
}): TransactionalEmail {
  const reference = escapeHtml(input.reference);
  const availabilityUrl = escapeHtml(input.availabilityUrl);
  const expiry = formatDate(input.expiresAt);
  const subject = `Is this still available? — ${input.reference}`;

  const textBody = [
    "CIVILON PARTS",
    "",
    `Reference: ${input.reference}`,
    "",
    "Civilon is checking whether what you offered is still available. One tap answers it — there is nothing to upload and nothing to fill in.",
    "",
    `Answer here: ${input.availabilityUrl}`,
    "",
    "You can answer that everything is still available, that some items changed, or that it is no longer available.",
    "",
    `This secure link expires ${expiry}. It does not create an account. This email intentionally excludes your submission details.`,
    "",
    ...BOUNDARIES,
    "",
    "Civilon - sales@cvlon.com - +1 909 344 4444",
  ].join("\n");

  const htmlBoundaries = BOUNDARIES
    .map((line) => `<p style="color:#526b7d;font-size:14px">${escapeHtml(line)}</p>`)
    .join("");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS</strong><h1 style="font-size:25px;margin:12px 0 0">Is this still available?</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p>Civilon is checking whether what you offered is still available. One tap answers it — there is nothing to upload and nothing to fill in.</p><p style="margin:28px 0"><a href="${availabilityUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Answer securely</a></p><p>You can answer that everything is still available, that some items changed, or that it is no longer available.</p><p style="color:#526b7d;font-size:14px">This secure link expires ${escapeHtml(expiry)}. It does not create an account. This email intentionally excludes your submission details.</p>${htmlBoundaries}<hr style="border:0;border-top:1px solid #d7e2e9;margin:26px 0"><p style="font-size:13px">Civilon - sales@cvlon.com - +1 909 344 4444</p></div></div></body></html>`;

  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-sell-inventory-freshness",
    // Reference only. Anything else here would put a record detail into the
    // provider's own message metadata, where it does not belong.
    metadata: { reference: input.reference },
  };
}
