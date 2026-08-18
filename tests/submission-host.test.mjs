import test from "node:test";
import assert from "node:assert/strict";
import { isApprovedSubmissionHost, isCivilonDeployPreviewHost } from "../lib/submission-host.ts";

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

/**
 * The deploy-preview check is used as proof that a deploy is a Netlify Deploy
 * Preview where the function runtime gives no CONTEXT, so it must exclude
 * production, branch aliases, and a stranger's site with equal firmness.
 */
test("only canonical numbered Civilon deploy-preview hosts are deploy previews", () => {
  for (const hostname of [
    "deploy-preview-1--cvlon.netlify.app",
    "deploy-preview-20--cvlon.netlify.app",
    "deploy-preview-123456--cvlon.netlify.app",
    // Case and one trailing dot still normalize away.
    "DEPLOY-PREVIEW-20--CVLON.NETLIFY.APP",
    "deploy-preview-20--cvlon.netlify.app.",
  ]) assert.equal(isCivilonDeployPreviewHost(hostname), true, hostname);

  for (const hostname of [
    // Production, in both spellings.
    "cvlon.com",
    "www.cvlon.com",
    "cvlon.netlify.app",
    // Branch-deploy aliases: approved for submission, but not deploy previews.
    "codex-civilon-release-readiness--cvlon.netlify.app",
    "codex-foo--cvlon.netlify.app",
    "main--cvlon.netlify.app",
    // Malformed or non-canonical preview numbers.
    "deploy-preview---cvlon.netlify.app",
    "deploy-preview-x--cvlon.netlify.app",
    "deploy-preview-0--cvlon.netlify.app",
    "deploy-preview-007--cvlon.netlify.app",
    "deploy-preview--1--cvlon.netlify.app",
    "deploy-preview-1.2--cvlon.netlify.app",
    "deploy-preview-1 --cvlon.netlify.app",
    "deploy-preview-١--cvlon.netlify.app",
    // Leading or trailing junk around an otherwise canonical label.
    "xdeploy-preview-20--cvlon.netlify.app",
    "sub.deploy-preview-20--cvlon.netlify.app",
    "deploy-preview-20x--cvlon.netlify.app",
    " deploy-preview-20--cvlon.netlify.app",
    "--cvlon.netlify.app",
    // Foreign tenants and suffix lookalikes.
    "deploy-preview-20--attacker.netlify.app",
    "attacker-example.netlify.app",
    "deploy-preview-20--cvlon.netlify.app.attacker.example",
    "cvlon.netlify.app.attacker.example",
    "deploy-preview-20--xcvlon.netlify.app",
    "localhost",
    "",
  ]) assert.equal(isCivilonDeployPreviewHost(hostname), false, hostname);

  // It is strictly narrower than the submission policy, never wider.
  for (const hostname of [
    "cvlon.com",
    "cvlon.netlify.app",
    "deploy-preview-20--cvlon.netlify.app",
    "codex-foo--cvlon.netlify.app",
    "deploy-preview-20--attacker.netlify.app",
  ]) {
    if (isCivilonDeployPreviewHost(hostname)) {
      assert.equal(isApprovedSubmissionHost(hostname), true, hostname);
    }
  }
});
