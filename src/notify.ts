import { appendFileSync, writeFileSync } from "node:fs"
import { debugLog } from "./debug"

const NOTIFICATION_TITLE = "warp://cli-agent"

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
  const sequence = `\x1b]777;notify;${NOTIFICATION_TITLE};${body}\x07`
  if (process.env.WARP_NOTIFY_LOG) {
    try {
      appendFileSync(process.env.WARP_NOTIFY_LOG, `${body}\n`)
    } catch {
      // the log is a test affordance — never let it break the notification
    }
  }
  try {
    writeFileSync("/dev/tty", sequence)
    debugLog("notify via /dev/tty")
  } catch (error) {
    debugLog("notify /dev/tty failed:", String(error))
    try {
      process.stdout.write(sequence)
      debugLog("notify via stdout")
    } catch {
      debugLog("notify stdout failed")
    }
  }
}
