import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const formPaths = [
  "components/PriceCheckForm.tsx",
  "components/marketplace/BuyRequestForm.tsx",
  "components/marketplace/SellSubmissionForm.tsx",
];

test("public forms do not expose internal legal-review notes", async () => {
  for (const path of formPaths) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /implementation copy|pending final legal\/privacy approval/i, path);
    assert.match(source, /TODO\(legal\): final counsel approval is required before production exposure/, path);
  }
});
