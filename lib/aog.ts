export const AOG_PHONE_E164 = "+19093444444";
export const AOG_PHONE_DISPLAY = "+1 909 344 4444";
export const AOG_TEL_URL = `tel:${AOG_PHONE_E164}`;

export type AogMessageData = {
  partNumber?: string;
  quantity?: string;
  aircraftTypeTail?: string;
  aircraftLocation?: string;
  requiredBy?: string;
  nameCompany?: string;
};

export function buildAogWhatsAppUrl(data: AogMessageData = {}) {
  const message = [
    "URGENT AOG REQUEST",
    "",
    `Part number: ${data.partNumber ?? ""}`,
    `Quantity: ${data.quantity ?? ""}`,
    `Aircraft type / tail: ${data.aircraftTypeTail ?? ""}`,
    `Aircraft location: ${data.aircraftLocation ?? ""}`,
    `Required by: ${data.requiredBy ?? ""}`,
    `Name / company: ${data.nameCompany ?? ""}`,
    "",
    "Please advise availability and fastest delivery option.",
  ].join("\n");

  return `https://wa.me/19093444444?text=${encodeURIComponent(message)}`;
}
