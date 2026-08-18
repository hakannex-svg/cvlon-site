/**
 * Loads a real server module under `node --test`.
 *
 * The admin server modules are written for the bundler: they use the `@/*`
 * alias, extensionless relative specifiers, and the `next/*` request APIs. None
 * of that resolves under plain Node, which is why the composition layer had no
 * test of its own and an argument-order bug in
 * `buildMarketplaceActionContext` reached a live preview.
 *
 * These hooks close that gap without changing a line of production code:
 *
 *  - `@/x` resolves to `<repo>/x`, matching the tsconfig `paths` entry.
 *  - An extensionless specifier gets `.ts`/`.tsx`/`/index.ts` appended, matching
 *    the bundler's resolution order.
 *  - `next/navigation` and `next/headers` are replaced by inert stubs that throw
 *    if called, so a test that accidentally exercises a request-scoped path
 *    fails loudly instead of silently passing.
 *
 * Nothing here stubs the authorization modules: `policy.ts` and the status
 * policy are the real ones, so a capability test is a test of the real grants.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

const stubbedModules = new Map([
  ["next/navigation", 'export function redirect() { throw new Error("next/navigation redirect() is not available in this test"); }\nexport function notFound() { throw new Error("next/navigation notFound() is not available in this test"); }\n'],
  ["next/headers", 'export function cookies() { throw new Error("next/headers cookies() is not available in this test"); }\nexport function headers() { throw new Error("next/headers headers() is not available in this test"); }\n'],
]);

const STUB_PREFIX = "civilon-test-stub:";
const candidateSuffixes = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function firstExistingFile(base) {
  for (const suffix of candidateSuffixes) {
    const candidate = base + suffix;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

let registered = false;

/** Idempotent: a test file may import this helper more than once. */
export function registerServerModuleHooks() {
  if (registered) return;
  registered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (stubbedModules.has(specifier)) {
        return { url: STUB_PREFIX + specifier, format: "module", shortCircuit: true };
      }

      let base = null;
      if (specifier.startsWith("@/")) {
        base = path.join(repositoryRoot, specifier.slice(2));
      } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      }

      const resolved = base === null ? null : firstExistingFile(base);
      if (resolved !== null) return { url: pathToFileURL(resolved).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },

    load(url, context, nextLoad) {
      if (url.startsWith(STUB_PREFIX)) {
        return { format: "module", source: stubbedModules.get(url.slice(STUB_PREFIX.length)), shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
