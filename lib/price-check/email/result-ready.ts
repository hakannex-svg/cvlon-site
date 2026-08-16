import "../../../db/price-check/server-boundary.ts";

import type { TransactionalEmail } from "./provider.ts";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function resultReadyEmail(input: { from: string; to: string; reference: string; secureUrl: string; expiresAt: Date }): TransactionalEmail {
  const reference = escapeHtml(input.reference);
  const secureUrl = escapeHtml(input.secureUrl);
  const expiry = input.expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const subject = `Your Civilon Price Check is ready — ${input.reference}`;
  const textBody = `CIVILON PRICE CHECK\n\nReference: ${input.reference}\n\nYour reviewed Price Check is ready.\n\nView your private result: ${input.secureUrl}\n\nThis secure link expires ${expiry}. If you need assistance, contact sales@cvlon.com or +1 201 540 0961.\n\nCivilon`;
  const htmlBody = `<!doctype html><html><body style="margin:0;background:#eef3f7;color:#10283e;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:38px 22px"><div style="background:#0b2941;color:#fff;padding:26px 30px"><strong style="color:#8ecbff;letter-spacing:.08em">CIVILON PRICE CHECK</strong><h1 style="font-size:25px;margin:12px 0 0">Your reviewed Price Check is ready.</h1></div><div style="background:#fff;padding:30px"><p><b>Reference:</b> ${reference}</p><p>Your confidential result is available through the secure link below.</p><p style="margin:28px 0"><a href="${secureUrl}" style="display:inline-block;background:#145fae;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">View result</a></p><p style="color:#526b7d;font-size:14px">This link expires ${escapeHtml(expiry)}. The email intentionally excludes transaction and pricing details.</p><hr style="border:0;border-top:1px solid #d7e2e9;margin:26px 0"><p style="font-size:13px">Civilon · sales@cvlon.com · +1 201 540 0961</p></div></div></body></html>`;
  return { from: input.from, to: input.to, subject, textBody, htmlBody, tag: "civilon-price-check-result", metadata: { reference: input.reference } };
}
