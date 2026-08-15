import test from "node:test";
import assert from "node:assert/strict";
import { isApprovedSubmissionHost } from "../lib/submission-host.ts";

test("accepts only Civilon production and Netlify submission hosts", () => {
  for (const hostname of [
    "cvlon.com",
    "cvlon.netlify.app",
    "codex-civilon-release-readiness--cvlon.netlify.app",
    "deploy-preview-42--cvlon.netlify.app",
  ]) assert.equal(isApprovedSubmissionHost(hostname), true, hostname);
});

test("rejects redirected, local, arbitrary, and lookalike hosts", () => {
  for (const hostname of [
    "www.cvlon.com",
    "localhost",
    "127.0.0.1",
    "attacker-example.netlify.app",
    "cvlon.netlify.app.attacker.example",
    "--cvlon.netlify.app",
  ]) assert.equal(isApprovedSubmissionHost(hostname), false, hostname);
});
