#!/usr/bin/env node
/**
 * Civilon direct Claude CLI coordinator.
 *
 * Dispatches Claude Code non-interactively into an isolated Git worktree, with Opus as the
 * primary model and Sonnet as the automatic overload fallback, and records observable
 * evidence of what actually happened on disk.
 *
 * Design rules enforced here:
 *  - Node built-ins only; no dependency additions.
 *  - No shell string interpolation anywhere: every child process is spawned with an argv array.
 *  - Never `--dangerously-skip-permissions`, never `bypassPermissions`.
 *  - Never push, merge, amend or rebase; the coordinator only creates and inspects a worktree.
 *  - A clean Claude exit is recorded as `completed_unverified`, never as accepted delivery.
 */

import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

export const COORDINATOR_DIR = ".claude-coordinator";
export const DEFAULT_MODEL = "opus";
export const DEFAULT_FALLBACK_MODEL = "sonnet";
export const DEFAULT_PERMISSION_MODE = "acceptEdits";
export const DEFAULT_POLL_MS = 5_000;
export const DEFAULT_TIMEOUT_MINUTES = 120;
export const DEFAULT_MAX_RETRIES = "3";
export const HEARTBEAT_CADENCE_MS = 60_000;

/**
 * Permission modes we are willing to hand to the Claude CLI. The installed CLI also accepts
 * `auto`, `manual`, and `dontAsk`, but the coordinator only exposes the two deliberately
 * conservative ones; `bypassPermissions` is never permitted, and `default` is not a mode the
 * installed CLI accepts at all.
 */
export const ALLOWED_PERMISSION_MODES = ["acceptEdits", "plan"];

/** Terminal run statuses. `completed_unverified` is intentionally not called "succeeded". */
export const TERMINAL_STATUSES = ["completed_unverified", "failed", "timed_out", "budget_exceeded", "spawn_error", "cleaned"];

export class CoordinatorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoordinatorError";
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* Argument parsing                                                            */
/* -------------------------------------------------------------------------- */

const COMMANDS = new Set(["run", "status", "list", "cleanup", "help"]);

const RUN_VALUE_FLAGS = new Map(Object.entries({
  "--prompt-file": "promptFile",
  "--repo": "repo",
  "--base": "base",
  "--name": "name",
  "--model": "model",
  "--fallback-model": "fallbackModel",
  "--poll-ms": "pollMs",
  "--timeout-minutes": "timeoutMinutes",
  "--max-turns": "maxTurns",
  "--max-budget-usd": "maxBudgetUsd",
  "--permission-mode": "permissionMode",
  "--allowed-tools": "allowedTools",
}));
const RUN_BOOLEAN_FLAGS = new Map([["--dry-run", "dryRun"]]);

const INSPECT_VALUE_FLAGS = new Map([["--repo", "repo"]]);
const INSPECT_BOOLEAN_FLAGS = new Map([["--json", "json"]]);

const CLEANUP_VALUE_FLAGS = new Map([["--repo", "repo"]]);
const CLEANUP_BOOLEAN_FLAGS = new Map([["--force", "force"], ["--json", "json"]]);

function flagTables(command) {
  if (command === "run") return { values: RUN_VALUE_FLAGS, booleans: RUN_BOOLEAN_FLAGS, positionals: 0 };
  if (command === "status") return { values: INSPECT_VALUE_FLAGS, booleans: INSPECT_BOOLEAN_FLAGS, positionals: 1 };
  if (command === "list") return { values: INSPECT_VALUE_FLAGS, booleans: INSPECT_BOOLEAN_FLAGS, positionals: 0 };
  if (command === "cleanup") return { values: CLEANUP_VALUE_FLAGS, booleans: CLEANUP_BOOLEAN_FLAGS, positionals: 1 };
  return { values: new Map(), booleans: new Map(), positionals: 0 };
}

/**
 * Parses `argv` (without node/script) into `{ command, options, positionals }`.
 * Throws `CoordinatorError` on anything malformed rather than guessing.
 */
export function parseCliArgs(argv) {
  const list = [...argv];
  const command = list.shift();
  if (!command) throw new CoordinatorError("MISSING_COMMAND", "A command is required. Expected one of: run, status, list, cleanup, help.");
  if (!COMMANDS.has(command)) throw new CoordinatorError("UNKNOWN_COMMAND", `Unknown command "${command}". Expected one of: run, status, list, cleanup, help.`);

  const { values, booleans, positionals: expectedPositionals } = flagTables(command);
  const options = {};
  const positionals = [];

  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === "--") {
      positionals.push(...list.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? null : token.slice(eq + 1);

    if (booleans.has(name)) {
      if (inlineValue !== null) throw new CoordinatorError("BAD_FLAG_VALUE", `Flag ${name} does not take a value.`);
      options[booleans.get(name)] = true;
      continue;
    }
    if (values.has(name)) {
      let value = inlineValue;
      if (value === null) {
        value = list[index + 1];
        index += 1;
        if (value === undefined || value.startsWith("--")) {
          throw new CoordinatorError("MISSING_FLAG_VALUE", `Flag ${name} requires a value.`);
        }
      }
      if (value === "") throw new CoordinatorError("MISSING_FLAG_VALUE", `Flag ${name} requires a non-empty value.`);
      options[values.get(name)] = value;
      continue;
    }
    throw new CoordinatorError("UNKNOWN_FLAG", `Unknown flag "${name}" for command "${command}".`);
  }

  if (positionals.length > expectedPositionals) {
    throw new CoordinatorError("UNEXPECTED_ARGUMENT", `Command "${command}" accepts ${expectedPositionals} positional argument(s), received ${positionals.length}.`);
  }
  return { command, options, positionals };
}

function parseNumber(raw, label, { integer = false, min, max } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CoordinatorError("BAD_NUMBER", `${label} must be a finite number, received "${raw}".`);
  if (integer && !Number.isInteger(value)) throw new CoordinatorError("BAD_NUMBER", `${label} must be an integer, received "${raw}".`);
  if (min !== undefined && value < min) throw new CoordinatorError("BAD_NUMBER", `${label} must be >= ${min}, received "${raw}".`);
  if (max !== undefined && value > max) throw new CoordinatorError("BAD_NUMBER", `${label} must be <= ${max}, received "${raw}".`);
  return value;
}

/**
 * Values that end up on a child process argv are restricted to a conservative character set.
 * This is defence in depth: we never build a shell string, but PowerShell's own re-parsing of
 * an argv on Windows is easier to reason about when values cannot contain quoting metacharacters.
 */
const SAFE_TOKEN = /^[A-Za-z0-9._:@/\\+*(),[\]-]+$/;

function assertSafeToken(value, label) {
  if (!SAFE_TOKEN.test(value)) {
    throw new CoordinatorError("UNSAFE_ARGUMENT", `${label} contains characters that are not allowed on a CLI argument: "${value}". Allowed: letters, digits and ._:@/\\+*(),[]- .`);
  }
  return value;
}

export function sanitizeRunName(raw) {
  const slug = String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || "run";
}

function timestampSlug(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export function buildRunId(name, { date = new Date(), suffix = randomBytes(3).toString("hex") } = {}) {
  return `${timestampSlug(date)}-${sanitizeRunName(name)}-${suffix}`;
}

/**
 * The exact shape a coordinator-generated run ID can take: letters, digits and hyphens only.
 * This is deliberately stricter than "no `..`" — it also rejects `.`, `/`, `\`, and every other
 * character that could turn a run ID into a path escape once it is joined onto `runsRoot(repo)`.
 */
const RUN_ID_PATTERN = /^[A-Za-z0-9-]+$/;

/** Rejects anything that is not a coordinator-shaped run ID before it ever reaches a path.join. */
export function assertValidRunId(runId) {
  if (typeof runId !== "string" || runId.length === 0 || !RUN_ID_PATTERN.test(runId)) {
    throw new CoordinatorError("INVALID_RUN_ID", `"${runId}" is not a valid run ID; expected only letters, digits and hyphens.`);
  }
  return runId;
}

/* -------------------------------------------------------------------------- */
/* Git helpers (argv only, never a shell)                                      */
/* -------------------------------------------------------------------------- */

export function git(args, { cwd, allowFailure = false } = {}) {
  try {
    const stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    return { ok: true, stdout: stdout.trimEnd(), stderr: "" };
  } catch (error) {
    const stderr = String(error?.stderr ?? error?.message ?? "").trim();
    if (allowFailure) return { ok: false, stdout: String(error?.stdout ?? "").trimEnd(), stderr };
    throw new CoordinatorError("GIT_FAILED", `git ${args.join(" ")} failed: ${stderr}`);
  }
}

function assertGitRepo(repo) {
  if (!existsSync(repo)) throw new CoordinatorError("REPO_NOT_FOUND", `Repository path does not exist: ${repo}`);
  const result = git(["rev-parse", "--show-toplevel"], { cwd: repo, allowFailure: true });
  if (!result.ok) throw new CoordinatorError("NOT_A_GIT_REPO", `Not a Git repository: ${repo}`);
  return path.resolve(result.stdout);
}

/** Porcelain status of a working tree, as structured evidence. */
export function readGitStatus(cwd) {
  const result = git(["status", "--porcelain=v1", "--untracked-files=all"], { cwd, allowFailure: true });
  if (!result.ok) return { available: false, dirtyCount: 0, dirtyFiles: [], truncated: false };
  const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const files = lines.map((line) => line.slice(line.indexOf(" ") + 1).trim());
  return {
    available: true,
    dirtyCount: files.length,
    dirtyFiles: files.slice(0, 50),
    truncated: files.length > 50,
  };
}

export function readGitHead(cwd) {
  const result = git(["rev-parse", "HEAD"], { cwd, allowFailure: true });
  return result.ok ? result.stdout : null;
}

/* -------------------------------------------------------------------------- */
/* Claude CLI resolution                                                       */
/* -------------------------------------------------------------------------- */

/** Test/dev injection point: an absolute path to a fake or alternate Claude executable. */
export const CLAUDE_BIN_ENV = "CLAUDE_COORDINATOR_CLAUDE_BIN";

const POWERSHELL_PREFIX = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];

function pathCandidates(env) {
  const raw = env.PATH ?? env.Path ?? "";
  return raw.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Resolves how to launch the Claude CLI as an argv array.
 *
 * The injected binary is used verbatim as `command` (never concatenated into a string), so a
 * fake Claude can be supplied in tests without opening a shell-injection path. `.mjs`/`.js`
 * injections are run with the current Node binary so tests do not need an executable bit.
 */
export function resolveClaudeCommand({ platform = process.platform, env = process.env, fileExists = existsSync } = {}) {
  const injected = env[CLAUDE_BIN_ENV]?.trim();
  if (injected) {
    const resolved = path.resolve(injected);
    if (!fileExists(resolved)) {
      throw new CoordinatorError("CLAUDE_BIN_NOT_FOUND", `${CLAUDE_BIN_ENV} points at a path that does not exist: ${resolved}`);
    }
    if (/\.(mjs|cjs|js)$/i.test(resolved)) {
      return { kind: "node-script", command: process.execPath, prefixArgs: [resolved], target: resolved };
    }
    if (/\.ps1$/i.test(resolved)) {
      return { kind: "powershell", command: "powershell.exe", prefixArgs: [...POWERSHELL_PREFIX, resolved], target: resolved };
    }
    if (/\.(cmd|bat)$/i.test(resolved)) {
      throw new CoordinatorError("CLAUDE_BIN_UNSUPPORTED", `Refusing to launch a .cmd/.bat wrapper (${resolved}); those require a shell. Point ${CLAUDE_BIN_ENV} at claude.ps1, claude.exe, or a .mjs script instead.`);
    }
    return { kind: "direct", command: resolved, prefixArgs: [], target: resolved };
  }

  if (platform !== "win32") {
    return { kind: "direct", command: "claude", prefixArgs: [], target: "claude" };
  }

  // On Windows npm installs claude.ps1 / claude.cmd / claude.exe next to each other. We prefer
  // the PowerShell script driven by `-File` (argv passthrough, no shell string) and accept a
  // native .exe, but never the .cmd wrapper.
  const dirs = [path.join(env.APPDATA ?? "", "npm"), ...pathCandidates(env)];
  for (const dir of dirs) {
    if (!dir) continue;
    const exe = path.join(dir, "claude.exe");
    if (fileExists(exe)) return { kind: "direct", command: exe, prefixArgs: [], target: exe };
    const ps1 = path.join(dir, "claude.ps1");
    if (fileExists(ps1)) return { kind: "powershell", command: "powershell.exe", prefixArgs: [...POWERSHELL_PREFIX, ps1], target: ps1 };
  }
  throw new CoordinatorError("CLAUDE_CLI_NOT_FOUND", `Could not find claude.exe or claude.ps1 on PATH or in %APPDATA%\\npm. Install the Claude Code CLI, or set ${CLAUDE_BIN_ENV} to its absolute path.`);
}

/* -------------------------------------------------------------------------- */
/* Invocation construction                                                     */
/* -------------------------------------------------------------------------- */

const FORBIDDEN_CLI_FLAGS = ["--dangerously-skip-permissions", "--dangerously-skip-permission-checks"];

/**
 * Builds the Claude CLI argv for a run. The prompt is deliberately NOT included: it is written
 * to the child's stdin so it never appears on a command line or in a process listing.
 */
export function buildClaudeArgs(config) {
  const args = [
    "--print",
    "--model", config.model,
    "--fallback-model", config.fallbackModel,
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", config.permissionMode,
  ];
  if (config.maxTurns !== undefined && config.maxTurns !== null) args.push("--max-turns", String(config.maxTurns));
  if (config.maxBudgetUsd !== undefined && config.maxBudgetUsd !== null) args.push("--max-budget-usd", String(config.maxBudgetUsd));
  if (config.allowedTools) args.push("--allowed-tools", config.allowedTools);

  for (const flag of args) {
    if (FORBIDDEN_CLI_FLAGS.includes(flag)) {
      throw new CoordinatorError("FORBIDDEN_FLAG", `Refusing to build an invocation containing ${flag}.`);
    }
  }
  if (config.permissionMode === "bypassPermissions") {
    throw new CoordinatorError("FORBIDDEN_PERMISSION_MODE", "Refusing to run with permission mode bypassPermissions.");
  }
  return args;
}

/** Environment for the child. Scripted runs retry less than interactive ones. */
export function buildClaudeEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  if (!env.CLAUDE_CODE_MAX_RETRIES || !String(env.CLAUDE_CODE_MAX_RETRIES).trim()) {
    env.CLAUDE_CODE_MAX_RETRIES = DEFAULT_MAX_RETRIES;
  }
  return env;
}

/* -------------------------------------------------------------------------- */
/* Prompt composition                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Wraps the operator's prompt in a repository-grounded instruction block so the delegated
 * Claude run knows its exact baseline, its isolation boundary, and what it must report.
 */
export function composePrompt({ userPrompt, repoName, baselineCommit, baseRef, branch, worktree, runId }) {
  return [
    "# Delegated Civilon engineering task",
    "",
    "You were dispatched by the Civilon Claude coordinator on behalf of Codex. Everything below the",
    "`## Task` heading is the operator's request. Everything above it is a hard constraint.",
    "",
    "## Repository baseline",
    "",
    `- Repository: \`${repoName}\``,
    `- Exact baseline commit: \`${baselineCommit}\` (resolved from \`${baseRef}\`)`,
    `- Your branch: \`${branch}\``,
    `- Your isolated worktree: \`${worktree}\``,
    `- Coordinator run ID: \`${runId}\``,
    "",
    "Verify the baseline before you change anything (`git rev-parse HEAD`). If HEAD does not match",
    "the commit above, stop and report instead of guessing.",
    "",
    "## Isolation rules",
    "",
    "- Work only inside your own worktree. Never modify, stage, or clean any other worktree or clone.",
    "- Never run `git push`, `git merge`, `git rebase`, `git commit --amend`, `git reset --hard` onto",
    "  someone else's work, or any GitHub PR/merge operation. Delivery is Codex's decision, not yours.",
    "- Never force-delete branches you did not create.",
    "- Do not add, upgrade, or remove dependencies unless the task explicitly asks for it.",
    "",
    "## Preserve historical behavior",
    "",
    "- Keep existing behavior, public interfaces, data shapes, and migrations intact unless the task",
    "  explicitly requires a change. If a change is unavoidable, call it out in your report.",
    "- Match the surrounding code's conventions instead of introducing new ones.",
    "",
    "## Proof and reporting requirements",
    "",
    "Your final message must be a report containing:",
    "",
    "1. The exact baseline commit you started from and the HEAD you ended on.",
    "2. Every file you changed, added, or deleted.",
    "3. A short architecture/approach summary.",
    "4. Every command you ran that matters, with its exit code and the relevant output.",
    "5. Known limitations, risks, and anything you could not verify.",
    "6. Whether you committed, and the commit subjects if so.",
    "",
    "State clearly what you actually verified versus what you believe. Do not describe your own",
    "output, a green test run, or a clean exit as proof that the task is accepted: an independent",
    "Codex review happens after you finish and is the only thing that accepts work.",
    "",
    "## Stop-and-report conditions",
    "",
    "Stop and report immediately, without forcing a workaround, if:",
    "",
    "- The baseline commit does not match.",
    "- Your worktree is unexpectedly dirty or contains work you did not create.",
    "- The task would require dependency changes, production configuration, credentials, or a",
    "  destructive/irreversible operation.",
    "- You cannot prove the change is correct with the tools available.",
    "",
    "## Task",
    "",
    userPrompt.trim(),
    "",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Run option resolution                                                       */
/* -------------------------------------------------------------------------- */

export function resolveRunOptions(options, { cwd = process.cwd() } = {}) {
  if (!options.promptFile) throw new CoordinatorError("MISSING_PROMPT_FILE", "run requires --prompt-file <path>.");
  const promptFile = path.resolve(cwd, options.promptFile);
  if (!existsSync(promptFile)) throw new CoordinatorError("PROMPT_FILE_NOT_FOUND", `Prompt file does not exist: ${promptFile}`);
  if (!statSync(promptFile).isFile()) throw new CoordinatorError("PROMPT_FILE_NOT_FILE", `Prompt file is not a regular file: ${promptFile}`);
  const userPrompt = readFileSync(promptFile, "utf8");
  if (!userPrompt.trim()) throw new CoordinatorError("EMPTY_PROMPT", `Prompt file is empty: ${promptFile}`);

  const repo = path.resolve(cwd, options.repo ?? cwd);
  const model = assertSafeToken(options.model ?? DEFAULT_MODEL, "--model");
  const fallbackModel = assertSafeToken(options.fallbackModel ?? DEFAULT_FALLBACK_MODEL, "--fallback-model");
  const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE;
  if (!ALLOWED_PERMISSION_MODES.includes(permissionMode)) {
    throw new CoordinatorError("BAD_PERMISSION_MODE", `--permission-mode must be one of ${ALLOWED_PERMISSION_MODES.join(", ")}. "${permissionMode}" is not allowed (bypassPermissions is never permitted).`);
  }
  const allowedTools = options.allowedTools ? assertSafeToken(options.allowedTools, "--allowed-tools") : null;

  return {
    repo,
    promptFile,
    userPrompt,
    baseRef: options.base ?? "HEAD",
    name: sanitizeRunName(options.name ?? "run"),
    model,
    fallbackModel,
    permissionMode,
    allowedTools,
    pollMs: options.pollMs === undefined ? DEFAULT_POLL_MS : parseNumber(options.pollMs, "--poll-ms", { integer: true, min: 250, max: 600_000 }),
    timeoutMinutes: options.timeoutMinutes === undefined ? DEFAULT_TIMEOUT_MINUTES : parseNumber(options.timeoutMinutes, "--timeout-minutes", { min: 0.01, max: 1440 }),
    maxTurns: options.maxTurns === undefined ? null : parseNumber(options.maxTurns, "--max-turns", { integer: true, min: 1, max: 10_000 }),
    maxBudgetUsd: options.maxBudgetUsd === undefined ? null : parseNumber(options.maxBudgetUsd, "--max-budget-usd", { min: 0.01, max: 10_000 }),
    dryRun: options.dryRun === true,
  };
}

/* -------------------------------------------------------------------------- */
/* State persistence                                                           */
/* -------------------------------------------------------------------------- */

export function runsRoot(repo) {
  return path.join(repo, COORDINATOR_DIR, "runs");
}

export function runDir(repo, runId) {
  assertValidRunId(runId);
  return path.join(runsRoot(repo), runId);
}

/** The exact sibling worktree path the coordinator derives for a given repo + run ID. */
export function deriveWorktreePath(repo, runId) {
  assertValidRunId(runId);
  return path.join(path.dirname(repo), `${path.basename(repo)}-claude-${runId}`);
}

/**
 * Creates the run directory. The coordinator root is made self-ignoring so a run never shows up
 * as untracked noise in the source repository, independent of the repo's own .gitignore.
 */
export function ensureRunDir(repo, runId) {
  const root = path.join(repo, COORDINATOR_DIR);
  const dir = runDir(repo, runId);
  mkdirSync(dir, { recursive: true });
  const ignoreFile = path.join(root, ".gitignore");
  if (!existsSync(ignoreFile)) {
    writeFileSync(ignoreFile, "# Coordinator run state is local-only; never commit it.\n*\n", "utf8");
  }
  return dir;
}

/** Atomic-enough state write: full document to a temp file, then rename over the target. */
export function writeStateAtomic(dir, state) {
  const target = path.join(dir, "state.json");
  const temp = path.join(dir, `state.json.${process.pid}.tmp`);
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temp, target);
  return target;
}

export function readState(repo, runId) {
  const file = path.join(runDir(repo, runId), "state.json");
  if (!existsSync(file)) throw new CoordinatorError("RUN_NOT_FOUND", `No coordinator run "${runId}" under ${runsRoot(repo)}.`);
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("expected a JSON object");
    }
    return state;
  } catch (error) {
    throw new CoordinatorError("STATE_UNREADABLE", `state.json for run "${runId}" is not valid JSON: ${error.message}`);
  }
}

export function listRuns(repo) {
  const root = runsRoot(repo);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readState(repo, entry.name);
      } catch {
        return { runId: entry.name, status: "unreadable" };
      }
    })
    .sort((a, b) => String(a.runId).localeCompare(String(b.runId)));
}

/* -------------------------------------------------------------------------- */
/* Stream JSON interpretation                                                  */
/* -------------------------------------------------------------------------- */

/** Accumulates the facts Claude *claims* from its stream-json output. Claims, not proof. */
export class ClaudeStreamObserver {
  constructor() {
    this.sessionId = null;
    this.modelsObserved = [];
    this.turns = null;
    this.costUsd = null;
    this.durationMs = null;
    this.resultText = null;
    this.resultSubtype = null;
    this.resultIsError = null;
    this.parseErrors = 0;
    this.events = 0;
  }

  noteModel(model) {
    if (typeof model === "string" && model && !this.modelsObserved.includes(model)) this.modelsObserved.push(model);
  }

  ingestLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      this.parseErrors += 1;
      return;
    }
    this.events += 1;
    if (typeof event.session_id === "string") this.sessionId = event.session_id;
    this.noteModel(event?.message?.model);
    this.noteModel(event?.model);
    if (event?.modelUsage && typeof event.modelUsage === "object") {
      for (const model of Object.keys(event.modelUsage)) this.noteModel(model);
    }
    if (event.type === "result") {
      this.resultSubtype = event.subtype ?? null;
      this.resultIsError = event.is_error === true;
      if (typeof event.total_cost_usd === "number") this.costUsd = event.total_cost_usd;
      if (typeof event.duration_ms === "number") this.durationMs = event.duration_ms;
      if (typeof event.num_turns === "number") this.turns = event.num_turns;
      if (typeof event.result === "string") this.resultText = event.result;
    }
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      modelsObserved: [...this.modelsObserved],
      turns: this.turns,
      costUsd: this.costUsd,
      durationMs: this.durationMs,
      resultSubtype: this.resultSubtype,
      resultIsError: this.resultIsError,
      resultText: this.resultText === null ? null : this.resultText.slice(0, 20_000),
      streamEvents: this.events,
      streamParseErrors: this.parseErrors,
    };
  }
}

/** Splits a byte stream into complete lines, buffering the partial tail. */
export function createLineSplitter(onLine) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        onLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    flush() {
      if (buffer) {
        onLine(buffer);
        buffer = "";
      }
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Process termination (no shell)                                              */
/* -------------------------------------------------------------------------- */

function terminateProcessTree(child, log) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      return;
    } catch (error) {
      log(`taskkill failed (${error.message}); falling back to signal.`);
    }
  }
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 5_000).unref();
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

function fenced(title, body) {
  return [`### ${title}`, "", "```", body && body.trim() ? body.trimEnd() : "(none)", "```", ""].join("\n");
}

export function renderReport(state, evidence) {
  const claims = state.claude ?? {};
  return [
    `# Claude coordinator run \`${state.runId}\``,
    "",
    `**Status:** \`${state.status}\` — this is a coordinator observation, not an acceptance decision.`,
    "",
    "> **Independent Codex review is still required.** Nothing in this report accepts the work.",
    "> A clean exit code, a green test run, a commit, and Claude's own summary are all *claims*.",
    "> Only the Git evidence section below was gathered independently by the coordinator.",
    "",
    "## Run metadata",
    "",
    `- Repository: \`${state.repo}\``,
    `- Baseline commit: \`${state.baselineCommit}\` (from \`${state.baseRef}\`)`,
    `- Branch: \`${state.branch}\``,
    `- Worktree: \`${state.worktree}\` (kept for review; remove with \`cleanup ${state.runId}\`)`,
    `- Started: ${state.startedAt} · Ended: ${state.endedAt ?? "(unfinished)"}`,
    `- Requested model: \`${state.model}\` · Fallback: \`${state.fallbackModel}\``,
    `- Exit code: \`${state.exitCode ?? "n/a"}\` · Signal: \`${state.signal ?? "n/a"}\``,
    state.error ? `- Error: ${state.error}` : null,
    "",
    "## Independently verified Git evidence",
    "",
    "Collected by the coordinator with `git`, not reported by Claude.",
    "",
    `- Worktree HEAD: \`${evidence.head ?? "unknown"}\``,
    `- Commits on top of baseline: **${evidence.commitCount}**`,
    `- Uncommitted/untracked entries in worktree: **${evidence.status.dirtyCount}**`,
    `- Source repository HEAD unchanged: **${evidence.sourceHeadUnchanged ? "yes" : "NO — investigate"}**`,
    `- Source repository dirty entries: **${evidence.sourceStatus.dirtyCount}** (was ${state.sourceDirtyCountAtStart} at start)`,
    "",
    fenced("Commits since baseline", evidence.commitLog),
    fenced("Committed diff stat (baseline..HEAD)", evidence.diffStat),
    fenced("Uncommitted changes in worktree", evidence.statusText),
    "## Claude's own claims (unverified)",
    "",
    `- Session ID: \`${claims.sessionId ?? "unknown"}\``,
    `- Models observed in stream: ${claims.modelsObserved?.length ? claims.modelsObserved.map((m) => `\`${m}\``).join(", ") : "(none observed)"}`,
    `- Turns: ${claims.turns ?? "unknown"} · Cost: ${claims.costUsd === null || claims.costUsd === undefined ? "unknown" : `$${claims.costUsd}`} · Duration: ${claims.durationMs ?? "unknown"} ms`,
    `- Result subtype: \`${claims.resultSubtype ?? "unknown"}\` · Reported error: \`${claims.resultIsError ?? "unknown"}\``,
    `- Stream events: ${claims.streamEvents ?? 0} (parse failures: ${claims.streamParseErrors ?? 0})`,
    "",
    fenced("Final message from Claude (claim, not proof)", claims.resultText ?? ""),
    "## Raw artifacts",
    "",
    "- `state.json` — machine-readable run state",
    "- `stream.jsonl` — raw stream-json output as emitted",
    "- `stderr.log` — child stderr",
    "- `prompt.txt` — the exact composed prompt sent on stdin",
    "",
    "## Reviewer checklist",
    "",
    "1. Read the committed diff yourself; do not rely on the summary above.",
    "2. Re-run the relevant tests in the worktree and record the exit codes.",
    "3. Confirm no dependency, production configuration, or credential changes slipped in.",
    "4. Confirm the source repository and every other worktree are untouched.",
    "5. Only then decide whether to merge; the coordinator never pushes or merges.",
    "",
  ].filter((line) => line !== null).join("\n");
}

function collectEvidence(state) {
  const worktreeExists = existsSync(state.worktree);
  const status = worktreeExists ? readGitStatus(state.worktree) : { available: false, dirtyCount: 0, dirtyFiles: [], truncated: false };
  const head = worktreeExists ? readGitHead(state.worktree) : null;
  const range = `${state.baselineCommit}..HEAD`;
  const commitLog = worktreeExists ? git(["log", "--oneline", "--no-decorate", range], { cwd: state.worktree, allowFailure: true }).stdout : "";
  const diffStat = worktreeExists ? git(["diff", "--stat", range], { cwd: state.worktree, allowFailure: true }).stdout : "";
  const statusText = worktreeExists ? git(["status", "--short", "--untracked-files=all"], { cwd: state.worktree, allowFailure: true }).stdout : "";
  const sourceStatus = readGitStatus(state.repo);
  const sourceHead = readGitHead(state.repo);
  return {
    head,
    status,
    statusText,
    commitLog,
    commitCount: commitLog ? commitLog.split("\n").filter(Boolean).length : 0,
    diffStat,
    sourceStatus,
    sourceHead,
    sourceHeadUnchanged: sourceHead === state.sourceHeadAtStart,
  };
}

/* -------------------------------------------------------------------------- */
/* run                                                                         */
/* -------------------------------------------------------------------------- */

export async function commandRun(options, io) {
  const resolved = resolveRunOptions(options, { cwd: io.cwd });
  const repo = assertGitRepo(resolved.repo);

  const baselineResult = git(["rev-parse", "--verify", `${resolved.baseRef}^{commit}`], { cwd: repo, allowFailure: true });
  if (!baselineResult.ok) throw new CoordinatorError("BAD_BASE_REF", `Cannot resolve --base "${resolved.baseRef}" to a commit in ${repo}.`);
  const baselineCommit = baselineResult.stdout;

  const runId = buildRunId(resolved.name);
  const branch = `claude/${runId}`;
  const worktree = deriveWorktreePath(repo, runId);
  const dir = runDir(repo, runId);

  const claudeCommand = resolveClaudeCommand({ env: io.env });
  const claudeArgs = buildClaudeArgs(resolved);
  const argv = [...claudeCommand.prefixArgs, ...claudeArgs];
  const childEnv = buildClaudeEnv(io.env);
  const prompt = composePrompt({
    userPrompt: resolved.userPrompt,
    repoName: path.basename(repo),
    baselineCommit,
    baseRef: resolved.baseRef,
    branch,
    worktree,
    runId,
  });

  const invocation = {
    command: claudeCommand.command,
    kind: claudeCommand.kind,
    args: argv,
    cwd: worktree,
    promptDelivery: "stdin",
    promptBytes: Buffer.byteLength(prompt, "utf8"),
    envOverrides: { CLAUDE_CODE_MAX_RETRIES: childEnv.CLAUDE_CODE_MAX_RETRIES },
  };

  if (resolved.dryRun) {
    const plan = {
      dryRun: true,
      runId,
      repo,
      baseRef: resolved.baseRef,
      baselineCommit,
      branch,
      worktree,
      runDir: dir,
      model: resolved.model,
      fallbackModel: resolved.fallbackModel,
      permissionMode: resolved.permissionMode,
      allowedTools: resolved.allowedTools,
      maxTurns: resolved.maxTurns,
      maxBudgetUsd: resolved.maxBudgetUsd,
      pollMs: resolved.pollMs,
      timeoutMinutes: resolved.timeoutMinutes,
      invocation,
      composedPrompt: prompt,
    };
    io.stdout(`${JSON.stringify(plan, null, 2)}\n`);
    return { code: 0, plan };
  }

  if (existsSync(worktree)) throw new CoordinatorError("WORKTREE_EXISTS", `Refusing to reuse an existing path as a worktree: ${worktree}`);
  const sourceStatusAtStart = readGitStatus(repo);
  const sourceHeadAtStart = readGitHead(repo);

  git(["worktree", "add", "-b", branch, worktree, baselineCommit], { cwd: repo });
  const worktreeHead = readGitHead(worktree);
  if (worktreeHead !== baselineCommit) {
    throw new CoordinatorError("WORKTREE_VALIDATION_FAILED", `Worktree ${worktree} is at ${worktreeHead}, expected baseline ${baselineCommit}.`);
  }

  ensureRunDir(repo, runId);
  writeFileSync(path.join(dir, "prompt.txt"), prompt, "utf8");

  const state = {
    runId,
    schemaVersion: 1,
    status: "starting",
    repo,
    baseRef: resolved.baseRef,
    baselineCommit,
    branch,
    worktree,
    runDir: dir,
    promptFile: resolved.promptFile,
    model: resolved.model,
    fallbackModel: resolved.fallbackModel,
    permissionMode: resolved.permissionMode,
    allowedTools: resolved.allowedTools,
    maxTurns: resolved.maxTurns,
    maxBudgetUsd: resolved.maxBudgetUsd,
    pollMs: resolved.pollMs,
    timeoutMinutes: resolved.timeoutMinutes,
    invocation,
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    lastHeartbeatAt: null,
    head: worktreeHead,
    dirtyCount: 0,
    dirtyFiles: [],
    sourceHeadAtStart,
    sourceDirtyCountAtStart: sourceStatusAtStart.dirtyCount,
    exitCode: null,
    signal: null,
    error: null,
    claude: new ClaudeStreamObserver().snapshot(),
  };
  writeStateAtomic(dir, state);

  io.stderr(`[coordinator] run ${runId}\n`);
  io.stderr(`[coordinator] baseline ${baselineCommit} · branch ${branch}\n`);
  io.stderr(`[coordinator] worktree ${worktree}\n`);
  io.stderr(`[coordinator] model ${resolved.model} → fallback ${resolved.fallbackModel} · retries ${childEnv.CLAUDE_CODE_MAX_RETRIES}\n`);

  const streamFile = createWriteStream(path.join(dir, "stream.jsonl"), { flags: "a" });
  const stderrFile = createWriteStream(path.join(dir, "stderr.log"), { flags: "a" });
  const observer = new ClaudeStreamObserver();

  let child;
  try {
    child = spawn(claudeCommand.command, argv, {
      cwd: worktree,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    state.status = "spawn_error";
    state.endedAt = new Date().toISOString();
    state.error = `Failed to spawn ${claudeCommand.command}: ${error.message}`;
    writeStateAtomic(dir, state);
    streamFile.end();
    stderrFile.end();
    throw new CoordinatorError("SPAWN_FAILED", state.error);
  }

  state.pid = child.pid;
  state.status = "running";
  writeStateAtomic(dir, state);

  const splitter = createLineSplitter((line) => {
    streamFile.write(`${line}\n`);
    observer.ingestLine(line);
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => splitter.push(chunk));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderrFile.write(chunk));

  child.stdin.on("error", (error) => {
    stderrFile.write(`[coordinator] stdin error: ${error.message}\n`);
  });
  child.stdin.end(prompt, "utf8");

  const deadline = Date.now() + resolved.timeoutMinutes * 60_000;
  let terminationReason = null;
  let lastPrinted = { head: state.head, dirtyCount: -1, at: 0 };

  const poll = setInterval(() => {
    const status = readGitStatus(worktree);
    const head = readGitHead(worktree);
    state.head = head;
    state.dirtyCount = status.dirtyCount;
    state.dirtyFiles = status.dirtyFiles;
    state.dirtyFilesTruncated = status.truncated;
    state.lastHeartbeatAt = new Date().toISOString();
    state.claude = observer.snapshot();
    writeStateAtomic(dir, state);

    const material = head !== lastPrinted.head || status.dirtyCount !== lastPrinted.dirtyCount;
    if (material || Date.now() - lastPrinted.at >= HEARTBEAT_CADENCE_MS) {
      io.stderr(`[coordinator] ${new Date().toISOString()} head=${(head ?? "unknown").slice(0, 8)} dirty=${status.dirtyCount} events=${observer.events}${observer.costUsd === null ? "" : ` cost=$${observer.costUsd}`}\n`);
      lastPrinted = { head, dirtyCount: status.dirtyCount, at: Date.now() };
    }

    // `--max-budget-usd` is passed natively to the Claude CLI (see buildClaudeArgs), which is the
    // primary enforcement. This check is defense in depth for the case where Claude's own stream
    // reports having exceeded the budget before the CLI itself stops. Once a termination reason is
    // set, further ticks must not re-issue a termination request against an already-terminating child.
    if (terminationReason) return;

    if (resolved.maxBudgetUsd !== null && observer.costUsd !== null && observer.costUsd > resolved.maxBudgetUsd) {
      terminationReason = "budget_exceeded";
      io.stderr(`[coordinator] reported cost $${observer.costUsd} exceeds --max-budget-usd ${resolved.maxBudgetUsd}; terminating (defense in depth; --max-budget-usd was also passed natively to Claude).\n`);
      terminateProcessTree(child, (message) => io.stderr(`[coordinator] ${message}\n`));
      return;
    }
    if (Date.now() >= deadline) {
      terminationReason = "timed_out";
      io.stderr(`[coordinator] timeout after ${resolved.timeoutMinutes} minute(s); terminating.\n`);
      terminateProcessTree(child, (message) => io.stderr(`[coordinator] ${message}\n`));
    }
  }, resolved.pollMs);

  const outcome = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ exitCode: null, signal: null, spawnError: error.message }));
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal, spawnError: null }));
  });

  clearInterval(poll);
  splitter.flush();
  await Promise.all([
    new Promise((resolve) => streamFile.end(resolve)),
    new Promise((resolve) => stderrFile.end(resolve)),
  ]);

  state.exitCode = outcome.exitCode;
  state.signal = outcome.signal;
  state.endedAt = new Date().toISOString();
  state.lastHeartbeatAt = state.endedAt;
  state.claude = observer.snapshot();

  if (outcome.spawnError) {
    state.status = "spawn_error";
    state.error = outcome.spawnError;
  } else if (terminationReason) {
    state.status = terminationReason;
    state.error = terminationReason === "timed_out"
      ? `Terminated by coordinator after ${resolved.timeoutMinutes} minute(s).`
      : `Terminated by coordinator: reported cost exceeded --max-budget-usd ${resolved.maxBudgetUsd}.`;
  } else if (outcome.exitCode === 0 && observer.resultIsError !== true) {
    // Deliberately not "succeeded": a clean exit is not accepted delivery.
    state.status = "completed_unverified";
  } else {
    state.status = "failed";
    state.error = observer.resultIsError === true
      ? `Claude reported an error result (subtype ${observer.resultSubtype ?? "unknown"}).`
      : `Claude exited with code ${outcome.exitCode}${outcome.signal ? ` (signal ${outcome.signal})` : ""}.`;
  }

  const evidence = collectEvidence(state);
  state.head = evidence.head;
  state.dirtyCount = evidence.status.dirtyCount;
  state.dirtyFiles = evidence.status.dirtyFiles;
  state.dirtyFilesTruncated = evidence.status.truncated;
  state.commitCount = evidence.commitCount;
  state.sourceHeadUnchanged = evidence.sourceHeadUnchanged;
  state.reportFile = path.join(dir, "report.md");
  writeStateAtomic(dir, state);
  writeFileSync(state.reportFile, renderReport(state, evidence), "utf8");

  io.stderr(`[coordinator] status ${state.status} · exit ${state.exitCode} · commits ${evidence.commitCount} · dirty ${evidence.status.dirtyCount}\n`);
  io.stderr(`[coordinator] report ${state.reportFile}\n`);
  io.stderr("[coordinator] Claude finished. This is NOT accepted delivery — independent Codex review is required.\n");

  return { code: state.status === "completed_unverified" ? 0 : 1, state, evidence };
}

/* -------------------------------------------------------------------------- */
/* status / list / cleanup                                                     */
/* -------------------------------------------------------------------------- */

function summarizeState(state) {
  return [
    `${state.runId}  ${state.status}`,
    `  branch    ${state.branch ?? "?"}`,
    `  worktree  ${state.worktree ?? "?"}`,
    `  baseline  ${state.baselineCommit ?? "?"}`,
    `  head      ${state.head ?? "?"}  commits=${state.commitCount ?? "?"}  dirty=${state.dirtyCount ?? "?"}`,
    `  model     ${state.model ?? "?"} → ${state.fallbackModel ?? "?"}  exit=${state.exitCode ?? "n/a"}`,
    `  started   ${state.startedAt ?? "?"}  heartbeat=${state.lastHeartbeatAt ?? "?"}`,
    state.error ? `  error     ${state.error}` : null,
  ].filter(Boolean).join("\n");
}

export function commandStatus(runId, options, io) {
  const repo = assertGitRepo(path.resolve(io.cwd, options.repo ?? io.cwd));
  const state = readState(repo, runId);
  if (options.json) io.stdout(`${JSON.stringify(state, null, 2)}\n`);
  else io.stdout(`${summarizeState(state)}\n\nA terminal status is an observation, not acceptance. Independent Codex review is required.\n`);
  return { code: 0, state };
}

export function commandList(options, io) {
  const repo = assertGitRepo(path.resolve(io.cwd, options.repo ?? io.cwd));
  const runs = listRuns(repo);
  if (options.json) {
    io.stdout(`${JSON.stringify(runs, null, 2)}\n`);
  } else if (!runs.length) {
    io.stdout(`No coordinator runs under ${runsRoot(repo)}.\n`);
  } else {
    for (const state of runs) io.stdout(`${summarizeState(state)}\n\n`);
  }
  return { code: 0, runs };
}

/**
 * Cleanup is the only destructive command, so it never trusts `state.json` on its own: the
 * persisted state must name exactly the requested run, the resolved source repository, and the
 * one sibling worktree path the coordinator itself would derive for that run ID. A tampered or
 * copied state file therefore cannot point cleanup at an arbitrary directory.
 */
export function assertStateMatchesRun(state, repo, runId) {
  if (state.runId !== runId) {
    throw new CoordinatorError("STATE_MISMATCH", `state.json for run "${runId}" records runId "${state.runId}"; refusing to act on it.`);
  }
  if (typeof state.repo !== "string" || !state.repo || path.resolve(state.repo) !== path.resolve(repo)) {
    throw new CoordinatorError("STATE_MISMATCH", `state.json for run "${runId}" records repo "${state.repo}", but the resolved repository is "${repo}"; refusing to act on it.`);
  }
  if (typeof state.worktree !== "string" || !state.worktree) throw new CoordinatorError("STATE_INCOMPLETE", `Run "${runId}" has no valid recorded worktree.`);
  const expected = deriveWorktreePath(repo, runId);
  if (path.resolve(state.worktree) !== expected) {
    throw new CoordinatorError("WORKTREE_MISMATCH", `state.json for run "${runId}" records worktree "${state.worktree}", but the coordinator derives "${expected}" for this run; refusing to touch the recorded path.`);
  }
  return state;
}

export function commandCleanup(runId, options, io) {
  const repo = assertGitRepo(path.resolve(io.cwd, options.repo ?? io.cwd));
  const state = readState(repo, runId);
  const force = options.force === true;

  assertStateMatchesRun(state, repo, runId);
  if (!existsSync(state.worktree)) {
    git(["worktree", "prune"], { cwd: repo, allowFailure: true });
    state.status = "cleaned";
    state.cleanedAt = new Date().toISOString();
    writeStateAtomic(runDir(repo, runId), state);
    io.stdout(`Worktree already absent; pruned bookkeeping for ${runId}. Branch ${state.branch} is retained.\n`);
    return { code: 0, removed: false, state };
  }

  const status = readGitStatus(state.worktree);
  if (status.dirtyCount > 0 && !force) {
    const listing = status.dirtyFiles.map((file) => `  - ${file}`).join("\n");
    throw new CoordinatorError(
      "DIRTY_WORKTREE",
      `Refusing to clean up run "${runId}": ${status.dirtyCount} uncommitted/untracked entr${status.dirtyCount === 1 ? "y" : "ies"} in ${state.worktree}:\n${listing}${status.truncated ? "\n  - ..." : ""}\nUncommitted work is not recoverable from the branch. Review it, or re-run with --force to discard it.`,
    );
  }

  const evidence = collectEvidence(state);
  if (evidence.commitCount > 0) {
    io.stdout(`Note: ${evidence.commitCount} commit(s) on ${state.branch} are preserved on the branch after worktree removal.\n`);
  }

  const removeArgs = ["worktree", "remove", state.worktree];
  if (force) removeArgs.push("--force");
  git(removeArgs, { cwd: repo });
  git(["worktree", "prune"], { cwd: repo, allowFailure: true });

  state.status = "cleaned";
  state.cleanedAt = new Date().toISOString();
  state.cleanupForced = force;
  writeStateAtomic(runDir(repo, runId), state);
  io.stdout(`Removed worktree ${state.worktree}${force ? " (forced)" : ""}. Branch ${state.branch} and run artifacts under ${runDir(repo, runId)} are retained.\n`);
  return { code: 0, removed: true, state };
}

/* -------------------------------------------------------------------------- */
/* CLI entry                                                                   */
/* -------------------------------------------------------------------------- */

const HELP = `Civilon Claude coordinator

Usage:
  node scripts/claude-coordinator.mjs run --prompt-file <path> [options]
  node scripts/claude-coordinator.mjs status <run-id> [--repo <path>] [--json]
  node scripts/claude-coordinator.mjs list [--repo <path>] [--json]
  node scripts/claude-coordinator.mjs cleanup <run-id> [--repo <path>] [--force]

run options:
  --prompt-file <path>      Required. File containing the task prompt.
  --repo <path>             Source repository (default: cwd).
  --base <ref>              Baseline ref (default: HEAD).
  --name <slug>             Label used in the run ID (default: run).
  --model <name>            Primary model (default: ${DEFAULT_MODEL}).
  --fallback-model <name>   Overload fallback (default: ${DEFAULT_FALLBACK_MODEL}).
  --poll-ms <n>             Monitor interval (default: ${DEFAULT_POLL_MS}).
  --timeout-minutes <n>     Hard timeout (default: ${DEFAULT_TIMEOUT_MINUTES}).
  --max-turns <n>           Passed to Claude when set.
  --max-budget-usd <n>      Passed natively to Claude; coordinator also terminates as defense in depth.
  --permission-mode <mode>  One of ${ALLOWED_PERMISSION_MODES.join(", ")} (default: ${DEFAULT_PERMISSION_MODE}).
  --allowed-tools <list>    Passed to Claude when set.
  --dry-run                 Print the resolved plan and composed prompt; change nothing.

The coordinator never pushes, merges, or amends, and never uses --dangerously-skip-permissions.
A finished run is an observation, never accepted delivery: Codex reviews independently.
`;

export async function main(argv, io = {}) {
  const runtime = {
    cwd: io.cwd ?? process.cwd(),
    env: io.env ?? process.env,
    stdout: io.stdout ?? ((text) => process.stdout.write(text)),
    stderr: io.stderr ?? ((text) => process.stderr.write(text)),
  };
  try {
    const { command, options, positionals } = parseCliArgs(argv);
    if (command === "help") {
      runtime.stdout(HELP);
      return 0;
    }
    if (command === "run") return (await commandRun(options, runtime)).code;
    if (command === "list") return commandList(options, runtime).code;
    if (command === "status") {
      if (!positionals[0]) throw new CoordinatorError("MISSING_RUN_ID", "status requires a run ID.");
      return commandStatus(positionals[0], options, runtime).code;
    }
    if (command === "cleanup") {
      if (!positionals[0]) throw new CoordinatorError("MISSING_RUN_ID", "cleanup requires a run ID.");
      return commandCleanup(positionals[0], options, runtime).code;
    }
    return 2;
  } catch (error) {
    if (error instanceof CoordinatorError) {
      runtime.stderr(`[coordinator] ${error.code}: ${error.message}\n`);
      return 2;
    }
    runtime.stderr(`[coordinator] UNEXPECTED: ${error?.stack ?? error}\n`);
    return 3;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
