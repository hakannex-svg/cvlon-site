export const MRO_EUROPE_2026 = {
  name: "MRO Europe 2026",
  dates: "October 28–29, 2026",
  venue: "RAI Amsterdam",
  location: "Amsterdam, The Netherlands",
  booth: "1-1250",
  showEndsAt: "2026-10-30T00:00:00+01:00",
  promotionEndsAt: "2026-11-06T00:00:00+01:00",
  image: "/mro-europe-2026.png",
  imageAlt: "Civilon at MRO Europe, October 28–29, 2026, RAI Amsterdam, Booth 1-1250",
  meetingHref: "mailto:sales@cvlon.com?subject=MRO%20Europe%202026%20meeting%20request%20%E2%80%94%20Booth%201-1250&body=Hello%20Civilon%2C%0A%0AI%20would%20like%20to%20connect%20with%20your%20team%20at%20MRO%20Europe%202026.%0A%0APreferred%20day%20and%20time%3A%0ACompany%3A%0ATopic%3A%0A",
  followUpHref: "mailto:sales@cvlon.com?subject=MRO%20Europe%202026%20follow-up%20%E2%80%94%20Booth%201-1250&body=Hello%20Civilon%2C%0A%0AI%20would%20like%20to%20continue%20our%20MRO%20Europe%202026%20conversation.%0A%0ACompany%3A%0ATopic%3A%0A",
} as const;

export type MroEuropePromotionPhase = "show" | "follow-up" | "inactive";

export function getMroEuropePromotionPhase(now = Date.now()): MroEuropePromotionPhase {
  if (now >= Date.parse(MRO_EUROPE_2026.promotionEndsAt)) return "inactive";
  if (now >= Date.parse(MRO_EUROPE_2026.showEndsAt)) return "follow-up";
  return "show";
}

