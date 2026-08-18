# Civilon Claude CLI coordinator

`scripts/claude-coordinator.mjs` is a small, dependency-free Node.js script that lets Codex
dispatch the Claude Code CLI directly: Opus as the primary model, Sonnet as the automatic
overload fallback, running in its own isolated Git worktree so Codex can review the result
independently.

It is a local dispatcher, not a service: there is no daemon and no stored API key. The coordinator
itself never pushes, merges, or amends. The delegated Claude process is isolated from the source
checkout by a worktree and receives explicit no-delivery instructions, but it is not an operating-
system or network sandbox; it retains whatever CLI, network, credential, and tool access the local
Claude installation grants it. Codex must still inspect the real repository and remote state.

## Security boundaries

- No `--dangerously-skip-permissions` / `bypassPermissions`, ever — the coordinator refuses to
  build such an invocation, and `--permission-mode` only accepts the two deliberately conservative
  modes `acceptEdits` and `plan`. (The installed CLI also knows `auto`, `manual`, and `dontAsk`,
  which the coordinator does not expose; it has no `default` mode at all.)
- No shell string interpolation. Every child process (`git`, `claude`, `powershell.exe`) is
  spawned with an argv array (`spawn(cmd, args, { shell: false })`); the composed prompt is sent
  on the child's **stdin**, never as a command-line argument, so it never appears in a process
  listing or shell history.
- No credential handling. The coordinator does not read, store, or print API keys; it only sets
  `CLAUDE_CODE_MAX_RETRIES` if the caller hasn't already.
- No `git push`, `git merge`, `--force`-push, or PR/merge operation is ever issued by the
  coordinator, and the composed prompt explicitly instructs the delegated Claude run not to
  either. This is a workflow control, not a hard network-security boundary. Delivery is a
  Codex/human decision, made after repository and remote-state review.
- Every run happens in its own sibling worktree on its own `claude/<run-id>` branch; the source
  repository's working tree, index, and HEAD are never touched by the coordinator itself.
- `status` and `cleanup` only accept coordinator-shaped run IDs (`[A-Za-z0-9-]+`); anything with
  dots, slashes, or an absolute path is rejected before it ever reaches a filesystem path. Before
  `cleanup` — the only destructive command — examines or removes anything, it additionally
  verifies that the persisted `state.json` names exactly the requested run ID, the resolved source
  repository, and the one sibling worktree path the coordinator derives for that run ID; a
  tampered state file that points anywhere else is refused outright.

## Commands

```powershell
# Kick off a run (composes the prompt, creates a worktree/branch, streams Claude's output)
node scripts/claude-coordinator.mjs run --prompt-file .\task-prompt.md --repo .

# See what would happen without creating a worktree or running Claude
node scripts/claude-coordinator.mjs run --prompt-file .\task-prompt.md --dry-run

# Inspect a run
node scripts/claude-coordinator.mjs status 20260818T120000Z-widget-ab12cd
node scripts/claude-coordinator.mjs list

# Remove a run's worktree once you're done reviewing it (branch + run data are kept)
node scripts/claude-coordinator.mjs cleanup 20260818T120000Z-widget-ab12cd
node scripts/claude-coordinator.mjs cleanup 20260818T120000Z-widget-ab12cd --force   # discard uncommitted work
```

Equivalent `npm` scripts: `npm run claude:run -- --prompt-file ...`, `claude:status`,
`claude:list`, `claude:cleanup` (note the `--` before flags, standard for `npm run`).

### `run` options

| Flag | Default | Notes |
| --- | --- | --- |
| `--prompt-file <path>` | required | The task prompt; wrapped in a repo-grounded instruction block before it's sent. |
| `--repo <path>` | cwd | Source repository the worktree is created from. |
| `--base <ref>` | `HEAD` | Baseline ref; resolved to an exact commit and recorded. |
| `--name <slug>` | `run` | Used to build the run ID / branch name. |
| `--model <name>` | `opus` | Primary model. |
| `--fallback-model <name>` | `sonnet` | Automatic overload fallback (`--fallback-model` on the Claude CLI). |
| `--poll-ms <n>` | `5000` | Monitor interval. |
| `--timeout-minutes <n>` | `120` | Hard wall-clock timeout; the child is terminated and the run marked `timed_out`. |
| `--max-turns <n>` | unset | Passed through to Claude when set. |
| `--max-budget-usd <n>` | unset | Passed natively to the Claude CLI (`--max-budget-usd`), which enforces it. As defense in depth the coordinator also terminates the run (`budget_exceeded`) if the reported cost in the stream ever exceeds it. |
| `--permission-mode <mode>` | `acceptEdits` | One of `acceptEdits`, `plan`. `bypassPermissions` is never permitted. |
| `--allowed-tools <list>` | unset | Permission/preapproval list passed through to Claude. It does not remove every other built-in tool or create an OS/network sandbox. |
| `--dry-run` | off | Print the resolved plan and composed prompt as JSON; create nothing. |

## Where state lives

Everything is under `<repo>/.claude-coordinator/runs/<run-id>/` (gitignored, and self-ignoring
via its own `.gitignore` so it never appears as untracked noise even in a repo that hasn't
ignored it):

- `state.json` — machine-readable status, timestamps, PID, baseline/branch/worktree, sanitized
  invocation (argv + env overrides, never the raw prompt), current HEAD, dirty file count/list,
  Claude's session ID, models observed in the stream, exit code/signal, reported cost/duration,
  error summary.
- `prompt.txt` — the exact composed prompt sent on stdin.
- `stream.jsonl` — the raw `--output-format stream-json` output, one JSON object per line.
- `stderr.log` — the child's stderr.
- `report.md` — the final human-readable report (see below).

The worktree itself lives as a sibling of the repo: `../<repo-name>-claude-<run-id>/`, on branch
`claude/<run-id>`. It is **kept** after the run finishes so Codex can inspect it; `cleanup`
removes only the worktree, never the branch or the run's recorded data.

## Lifecycle

1. `run` resolves `--base` to an exact commit, creates `<repo>/../<repo>-claude-<run-id>` as a
   new worktree on branch `claude/<run-id>` at that commit, and verifies the worktree actually
   landed on the baseline before doing anything else.
2. The composed prompt (operator prompt + baseline/isolation/reporting/stop-conditions preamble)
   is written to `prompt.txt` and piped to Claude's stdin. Claude runs with
   `--print --model opus --fallback-model sonnet --output-format stream-json --verbose
   --permission-mode acceptEdits` (plus any configured `--max-turns` / `--max-budget-usd` /
   `--allowed-tools`), with `CLAUDE_CODE_MAX_RETRIES=3` unless the caller already set it.
3. While the child runs, the coordinator polls on `--poll-ms`: it re-reads `git status`/`HEAD` in
   the worktree, rewrites `state.json` (write-to-temp-then-rename, so a reader never observes a
   half-written file), and prints a heartbeat line to stderr — either when HEAD or the dirty count
   changed, or at least once a minute.
4. `--max-budget-usd` is enforced natively by the Claude CLI, which receives it on its argv. If
   the wall-clock timeout expires — or, as defense in depth, the stream reports a cost above the
   budget before the CLI itself stops — the coordinator terminates the child (process tree kill
   via `taskkill /t /f` on Windows, `SIGTERM`→`SIGKILL` elsewhere) and records `timed_out` /
   `budget_exceeded`. A termination is requested at most once per run.
5. On exit, the coordinator gathers Git evidence directly (commit log, diff stat, status — both in
   the worktree and in the untouched source repo) and writes `report.md`. A clean `exit code 0` is
   recorded as **`completed_unverified`**, never as success.

## Claude's output vs. independently verified evidence

`report.md` is split into two halves on purpose:

- **"Independently verified Git evidence"** — gathered by the coordinator with `git` after the
  process exited: commits since baseline, diff stat, worktree status, and confirmation that the
  source repository's HEAD and working tree are unchanged.
- **"Claude's own claims (unverified)"** — whatever Claude's stream-json `result` event and final
  message said: session ID, models observed, turn count, reported cost/duration, its own summary
  text. These are claims, not proof, and are labeled as such.

Every report and every terminal CLI message says the same thing: **a finished run, including a
clean exit code and a green test run reported by Claude, is not accepted delivery.** Codex (or a
human) reviews the worktree, re-runs tests, and decides whether to merge — the coordinator never
pushes or merges on its own.

## Testing without a real Claude subscription

Set `CLAUDE_COORDINATOR_CLAUDE_BIN` to point at any Node script (or a real `claude.exe`/
`claude.ps1`) and the coordinator will launch it exactly as it would the real CLI — as an argv
command, not a shell string. `tests/helpers/fake-claude.mjs` is such a script: it records its
argv/cwd/stdin/env, emits `stream-json` events, and (depending on `FAKE_CLAUDE_MODE`) writes and
commits a file, leaves it uncommitted, hangs (for timeout coverage), or reports an error result.

Run the coordinator's own tests with:

```powershell
npm run test:coordinator
```
