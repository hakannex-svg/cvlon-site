import { isBootstrapAdmin, normalizeBootstrapEmail } from "../../lib/price-check/admin/identity.ts";

type IdentityLoginEvent = {
  user: { email?: string; provider?: string };
  deny(): unknown;
};

function enforceApprovedInvite(event: IdentityLoginEvent) {
  const email = normalizeBootstrapEmail(event.user.email ?? "");
  if (!email || !isBootstrapAdmin(email)) {
    return event.deny();
  }
}

function recordStage(stage: "validate" | "signup" | "login", event: IdentityLoginEvent) {
  const email = normalizeBootstrapEmail(event.user.email ?? "");
  console.info(`Civilon Identity gate ${JSON.stringify({
    stage,
    provider: event.user.provider ?? "missing",
    exactEmailAllowed: Boolean(email && isBootstrapAdmin(email)),
  })}`);
}

export default {
  userValidate(event: IdentityLoginEvent) {
    recordStage("validate", event);
    return enforceApprovedInvite(event);
  },
  userSignup(event: IdentityLoginEvent) {
    recordStage("signup", event);
    return enforceApprovedInvite(event);
  },
  userLogin(event: IdentityLoginEvent) {
    recordStage("login", event);
    return enforceApprovedInvite(event);
  },
};
