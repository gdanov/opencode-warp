# opencode-warp

Warp terminal notifications for OpenCode, raised from the terminal client only.

A local port of [`@warp-dot-dev/opencode-warp`](https://github.com/warpdotdev/opencode-warp), which targets the OpenCode V1 plugin API and cannot load on V2 (it exports a named `WarpPlugin` function; V2 requires a default export with an `id` and a `setup`/`effect` function — upstream issues #27, #29, #30, #31).

Requires OpenCode V2 — the plugin API changed in 2.0 — and a Warp build that advertises the cli-agent protocol.

## Install

```sh
git clone https://github.com/gdanov/opencode-warp ~/.config/opencode/plugins/warp
```

Or symlink a checkout, for development:

```sh
ln -sfn "$PWD" ~/.config/opencode/plugins/warp
```

Nothing else is needed — OpenCode discovers plugins under `~/.config/opencode/plugins/` and reloads them when the files change.

## Terminal client only

The plugin ships a single entrypoint, `tui.ts`, and no server entrypoint. OpenCode V2 runs server plugins in a background service that has no controlling terminal: `/dev/tty` fails with `ENXIO` and the service's stdout is discarded, so a notification raised there cannot reach Warp. The terminal client does own the TTY, so it is the only place a notification can be delivered from.

The consequence is that only an interactive terminal client notifies:

| Use | Notifies? |
| --- | --- |
| `opencode` (interactive TUI) | yes |
| `opencode run "…"` (non-interactive) | no — it loads no terminal plugin |
| `opencode serve` / the background service | no — the plugin has no server entrypoint |
| CI, cron, any other unattended use | no |

Notifications are also restricted to the terminal's own project: events from other locations are ignored.

## Notifications

| Event | Warp payload event | Trigger |
| --- | --- | --- |
| session created | `session_start` | `session.created`, or the first prompt in a session |
| prompt submitted | `prompt_submit` | `session.inbox.enqueued` (user items) |
| permission requested | `permission_request` | `permission.asked` |
| permission approved | `permission_replied` | `permission.replied` (rejections are skipped) |
| question asked | `question_asked` | the `question` tool starting |
| tool finished | `tool_complete` | `session.tool.success` / `session.tool.failed` |
| turn finished | `stop` | `session.execution.succeeded` (query and response included) |

Notifications are only emitted when Warp advertises cli-agent protocol support (`WARP_CLI_AGENT_PROTOCOL_VERSION`), so other terminals never see the escape sequence. Subagent sessions are silent.

## Payload

Each notification is one OSC 777 sequence carrying a JSON object:

```json
{"v":1,"agent":"opencode","event":"stop","session_id":"ses_…","cwd":"/path/to/project","project":"project","query":"…","response":"…","transcript_path":""}
```

`event` names the occurrence, `v` is the negotiated protocol version, and the rest describes the session. Warp reads the body, not the terminal.

## Check it works

Send a prompt in the TUI and end the turn. Warp should show a notification for the prompt and one for the finished turn. If nothing appears, turn on the debug log: `notify via /dev/tty` means the sequence was written to the terminal, `notify /dev/tty failed: ENXIO` means the process has no terminal at all, and `notify via stdout` means the sequence went nowhere.

## Alongside the Claude Code Warp plugin

The Claude Code plugin `warp@claude-code-warp` sends the same notifications from Claude Code hooks. When it is run inside OpenCode through the [Claude Code bridge](https://github.com/gdanov/claude-opencode-bridge), those hooks execute in the OpenCode service, which has no terminal, so they cannot reach Warp and nothing is duplicated.

## Debugging

Set `WARP_DEBUG=1` (or create `$TMPDIR/opencode-warp.debug`) to log to `$TMPDIR/opencode-warp.log`. The log records which events were seen and whether the sequence reached `/dev/tty` or fell back to stdout.

`WARP_NOTIFY_LOG=<path>` appends every payload to a file instead of relying on the terminal.

## Development

```sh
bun run gate      # tsc --noEmit && bun test
```
