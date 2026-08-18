import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CLAUDE_BIN_ENV,
  CoordinatorError,
  commandCleanup,
  commandList,
  commandRun,
  commandStatus,
  readState,
  runDir,
} from "../scripts/claude-coordinator.mjs";

const FAKE_CLAUDE = fileURLToPath(new URL("./helpers/fake-claude.mjs", import.meta.url));

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trimEnd();
}

/**
 * Creates a throwaway Git repository inside its own parent directory, so the coordinator's
 * sibling worktree lands in the temp tree rather than next to the real checkout.
 */
function createTempRepo(t, { files = { "README.md": "baseline\n" } } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "coordinator-repo-"));
  t.after(() => {
    // Worktrees may hold read-only Git metadata on Windows; force removal.
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const repo = path.join(root, "source");
  fs.mkdirSync(repo, { recursive: true });
  git(["init", "--initial-branch=main"], repo);
  git(["config", "user.name", "Coordinator Test"], repo);
  git(["config", "user.email", "coordinator@example.invalid"], repo);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(repo, name), contents, "utf8");
  }
  git(["add", "--all"], repo);
  git(["commit", "-m", "baseline"], repo);
  return { root, repo, baseline: git(["rev-parse", "HEAD"], repo) };
}

function writePrompt(repoRoot, text = "Add a widget to the thing.") {
  const file = path.join(repoRoot, "task-prompt.md");
  fs.writeFileSync(file, text, "utf8");
  return file;
}

/**
 * An `io` bundle that captures output instead of writing to the terminal. CLAUDE_CODE_MAX_RETRIES
 * is stripped from the inherited environment so these tests exercise the coordinator's default
 * rather than whatever the ambient shell happens to set.
 */
function captureIo(cwd, env = {}) {
  const out = [];
  const err = [];
  const inherited = { ...process.env };
  delete inherited.CLAUDE_CODE_MAX_RETRIES;
  return {
    io: {
      cwd,
      env: { ...inherited, [CLAUDE_BIN_ENV]: FAKE_CLAUDE, ...env },
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

async function assertRejectsWithCode(promiseOrFn, code) {
  try {
    await (typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn);
  } catch (error) {
    assert.ok(error instanceof CoordinatorError, `expected CoordinatorError, received ${error}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected a CoordinatorError with code ${code}, but nothing was thrown`);
}

test("--dry-run resolves a full plan without touching the repository", async (t) => {
  const { root, repo, baseline } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io, stdout } = captureIo(repo);

  const { code, plan } = await commandRun({ promptFile, repo, dryRun: true, name: "Dry Run" }, io);

  assert.equal(code, 0);
  assert.equal(plan.baselineCommit, baseline);
  assert.equal(plan.model, "opus");
  assert.equal(plan.fallbackModel, "sonnet");
  assert.equal(plan.invocation.promptDelivery, "stdin");
  assert.equal(plan.invocation.envOverrides.CLAUDE_CODE_MAX_RETRIES, "3");
  assert.ok(plan.invocation.args.includes("--fallback-model"));
  assert.ok(!plan.invocation.args.some((arg) => arg.includes("dangerously")));
  assert.match(plan.composedPrompt, /Add a widget to the thing\./);
  assert.match(stdout(), /"dryRun": true/);

  assert.ok(!fs.existsSync(plan.worktree), "a dry run creates no worktree");
  assert.ok(!fs.existsSync(path.join(repo, ".claude-coordinator")), "a dry run persists no state");
  assert.equal(git(["status", "--porcelain"], repo), "", "a dry run leaves the source repository clean");
});

test("a run isolates work in its own worktree and leaves the source repository untouched", async (t) => {
  const { root, repo, baseline } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const recordFile = path.join(root, "fake-claude-record.json");
  const { io, stderr } = captureIo(repo, { FAKE_CLAUDE_MODE: "work", FAKE_CLAUDE_RECORD_FILE: recordFile });

  const { code, state, evidence } = await commandRun({ promptFile, repo, pollMs: "250", name: "widget" }, io);

  assert.equal(code, 0);
  assert.equal(state.status, "completed_unverified", "a clean exit is recorded as unverified, never as accepted");
  assert.equal(state.exitCode, 0);
  assert.equal(state.baselineCommit, baseline);
  assert.equal(state.branch, `claude/${state.runId}`);

  // Isolation: the work happened somewhere else, on its own branch.
  assert.notEqual(path.resolve(state.worktree), path.resolve(repo));
  assert.equal(path.dirname(path.resolve(state.worktree)), path.resolve(root));
  assert.ok(fs.existsSync(state.worktree), "the worktree is kept for review");
  assert.ok(fs.existsSync(path.join(state.worktree, "fake-claude-change.txt")));
  assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], state.worktree), `claude/${state.runId}`);

  // The source worktree is untouched: same HEAD, same branch, still clean, no stray files.
  assert.equal(git(["rev-parse", "HEAD"], repo), baseline);
  assert.equal(git(["rev-parse", "--abbrev-ref", "HEAD"], repo), "main");
  assert.equal(git(["status", "--porcelain"], repo), "", "run state never shows up as untracked noise");
  assert.ok(!fs.existsSync(path.join(repo, "fake-claude-change.txt")));
  assert.equal(evidence.sourceHeadUnchanged, true);
  assert.equal(fs.readFileSync(path.join(repo, ".claude-coordinator", ".gitignore"), "utf8").trim().split("\n").at(-1), "*");

  // Independently gathered Git evidence, not Claude's claims.
  assert.equal(evidence.commitCount, 1);
  assert.equal(state.commitCount, 1);
  assert.match(evidence.commitLog, /fake: apply delegated change/);
  assert.match(evidence.diffStat, /fake-claude-change\.txt/);
  assert.notEqual(evidence.head, baseline, "the worktree moved past the baseline");

  // The invocation actually delivered: opus first, sonnet fallback, reduced retries, prompt on stdin.
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  assert.equal(record.argv[record.argv.indexOf("--model") + 1], "opus");
  assert.equal(record.argv[record.argv.indexOf("--fallback-model") + 1], "sonnet");
  assert.equal(record.argv[record.argv.indexOf("--output-format") + 1], "stream-json");
  assert.ok(record.argv.includes("--verbose"));
  assert.ok(record.argv.includes("--print"));
  assert.equal(record.env.CLAUDE_CODE_MAX_RETRIES, "3");
  assert.equal(path.resolve(record.cwd), path.resolve(state.worktree), "Claude runs inside the worktree");
  assert.match(record.prompt, /Add a widget to the thing\./);
  assert.match(record.prompt, new RegExp(baseline));
  assert.ok(!record.argv.some((arg) => arg.includes("Add a widget")), "the prompt is not exposed on argv");

  // Persisted artifacts.
  const dir = runDir(repo, state.runId);
  const streamLines = fs.readFileSync(path.join(dir, "stream.jsonl"), "utf8").split("\n").filter(Boolean);
  assert.ok(streamLines.length >= 3);
  assert.ok(streamLines.every((line) => JSON.parse(line).type), "every captured line is valid stream JSON");
  assert.equal(state.claude.sessionId, "fake-session-0001");
  assert.deepEqual(state.claude.modelsObserved.sort(), ["claude-opus-fake", "claude-sonnet-fake"]);
  assert.equal(state.claude.costUsd, 0.42);
  assert.equal(state.claude.turns, 3);
  assert.ok(fs.existsSync(path.join(dir, "stderr.log")));
  assert.match(fs.readFileSync(path.join(dir, "prompt.txt"), "utf8"), /Stop-and-report conditions/);
  assert.equal(state.lastHeartbeatAt !== null, true);
  assert.ok(state.pid > 0);

  // The report must refuse to present a clean exit as acceptance.
  const report = fs.readFileSync(path.join(dir, "report.md"), "utf8");
  assert.match(report, /Independent Codex review is still required/);
  assert.match(report, /Independently verified Git evidence/);
  assert.match(report, /fake: apply delegated change/);
  assert.doesNotMatch(report, /\bsucceeded\b/);
  assert.match(stderr(), /NOT accepted delivery/);
});

test("the monitor observes file changes that are never committed", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io } = captureIo(repo, { FAKE_CLAUDE_MODE: "dirty" });

  const { state, evidence } = await commandRun({ promptFile, repo, pollMs: "250", name: "dirty" }, io);

  assert.equal(state.status, "completed_unverified");
  assert.equal(evidence.commitCount, 0, "nothing was committed");
  assert.equal(evidence.head, state.baselineCommit, "HEAD never moved");
  assert.equal(state.dirtyCount, 1);
  assert.deepEqual(state.dirtyFiles, ["fake-claude-change.txt"]);

  const report = fs.readFileSync(path.join(runDir(repo, state.runId), "report.md"), "utf8");
  assert.match(report, /Commits on top of baseline: \*\*0\*\*/);
  assert.match(report, /Uncommitted\/untracked entries in worktree: \*\*1\*\*/);
});

test("a Claude error result is recorded as failed, not as delivery", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io } = captureIo(repo, { FAKE_CLAUDE_MODE: "fail" });

  const { code, state } = await commandRun({ promptFile, repo, pollMs: "250", name: "fail" }, io);

  assert.equal(code, 1);
  assert.equal(state.status, "failed");
  assert.equal(state.exitCode, 1);
  assert.equal(state.claude.resultIsError, true);
  assert.match(state.error, /error result/);
});

test("a run that overruns its timeout is terminated and recorded as a non-success", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io, stderr } = captureIo(repo, { FAKE_CLAUDE_MODE: "hang" });

  const { code, state } = await commandRun(
    { promptFile, repo, pollMs: "250", timeoutMinutes: "0.02", name: "hang" },
    io,
  );

  assert.equal(code, 1, "a timeout is never reported as success");
  assert.equal(state.status, "timed_out");
  assert.notEqual(state.status, "completed_unverified");
  assert.match(state.error, /Terminated by coordinator after 0\.02 minute/);
  assert.ok(state.endedAt, "the terminal timestamp is recorded");
  assert.match(stderr(), /timeout after 0\.02 minute/);
  assert.equal(
    (stderr().match(/timeout after 0\.02 minute/g) ?? []).length,
    1,
    "once a termination reason is set, later poll ticks never issue another termination request",
  );

  const persisted = readState(repo, state.runId);
  assert.equal(persisted.status, "timed_out");
  assert.ok(fs.existsSync(path.join(runDir(repo, state.runId), "report.md")));
  assert.equal(git(["status", "--porcelain"], repo), "", "even a timed-out run leaves the source repository clean");
});

test("a configured --max-budget-usd reaches the Claude CLI argv verbatim", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const recordFile = path.join(root, "fake-claude-budget-record.json");
  const { io } = captureIo(repo, { FAKE_CLAUDE_MODE: "work", FAKE_CLAUDE_RECORD_FILE: recordFile });

  const { state } = await commandRun({ promptFile, repo, pollMs: "250", name: "budget", maxBudgetUsd: "2.75" }, io);

  assert.equal(state.maxBudgetUsd, 2.75);
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8"));
  const flagIndex = record.argv.indexOf("--max-budget-usd");
  assert.notEqual(flagIndex, -1, "the budget flag is enforced natively by the CLI, so it must be on the child argv");
  assert.equal(record.argv[flagIndex + 1], "2.75", "the exact configured value reaches the CLI");
});

test("status and cleanup reject run IDs that could escape the runs directory", async (t) => {
  const { repo } = createTempRepo(t);
  const { io } = captureIo(repo);

  for (const traversal of ["..", "../sibling", "..\\sibling", "runs/../../escape", "a/b", "a\\b", "/etc/passwd", "C:\\Windows", "run.id"]) {
    await assertRejectsWithCode(() => commandStatus(traversal, { repo }, io), "INVALID_RUN_ID");
    await assertRejectsWithCode(() => commandCleanup(traversal, { repo }, io), "INVALID_RUN_ID");
  }
  assert.ok(!fs.existsSync(path.join(repo, ".claude-coordinator")), "a rejected ID never creates or touches run state");
});

test("cleanup refuses a tampered state.json and never touches the path it points at", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io } = captureIo(repo, { FAKE_CLAUDE_MODE: "work" });

  const { state } = await commandRun({ promptFile, repo, pollMs: "250", name: "tamper" }, io);
  const stateFile = path.join(runDir(repo, state.runId), "state.json");

  // A decoy directory a tampered state.json tries to aim cleanup at.
  const decoy = path.join(root, "decoy-not-a-worktree");
  fs.mkdirSync(decoy, { recursive: true });
  const decoyFile = path.join(decoy, "precious.txt");
  fs.writeFileSync(decoyFile, "must survive\n", "utf8");

  const pristine = JSON.parse(fs.readFileSync(stateFile, "utf8"));

  // Tampered worktree path → refused, decoy untouched.
  fs.writeFileSync(stateFile, JSON.stringify({ ...pristine, worktree: decoy }, null, 2), "utf8");
  await assertRejectsWithCode(() => commandCleanup(state.runId, { repo, force: true }, io), "WORKTREE_MISMATCH");
  assert.ok(fs.existsSync(decoy), "the decoy directory still exists");
  assert.equal(fs.readFileSync(decoyFile, "utf8"), "must survive\n", "the decoy contents are untouched");
  assert.ok(fs.existsSync(state.worktree), "the real worktree is also untouched by the refusal");

  // Tampered run ID → refused.
  fs.writeFileSync(stateFile, JSON.stringify({ ...pristine, runId: "some-other-run" }, null, 2), "utf8");
  await assertRejectsWithCode(() => commandCleanup(state.runId, { repo }, io), "STATE_MISMATCH");

  // Tampered repo → refused.
  fs.writeFileSync(stateFile, JSON.stringify({ ...pristine, repo: path.join(root, "elsewhere") }, null, 2), "utf8");
  await assertRejectsWithCode(() => commandCleanup(state.runId, { repo }, io), "STATE_MISMATCH");

  // Non-string path values are refused cleanly instead of reaching path.resolve.
  fs.writeFileSync(stateFile, JSON.stringify({ ...pristine, repo: { path: repo } }, null, 2), "utf8");
  await assertRejectsWithCode(() => commandCleanup(state.runId, { repo }, io), "STATE_MISMATCH");

  // Missing worktree entry → refused as incomplete rather than guessed at.
  fs.writeFileSync(stateFile, JSON.stringify({ ...pristine, worktree: null }, null, 2), "utf8");
  await assertRejectsWithCode(() => commandCleanup(state.runId, { repo }, io), "STATE_INCOMPLETE");

  fs.writeFileSync(stateFile, JSON.stringify({ ...pristine, worktree: { path: state.worktree } }, null, 2), "utf8");
  await assertRejectsWithCode(() => commandCleanup(state.runId, { repo }, io), "STATE_INCOMPLETE");

  // Restored pristine state cleans up normally, proving only the tampering blocked it.
  fs.writeFileSync(stateFile, JSON.stringify(pristine, null, 2), "utf8");
  const result = commandCleanup(state.runId, { repo }, io);
  assert.equal(result.removed, true);
  assert.ok(!fs.existsSync(state.worktree));
  assert.ok(fs.existsSync(decoyFile), "the decoy survives the real cleanup too");
});

test("cleanup refuses a dirty worktree unless it is explicitly forced", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io } = captureIo(repo, { FAKE_CLAUDE_MODE: "dirty" });

  const { state } = await commandRun({ promptFile, repo, pollMs: "250", name: "cleanup-dirty" }, io);
  assert.ok(fs.existsSync(state.worktree));

  const refusal = await assertRejectsWithCode(() => commandCleanup(state.runId, { repo }, io), "DIRTY_WORKTREE");
  assert.match(refusal.message, /fake-claude-change\.txt/);
  assert.match(refusal.message, /--force/);
  assert.ok(fs.existsSync(state.worktree), "the refusal leaves the worktree in place");
  assert.equal(readState(repo, state.runId).status, "completed_unverified", "a refused cleanup does not mark the run cleaned");

  const forced = commandCleanup(state.runId, { repo, force: true }, io);
  assert.equal(forced.removed, true);
  assert.ok(!fs.existsSync(state.worktree));
  assert.equal(readState(repo, state.runId).status, "cleaned");
  assert.equal(readState(repo, state.runId).cleanupForced, true);
  assert.ok(fs.existsSync(path.join(runDir(repo, state.runId), "report.md")), "run artifacts survive cleanup");
});

test("cleanup succeeds without --force when the worktree is clean, and keeps the branch", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io, stdout } = captureIo(repo, { FAKE_CLAUDE_MODE: "work" });

  const { state } = await commandRun({ promptFile, repo, pollMs: "250", name: "cleanup-clean" }, io);
  assert.equal(state.dirtyCount, 0);

  const result = commandCleanup(state.runId, { repo }, io);

  assert.equal(result.removed, true);
  assert.ok(!fs.existsSync(state.worktree));
  assert.match(stdout(), /preserved on the branch/, "committed work is called out before the worktree goes away");
  assert.equal(git(["rev-parse", "--verify", `${state.branch}^{commit}`], repo).length, 40, "the branch survives so the commits are not lost");
  assert.equal(git(["status", "--porcelain"], repo), "");

  // Cleaning up twice is safe: the second pass just prunes bookkeeping.
  const again = commandCleanup(state.runId, { repo }, io);
  assert.equal(again.removed, false);
});

test("status and list read persisted runs, and unknown runs fail clearly", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io, stdout } = captureIo(repo, { FAKE_CLAUDE_MODE: "work" });

  const empty = commandList({ repo }, io);
  assert.deepEqual(empty.runs, []);

  const { state } = await commandRun({ promptFile, repo, pollMs: "250", name: "inspect" }, io);

  const status = commandStatus(state.runId, { repo }, io);
  assert.equal(status.state.runId, state.runId);
  assert.match(stdout(), /Independent Codex review is required/);

  const asJson = commandStatus(state.runId, { repo, json: true }, io);
  assert.equal(asJson.state.branch, state.branch);

  const listed = commandList({ repo }, io);
  assert.equal(listed.runs.length, 1);
  assert.equal(listed.runs[0].runId, state.runId);

  await assertRejectsWithCode(() => commandStatus("no-such-run", { repo }, io), "RUN_NOT_FOUND");
  await assertRejectsWithCode(() => commandCleanup("no-such-run", { repo }, io), "RUN_NOT_FOUND");
});

test("bad repositories and refs are rejected before anything is created", async (t) => {
  const { root, repo } = createTempRepo(t);
  const promptFile = writePrompt(root);
  const { io } = captureIo(repo);

  await assertRejectsWithCode(
    () => commandRun({ promptFile, repo: path.join(root, "does-not-exist") }, io),
    "REPO_NOT_FOUND",
  );
  await assertRejectsWithCode(() => commandRun({ promptFile, repo: root }, io), "NOT_A_GIT_REPO");
  await assertRejectsWithCode(() => commandRun({ promptFile, repo, base: "no-such-ref" }, io), "BAD_BASE_REF");
  assert.ok(!fs.existsSync(path.join(repo, ".claude-coordinator")), "a rejected run persists nothing");
});
