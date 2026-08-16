import { isBootstrapAdmin, normalizeBootstrapEmail } from "../../lib/price-check/admin/identity.ts";

type IdentityLoginEvent = {
  user: { email?: string; provider?: string };
  deny(): unknown;
};

export default {
  userLogin(event: IdentityLoginEvent) {
    const email = normalizeBootstrapEmail(event.user.email ?? "");
    if (event.user.provider !== "google" || !email || !isBootstrapAdmin(email)) {
      return event.deny();
    }
  },
};
