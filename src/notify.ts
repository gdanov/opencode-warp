import { appendFileSync, writeFileSync } from "node:fs"
import { debugLog } from "./debug"

const NOTIFICATION_TITLE = "warp://cli-agent"
const DCS_PASSTHROUGH = "\x1bPtmux;"
const ST = "\x1b\\"

/**
 * Builds the OSC 777 notification, in a DCS passthrough envelope when tmux
 * owns the tty.
 *
 * tmux parses the escape sequences its panes emit and drops every OSC it does
 * not handle itself, so a bare OSC 777 never reaches the outer terminal. It
 * forwards a `ESC P tmux; … ESC \` envelope instead, with the ESC bytes of its
 * content doubled — but only when `allow-passthrough` is on.
 */
export function notificationSequence(body: string, tmux: boolean): string {
  const osc = `\x1b]777;notify;${NOTIFICATION_TITLE};${body}\x07`
  if (!tmux) return osc
  return `${DCS_PASSTHROUGH}${osc.replaceAll("\x1b", "\x1b\x1b")}${ST}`
}

/**
 * Sends a Warp notification via OSC 777 escape sequence.
 *
 * Only emits when Warp declares cli-agent protocol support, avoiding garbled
 * output in other terminals (and working over SSH).
 *
 * On Unix we write to /dev/tty so the sequence bypasses any stdout redirection
 * or terminal-multiplexer capture. On Windows /dev/tty doesn't exist, so we
 * fall back to process.stdout, which works because OpenCode plugins run
 * in-process (sharing the same ConPTY-connected stdout).
 */
export function warpNotify(body: string): void {
  if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) return
  const tmux = Boolean(process.env.TMUX)
  const sequence = notificationSequence(body, tmux)
  if (process.env.WARP_NOTIFY_LOG) {
    try {
      appendFileSync(process.env.WARP_NOTIFY_LOG, `${body}\n`)
    } catch {
      // the log is a test affordance — never let it break the notification
    }
  }
  try {
    writeFileSync("/dev/tty", sequence)
    debugLog("notify via /dev/tty", tmux ? "(tmux passthrough)" : "")
  } catch (error) {
    debugLog("notify /dev/tty failed:", String(error))
    try {
      process.stdout.write(sequence)
      debugLog("notify via stdout", tmux ? "(tmux passthrough)" : "")
    } catch {
      debugLog("notify stdout failed")
    }
  }
}
