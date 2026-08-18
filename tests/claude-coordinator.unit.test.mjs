import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_PERMISSION_MODES,
  CLAUDE_BIN_ENV,
  assertValidRunId,
  ClaudeStreamObserver,
  CoordinatorError,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_MODEL,
  buildClaudeArgs,
  buildClaudeEnv,
  buildRunId,
  composePrompt,
  createLineSplitter,
  parseCliArgs,
  resolveClaudeCommand,
  resolveRunOptions,
  sanitizeRunName,
} from "../scripts/claude-coordinator.mjs";

/** Asserts that `fn` throws a CoordinatorError carrying `code`. */
function assertCoordinatorError(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof CoordinatorError, `expected CoordinatorError, received ${error}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected a CoordinatorError with code ${code}, but nothing was thrown`);
}

function withTempPromptFile(contents, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-prompt-"));
  try {
    const file = path.join(dir, "prompt.md");
    fs.writeFileSync(file, contents, "utf8");
    return run(file, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("run defaults put Opus first with Sonnet as the automatic fallback", () => {
  const args = buildClaudeArgs({
    model: DEFAULT_MODEL,
    fallbackModel: DEFAULT_FALLBACK_MODEL,
    permissionMode: "acceptEdits",
    maxTurns: null,
    allowedTools: null,
  });

  assert.equal(DEFAULT_MODEL, "opus");
  assert.equal(DEFAULT_FALLBACK_MODEL, "sonnet");
  assert.deepEqual(args, [
    "--print",
    "--model", "opus",
    "--fallback-model", "sonnet",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "acceptEdits",
  ]);
  // The order matters: --model must be immediately followed by its value, likewise the fallback.
  assert.equal(args[args.indexOf("--model") + 1], "opus");
  assert.equal(args[args.indexOf("--fallback-model") + 1], "sonnet");
});

test("optional run flags are appended only when configured", () => {
  const args = buildClaudeArgs({
    model: "opus",
    fallbackModel: "sonnet",
    permissionMode: "plan",
    maxTurns: 12,
    maxBudgetUsd: 3.5,
    allowedTools: "Read,Edit,Bash",
  });
  assert.equal(args[args.indexOf("--max-turns") + 1], "12");
  assert.equal(args[args.indexOf("--allowed-tools") + 1], "Read,Edit,Bash");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.equal(args[args.indexOf("--max-budget-usd") + 1], "3.5", "the budget is enforced natively by the CLI, so it must be on the argv");

  const withoutBudget = buildClaudeArgs({ model: "opus", fallbackModel: "sonnet", permissionMode: "plan", maxTurns: null, maxBudgetUsd: null, allowedTools: null });
  assert.ok(!withoutBudget.includes("--max-budget-usd"), "no budget flag when none is configured");
});

test("the invocation never contains a permission bypass and the prompt is never an argument", () => {
  const prompt = "do the thing";
  const args = buildClaudeArgs({ model: "opus", fallbackModel: "sonnet", permissionMode: "acceptEdits", maxTurns: null, allowedTools: null });
  assert.ok(!args.includes("--dangerously-skip-permissions"));
  assert.ok(!args.some((arg) => arg.includes("dangerously")));
  assert.ok(!args.includes(prompt), "the prompt must be delivered on stdin, never on argv");
  assert.ok(!ALLOWED_PERMISSION_MODES.includes("bypassPermissions"));

  assertCoordinatorError(
    () => buildClaudeArgs({ model: "opus", fallbackModel: "sonnet", permissionMode: "bypassPermissions", maxTurns: null, allowedTools: null }),
    "FORBIDDEN_PERMISSION_MODE",
  );
});

test("scripted runs get a reduced retry count without clobbering an explicit one", () => {
  const fresh = buildClaudeEnv({ PATH: "/usr/bin" });
  assert.equal(fresh.CLAUDE_CODE_MAX_RETRIES, "3");
  assert.equal(fresh.PATH, "/usr/bin", "the rest of the environment is passed through");

  assert.equal(buildClaudeEnv({ CLAUDE_CODE_MAX_RETRIES: "7" }).CLAUDE_CODE_MAX_RETRIES, "7");
  assert.equal(buildClaudeEnv({ CLAUDE_CODE_MAX_RETRIES: "  " }).CLAUDE_CODE_MAX_RETRIES, "3", "blank values are treated as unset");

  const source = { CLAUDE_CODE_MAX_RETRIES: undefined };
  buildClaudeEnv(source);
  assert.equal(source.CLAUDE_CODE_MAX_RETRIES, undefined, "the caller's environment object is not mutated");
});

test("parseCliArgs accepts both --flag value and --flag=value forms", () => {
  const spaced = parseCliArgs(["run", "--prompt-file", "task.md", "--model", "opus", "--dry-run"]);
  assert.equal(spaced.command, "run");
  assert.equal(spaced.options.promptFile, "task.md");
  assert.equal(spaced.options.model, "opus");
  assert.equal(spaced.options.dryRun, true);

  const inline = parseCliArgs(["run", "--prompt-file=task.md", "--timeout-minutes=5"]);
  assert.equal(inline.options.promptFile, "task.md");
  assert.equal(inline.options.timeoutMinutes, "5");

  const cleanup = parseCliArgs(["cleanup", "run-123", "--force"]);
  assert.deepEqual(cleanup.positionals, ["run-123"]);
  assert.equal(cleanup.options.force, true);
});

test("malformed arguments fail clearly instead of being guessed at", () => {
  assertCoordinatorError(() => parseCliArgs([]), "MISSING_COMMAND");
  assertCoordinatorError(() => parseCliArgs(["deploy"]), "UNKNOWN_COMMAND");
  assertCoordinatorError(() => parseCliArgs(["run", "--nope", "1"]), "UNKNOWN_FLAG");
  assertCoordinatorError(() => parseCliArgs(["run", "--prompt-file"]), "MISSING_FLAG_VALUE");
  assertCoordinatorError(() => parseCliArgs(["run", "--prompt-file", "--model"]), "MISSING_FLAG_VALUE");
  assertCoordinatorError(() => parseCliArgs(["run", "--prompt-file="]), "MISSING_FLAG_VALUE");
  assertCoordinatorError(() => parseCliArgs(["run", "--dry-run=yes"]), "BAD_FLAG_VALUE");
  assertCoordinatorError(() => parseCliArgs(["list", "extra"]), "UNEXPECTED_ARGUMENT");
  assertCoordinatorError(() => parseCliArgs(["cleanup", "a", "b"]), "UNEXPECTED_ARGUMENT");
  // --force belongs to cleanup, not run.
  assertCoordinatorError(() => parseCliArgs(["run", "--force"]), "UNKNOWN_FLAG");
});

test("resolveRunOptions rejects bad paths, bad numbers and unsafe argument values", () => {
  assertCoordinatorError(() => resolveRunOptions({}, { cwd: process.cwd() }), "MISSING_PROMPT_FILE");
  assertCoordinatorError(
    () => resolveRunOptions({ promptFile: path.join(os.tmpdir(), "definitely-missing-prompt-file.md") }, { cwd: process.cwd() }),
    "PROMPT_FILE_NOT_FOUND",
  );
  assertCoordinatorError(() => resolveRunOptions({ promptFile: os.tmpdir() }, { cwd: process.cwd() }), "PROMPT_FILE_NOT_FILE");

  withTempPromptFile("   \n", (file) => {
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file }, { cwd: process.cwd() }), "EMPTY_PROMPT");
  });

  withTempPromptFile("do the thing", (file) => {
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, pollMs: "fast" }), "BAD_NUMBER");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, pollMs: "10" }), "BAD_NUMBER");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, maxTurns: "1.5" }), "BAD_NUMBER");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, timeoutMinutes: "-3" }), "BAD_NUMBER");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, maxBudgetUsd: "0" }), "BAD_NUMBER");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, permissionMode: "bypassPermissions" }), "BAD_PERMISSION_MODE");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, permissionMode: "yolo" }), "BAD_PERMISSION_MODE");
    // The installed CLI has no `default` mode; only acceptEdits and plan are exposed.
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, permissionMode: "default" }), "BAD_PERMISSION_MODE");
    // Shell metacharacters can never reach an argv value, even though we never build a shell string.
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, model: "opus; rm -rf /" }), "UNSAFE_ARGUMENT");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, fallbackModel: "sonnet`whoami`" }), "UNSAFE_ARGUMENT");
    assertCoordinatorError(() => resolveRunOptions({ promptFile: file, allowedTools: "Bash & calc.exe" }), "UNSAFE_ARGUMENT");
  });
});

test("resolveRunOptions applies the documented defaults", () => {
  withTempPromptFile("do the thing", (file) => {
    const resolved = resolveRunOptions({ promptFile: file }, { cwd: process.cwd() });
    assert.equal(resolved.model, "opus");
    assert.equal(resolved.fallbackModel, "sonnet");
    assert.equal(resolved.baseRef, "HEAD");
    assert.equal(resolved.permissionMode, "acceptEdits");
    assert.equal(resolved.pollMs, 5_000);
    assert.equal(resolved.timeoutMinutes, 120);
    assert.equal(resolved.maxTurns, null);
    assert.equal(resolved.maxBudgetUsd, null);
    assert.equal(resolved.allowedTools, null);
    assert.equal(resolved.dryRun, false);
    assert.equal(resolved.userPrompt.trim(), "do the thing");
  });
});

test("the injected fake Claude binary is used as an argv command, not a shell string", () => {
  const injected = fileURLToPath(new URL("./helpers/fake-claude.mjs", import.meta.url));
  const resolved = resolveClaudeCommand({ platform: "linux", env: { [CLAUDE_BIN_ENV]: injected } });
  assert.equal(resolved.kind, "node-script");
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.prefixArgs, [path.resolve(injected)]);

  assertCoordinatorError(
    () => resolveClaudeCommand({ platform: "linux", env: { [CLAUDE_BIN_ENV]: path.join(os.tmpdir(), "no-such-claude-binary") } }),
    "CLAUDE_BIN_NOT_FOUND",
  );
  // A .cmd/.bat wrapper would need a shell, which is exactly what we refuse to open.
  assertCoordinatorError(
    () => resolveClaudeCommand({ platform: "win32", env: { [CLAUDE_BIN_ENV]: "C:/npm/claude.cmd" }, fileExists: () => true }),
    "CLAUDE_BIN_UNSUPPORTED",
  );
});

test("Windows resolution prefers claude.exe or claude.ps1 driven by PowerShell -File", () => {
  const appData = "C:\\Users\\dev\\AppData\\Roaming";

  const exe = resolveClaudeCommand({
    platform: "win32",
    env: { APPDATA: appData, PATH: "" },
    fileExists: () => true,
  });
  assert.equal(exe.kind, "direct", "a native claude.exe needs no PowerShell wrapper");
  assert.equal(exe.command, path.join(appData, "npm", "claude.exe"));

  // With only the npm-installed claude.ps1 present, we drive it through PowerShell -File.
  const discoveredPs1 = resolveClaudeCommand({
    platform: "win32",
    env: { APPDATA: appData, PATH: "" },
    fileExists: (candidate) => candidate.endsWith("claude.ps1"),
  });
  assert.equal(discoveredPs1.kind, "powershell");
  assert.equal(discoveredPs1.target, path.join(appData, "npm", "claude.ps1"));

  const injectedPs1 = resolveClaudeCommand({
    platform: "win32",
    env: { [CLAUDE_BIN_ENV]: "C:/npm/claude.ps1" },
    fileExists: () => true,
  });
  assert.equal(injectedPs1.kind, "powershell");
  assert.equal(injectedPs1.command, "powershell.exe");
  assert.deepEqual(injectedPs1.prefixArgs.slice(0, 5), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
  assert.equal(injectedPs1.prefixArgs.at(-1), path.resolve("C:/npm/claude.ps1"));
  assert.ok(injectedPs1.prefixArgs.every((arg) => typeof arg === "string"), "arguments stay a real array, never a concatenated string");

  assertCoordinatorError(
    () => resolveClaudeCommand({ platform: "win32", env: { APPDATA: "", PATH: "" }, fileExists: () => false }),
    "CLAUDE_CLI_NOT_FOUND",
  );

  assert.equal(resolveClaudeCommand({ platform: "darwin", env: {} }).command, "claude", "non-Windows behavior stays portable");
});

test("the composed prompt grounds the run in its baseline and forbids delivery actions", () => {
  const prompt = composePrompt({
    userPrompt: "Add a widget.",
    repoName: "cvlon-site",
    baselineCommit: "6f5683038091bad93da9c4d6ae7e81576cf4dd95",
    baseRef: "HEAD",
    branch: "claude/run-1",
    worktree: "/tmp/wt",
    runId: "run-1",
  });

  assert.match(prompt, /6f5683038091bad93da9c4d6ae7e81576cf4dd95/);
  assert.match(prompt, /claude\/run-1/);
  assert.match(prompt, /git push/);
  assert.match(prompt, /git merge/);
  assert.match(prompt, /amend/);
  assert.match(prompt, /Stop-and-report conditions/);
  assert.match(prompt, /Preserve historical behavior/);
  assert.match(prompt, /independent[\s\S]{0,40}Codex review/i);
  assert.ok(prompt.trimEnd().endsWith("Add a widget."), "the operator prompt is last so it is not truncated by the preamble");
});

test("run IDs are unique, sanitized, and safe to use as a branch or directory name", () => {
  assert.equal(sanitizeRunName("Add Widget!!"), "add-widget");
  assert.equal(sanitizeRunName("../../escape"), "escape");
  assert.equal(sanitizeRunName(""), "run");
  assert.equal(sanitizeRunName("   "), "run");

  const id = buildRunId("Add Widget!!", { date: new Date("2026-08-18T12:34:56.000Z"), suffix: "abc123" });
  assert.equal(id, "20260818T123456Z-add-widget-abc123");
  assert.match(id, /^[A-Za-z0-9-]+$/);
  assert.notEqual(buildRunId("x"), buildRunId("x"), "two runs never collide");
});

test("only coordinator-shaped run IDs are accepted; traversal and path forms are rejected", () => {
  const generated = buildRunId("widget");
  assert.equal(assertValidRunId(generated), generated, "every coordinator-generated ID passes its own validator");
  assert.equal(assertValidRunId("20260818T123456Z-add-widget-abc123"), "20260818T123456Z-add-widget-abc123");

  for (const bad of [
    "..",
    "../sibling",
    "..\\sibling",
    "runs/../../escape",
    "a/b",
    "a\\b",
    "/etc/passwd",
    "C:\\Windows",
    "run.id",
    "run id",
    "",
    ".",
    "run\u0000id",
  ]) {
    assertCoordinatorError(() => assertValidRunId(bad), "INVALID_RUN_ID");
  }
  assertCoordinatorError(() => assertValidRunId(null), "INVALID_RUN_ID");
  assertCoordinatorError(() => assertValidRunId(undefined), "INVALID_RUN_ID");
});

test("the exposed permission modes are exactly the conservative pair", () => {
  assert.deepEqual(ALLOWED_PERMISSION_MODES, ["acceptEdits", "plan"]);
  assert.ok(!ALLOWED_PERMISSION_MODES.includes("default"), "the installed CLI does not accept `default`");
  assert.ok(!ALLOWED_PERMISSION_MODES.includes("bypassPermissions"));
});

test("stream JSON is interpreted into claims without being treated as proof", () => {
  const observer = new ClaudeStreamObserver();
  observer.ingestLine(JSON.stringify({ type: "system", subtype: "init", session_id: "sess-9", model: "claude-opus-4" }));
  observer.ingestLine(JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-4" } }));
  observer.ingestLine("not json at all");
  observer.ingestLine("   ");
  observer.ingestLine(JSON.stringify({ type: "result", subtype: "success", is_error: false, num_turns: 4, total_cost_usd: 1.25, duration_ms: 900, result: "done" }));

  const snapshot = observer.snapshot();
  assert.equal(snapshot.sessionId, "sess-9");
  assert.deepEqual(snapshot.modelsObserved, ["claude-opus-4", "claude-sonnet-4"]);
  assert.equal(snapshot.turns, 4);
  assert.equal(snapshot.costUsd, 1.25);
  assert.equal(snapshot.durationMs, 900);
  assert.equal(snapshot.resultSubtype, "success");
  assert.equal(snapshot.resultIsError, false);
  assert.equal(snapshot.resultText, "done");
  assert.equal(snapshot.streamParseErrors, 1);
  assert.equal(snapshot.streamEvents, 3, "blank and unparseable lines are not counted as events");
});

test("the line splitter reassembles JSON objects split across chunk boundaries", () => {
  const lines = [];
  const splitter = createLineSplitter((line) => lines.push(line));
  splitter.push('{"type":"sys');
  splitter.push('tem"}\n{"type":"result"');
  splitter.push('}\n{"type":"tail"}');
  assert.deepEqual(lines, ['{"type":"system"}', '{"type":"result"}']);
  splitter.flush();
  assert.deepEqual(lines.at(-1), '{"type":"tail"}', "the partial tail is flushed once the stream closes");
});
