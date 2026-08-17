const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
const isProductionBuild = process.env.NODE_ENV === "production";
export const productionOrigin = "https://cvlon.com";

if (isProductionBuild && !configuredSiteUrl) {
  throw new Error("NEXT_PUBLIC_SITE_URL is required for production builds.");
}

if (isProductionBuild && configuredSiteUrl) {
  if (configuredSiteUrl !== productionOrigin) {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be the approved production origin: ${productionOrigin}`);
  }
}

export const siteConfig = {
  name: "Civilon",
  legalName: "Civilon LLC",
  url: configuredSiteUrl || "http://localhost:3000",
  email: "sales@cvlon.com",
  officePhone: "+1 909 344 4444",
  officeTel: "+19093444444",
  aogPhone: "+1 909 344 4444",
  aogTel: "+19093444444",
  whatsapp: "19093444444",
  address: "375 Sylvan Ave, Suite 23, Englewood Cliffs, NJ 07632",
  hours: "Monday–Friday, 8:00 AM–5:00 PM Eastern Time",
  officeClosure: "Closed weekends and U.S. holidays",
  aogAvailability: "Monitored by a live person 24/7/365",
} as const;

export const routes = ["/", "/parts", "/parts/avionics-instruments", "/parts/wheels-brakes-landing-gear", "/parts/engine-airframe-accessories", "/aircraft", "/aircraft/beechcraft", "/aircraft/cessna-citation", "/aircraft/bombardier", "/aircraft/dassault-falcon", "/aircraft/embraer", "/aog-services", "/repair-management", "/quality-assurance", "/about-us", "/contact-us", "/privacy-policy", "/terms-of-use"] as const;

export const navigation = [
  { label: "Services", items: [{ label: "Parts sourcing", href: "/parts" }, { label: "AOG support", href: "/aog-services" }, { label: "Repair management", href: "/repair-management" }] },
  { label: "Aircraft", items: [{ label: "All aircraft", href: "/aircraft" }, { label: "Beechcraft", href: "/aircraft/beechcraft" }, { label: "Cessna Citation", href: "/aircraft/cessna-citation" }, { label: "Bombardier", href: "/aircraft/bombardier" }, { label: "Dassault Falcon", href: "/aircraft/dassault-falcon" }, { label: "Embraer", href: "/aircraft/embraer" }, { label: "Additional platforms", href: "/aircraft#other-platforms" }] },
  { label: "Quality", items: [{ label: "Quality assurance", href: "/quality-assurance" }] },
  { label: "Company", items: [{ label: "About Civilon", href: "/about-us" }, { label: "Contact", href: "/contact-us" }] },
] as const;
