import "../../../db/price-check/server-boundary.ts";

import type { BuyerOfferSnapshot } from "../buyer-offer-snapshot.ts";
import type { TransactionalEmail } from "../../price-check/email/provider.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

function line(label: string, value: string | number | null) {
  return value === null || value === "" ? null : `${label}: ${value}`;
}

function htmlRow(label: string, value: string | number | null) {
  if (value === null || value === "") return "";
  return `<tr><td style="padding:8px 12px;color:#526b7d">${escapeHtml(label)}</td><td style="padding:8px 12px;font-weight:700">${escapeHtml(String(value))}</td></tr>`;
}

/** Accepts the frozen supplier-free snapshot and nothing else. */
export function buyerOfferCustomerEmail(input: {
  from: string;
  to: string;
  offer: BuyerOfferSnapshot;
  responseUrl: string;
}): TransactionalEmail {
  const offer = input.offer;
  const subject = `Civilon offer ${offer.reference} — version ${offer.version}`;
  const details = [
    line("Reference", offer.reference),
    line("Offer version", offer.version),
    line("Civilon unit price", `${offer.saleUnitPrice} ${offer.currencyCode}`),
    line("Quantity", offer.quantity),
    line("Stated condition", offer.statedCondition),
    line("Delivery option", offer.deliveryOption.replaceAll("_", " ")),
    line("Lead time", offer.leadTimeDays === null ? null : `${offer.leadTimeDays} days`),
    line("Documentation summary", offer.documentsSummary),
    line("Shipping and export scope", offer.shippingAndExportScope),
    line("Offer expires", offer.expiresAt),
  ].filter(Boolean).join("\n");
  const textBody = [
    "CIVILON PARTS",
    "",
    "Civilon's offer",
    details,
    "",
    `Review and respond: ${input.responseUrl}`,
    "",
    "No account or payment is required on the response page.",
    "",
    offer.disclosure,
    "Where repair work is required, Civilon coordinates with appropriately approved repair facilities.",
    "",
    "Civilon - sales@cvlon.com - +1 909 344 4444",
  ].join("\n");
  const rows = [
    htmlRow("Reference", offer.reference),
    htmlRow("Offer version", offer.version),
    htmlRow("Civilon unit price", `${offer.saleUnitPrice} ${offer.currencyCode}`),
    htmlRow("Quantity", offer.quantity),
    htmlRow("Stated condition", offer.statedCondition),
    htmlRow("Delivery option", offer.deliveryOption.replaceAll("_", " ")),
    htmlRow("Lead time", offer.leadTimeDays === null ? null : `${offer.leadTimeDays} days`),
    htmlRow("Documentation summary", offer.documentsSummary),
    htmlRow("Shipping and export scope", offer.shippingAndExportScope),
    htmlRow("Offer expires", offer.expiresAt),
  ].join("");
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:660px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PARTS</strong><h1 style="font-size:25px;margin:12px 0 0">Civilon's offer.</h1></div><div style="background:#fff;padding:30px"><table style="width:100%;border-collapse:collapse">${rows}</table><p style="margin:28px 0"><a href="${escapeHtml(input.responseUrl)}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">Review and respond</a></p><p style="color:#526b7d;font-size:14px">No account or payment is required on the response page.</p><p style="color:#526b7d;font-size:14px">${escapeHtml(offer.disclosure)}</p><p style="color:#526b7d;font-size:14px">Where repair work is required, Civilon coordinates with appropriately approved repair facilities.</p><hr style="border:0;border-top:1px solid #d7e2e9;margin:26px 0"><p style="font-size:13px">Civilon - sales@cvlon.com - +1 909 344 4444</p></div></div></body></html>`;
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-buyer-offer",
    metadata: { reference: offer.reference, version: String(offer.version) },
  };
}

export function buyerOfferResponseInternalEmail(input: {
  from: string;
  to: string;
  reference: string;
  version: number;
  decision: "accepted" | "declined";
  respondedAt: Date;
  adminUrl: string;
}): TransactionalEmail {
  const subject = `Buyer ${input.decision} Civilon offer — ${input.reference}`;
  const textBody = [
    "CIVILON PARTS - INTERNAL",
    "",
    `Reference: ${input.reference}`,
    `Offer version: ${input.version}`,
    `Buyer response: ${input.decision}`,
    `Responded: ${input.respondedAt.toISOString()}`,
    "",
    `Open the signed-in staff console: ${input.adminUrl}`,
  ].join("\n");
  const htmlBody = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#eef3f7;color:#10283e"><div style="max-width:620px;margin:30px auto;background:#fff;padding:30px"><h1>Buyer response recorded.</h1><p><b>Reference:</b> ${escapeHtml(input.reference)}</p><p><b>Offer version:</b> ${input.version}</p><p><b>Response:</b> ${escapeHtml(input.decision)}</p><p><b>Responded:</b> ${escapeHtml(input.respondedAt.toISOString())}</p><p><a href="${escapeHtml(input.adminUrl)}">Open signed-in staff console</a></p></div></body></html>`;
  return {
    from: input.from,
    to: input.to,
    subject,
    textBody,
    htmlBody,
    tag: "civilon-buyer-offer-response",
    metadata: { reference: input.reference, version: String(input.version), decision: input.decision },
  };
}
