import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("migration-free staff management uses the existing admin user/session schema", () => {
  const repository = read("db", "price-check", "repositories", "admin-repository.ts");
  const identity = read("lib", "price-check", "admin", "identity.ts");
  const route = read("app", "api", "admin", "staff", "route.ts");
  assert.match(identity, /pending:civilon-google-oidc/);
  assert.match(repository, /STAFF_CREATED_PENDING/);
  assert.match(repository, /STAFF_IDENTITY_BOUND/);
  assert.match(repository, /adminSessions/);
  assert.doesNotMatch(repository + route, /admin_staff_invitations/);
});

test("first login binds only an active pending exact-email record", () => {
  const repository = read("db", "price-check", "repositories", "admin-repository.ts");
  assert.match(repository, /eq\(adminUsers\.identityProviderIssuer, PENDING_STAFF_ISSUER\)/);
  assert.match(repository, /if \(!emailBinding\.active\)/);
  assert.match(repository, /eq\(adminUsers\.displayEmail, identity\.email\)/);
  assert.match(repository, /identityProviderSubject: identity\.subject/);
});

test("staff mutations revoke sessions and protect the final administrator", () => {
  const repository = read("db", "price-check", "repositories", "admin-repository.ts");
  assert.match(repository, /STAFF_ROLE_CHANGED/);
  assert.match(repository, /STAFF_DISABLED/);
  assert.match(repository, /STAFF_REENABLED/);
  assert.match(repository, /STAFF_SESSIONS_REVOKED/);
  assert.match(repository, /At least one active Civilon administrator is required/);
});

test("staff page and API are admin/manage_staff gated with origin protection", () => {
  const page = read("app", "admin", "staff", "page.tsx");
  const route = read("app", "api", "admin", "staff", "route.ts");
  assert.match(page, /access\.user\.role !== "ADMIN"/);
  assert.match(route, /requireAdminApi\("manage_staff"\)/);
  assert.match(route, /verifyAdminMutationOrigin\(request\)/);
});
