#!/usr/bin/env node
/**
 * A fake Claude Code CLI for coordinator tests.
 *
 * It records the argv, the relevant environment, and the prompt it received on stdin, then
 * emits stream-json events and behaves according to FAKE_CLAUDE_MODE:
 *
 *   work  (default) - writes a file in cwd and commits it, then exits 0
 *   dirty           - writes an uncommitted file in cwd, then exits 0
 *   hang            - emits an init event and never exits (for timeout coverage)
 *   fail            - emits an error result and exits 1
 *
 * It is launched by the coordinator as an argv array, never through a shell.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "work";
const sessionId = "fake-session-0001";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function readStdin() {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
  });
}

const prompt = await readStdin();

if (process.env.FAKE_CLAUDE_RECORD_FILE) {
  writeFileSync(
    process.env.FAKE_CLAUDE_RECORD_FILE,
    `${JSON.stringify({
      argv,
      cwd: process.cwd(),
      prompt,
      env: {
        CLAUDE_CODE_MAX_RETRIES: process.env.CLAUDE_CODE_MAX_RETRIES ?? null,
      },
    }, null, 2)}\n`,
    "utf8",
  );
}

emit({ type: "system", subtype: "init", session_id: sessionId, model: "claude-opus-fake", tools: [] });

if (mode === "hang") {
  emit({ type: "assistant", session_id: sessionId, message: { model: "claude-opus-fake", content: [{ type: "text", text: "working" }] } });
  // Keep the process alive until the coordinator's timeout terminates it.
  setInterval(() => {}, 1_000);
} else if (mode === "fail") {
  emit({ type: "assistant", session_id: sessionId, message: { model: "claude-opus-fake", content: [{ type: "text", text: "cannot continue" }] } });
  emit({ type: "result", subtype: "error_during_execution", session_id: sessionId, is_error: true, num_turns: 1, duration_ms: 12, total_cost_usd: 0.01, result: "Fake failure." });
  process.exit(1);
} else {
  const filename = process.env.FAKE_CLAUDE_OUTPUT_FILE ?? "fake-claude-change.txt";
  const target = path.join(process.cwd(), filename);
  writeFileSync(target, `written by fake claude\nprompt bytes: ${Buffer.byteLength(prompt, "utf8")}\n`, "utf8");
  emit({ type: "assistant", session_id: sessionId, message: { model: "claude-opus-fake", content: [{ type: "text", text: `wrote ${filename}` }] } });

  if (mode !== "dirty") {
    const git = (args) => execFileSync("git", args, { cwd: process.cwd(), stdio: "ignore", windowsHide: true });
    git(["add", "--all"]);
    git(["-c", "user.name=Fake Claude", "-c", "user.email=fake@example.invalid", "commit", "-m", "fake: apply delegated change"]);
    emit({ type: "assistant", session_id: sessionId, message: { model: "claude-sonnet-fake", content: [{ type: "text", text: "committed" }] } });
  }

  emit({
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
    num_turns: 3,
    duration_ms: 4_242,
    total_cost_usd: Number(process.env.FAKE_CLAUDE_COST_USD ?? "0.42"),
    modelUsage: { "claude-opus-fake": { inputTokens: 10 }, "claude-sonnet-fake": { inputTokens: 5 } },
    result: `Fake Claude finished in mode ${mode}.`,
  });
  process.exit(0);
}
