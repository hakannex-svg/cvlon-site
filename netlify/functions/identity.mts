import { isBootstrapAdmin, normalizeBootstrapEmail } from "../../lib/price-check/admin/identity.ts";

type IdentityLoginEvent = {
  user: { email?: string; provider?: string };
  deny(): unknown;
};

function enforceApprovedGoogleIdentity(event: IdentityLoginEvent) {
  const email = normalizeBootstrapEmail(event.user.email ?? "");
  if (event.user.provider !== "google" || !email || !isBootstrapAdmin(email)) {
    return event.deny();
  }
}

function enforceAtStage(stage: "validate" | "signup" | "login", event: IdentityLoginEvent) {
  const email = normalizeBootstrapEmail(event.user.email ?? "");
  console.info("Civilon Identity gate", {
    stage,
    provider: event.user.provider ?? "missing",
    exactEmailAllowed: Boolean(email && isBootstrapAdmin(email)),
  });
  return enforceApprovedGoogleIdentity(event);
}

export default {
  userValidate(event: IdentityLoginEvent) { return enforceAtStage("validate", event); },
  userSignup(event: IdentityLoginEvent) { return enforceAtStage("signup", event); },
  userLogin(event: IdentityLoginEvent) { return enforceAtStage("login", event); },
};
