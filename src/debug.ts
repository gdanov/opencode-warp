import { appendFileSync, existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const LOG_PATH = path.join(os.tmpdir(), "opencode-warp.log")
const FLAG_PATH = path.join(os.tmpdir(), "opencode-warp.debug")

/** Debug logging is on when the env flag is set or the flag file exists. */
export function debugEnabled(): boolean {
  if (process.env.WARP_DEBUG) return true
  try {
    return existsSync(FLAG_PATH)
  } catch {
    return false
  }
}

/** Writes to a file, never to stdout — stdout belongs to the OpenCode TUI. */
export function debugLog(...parts: unknown[]): void {
  if (!debugEnabled()) return
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${parts.map(String).join(" ")}\n`)
  } catch {
    // logging must never break the plugin
  }
}
