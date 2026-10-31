import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { notificationSequence, warpNotify } from "../src/notify.ts"

const BODY = '{"v":1,"agent":"opencode","event":"stop"}'
const BARE = `\x1b]777;notify;warp://cli-agent;${BODY}\x07`

describe("notification sequence", () => {
  test("a terminal without a multiplexer gets the bare OSC", () => {
    expect(notificationSequence(BODY, false)).toBe(BARE)
  })

  test("tmux gets a DCS passthrough envelope around a doubled OSC", () => {
    const sequence = notificationSequence(BODY, true)
    expect(sequence.startsWith("\x1bPtmux;\x1b\x1b]777;notify;warp://cli-agent;")).toBe(true)
    expect(sequence.endsWith("\x07\x1b\\")).toBe(true)
  })

  test("the envelope unwraps back to the bare OSC", () => {
    const unwrapped = notificationSequence(BODY, true)
      .slice("\x1bPtmux;".length, -"\x1b\\".length)
      .replaceAll("\x1b\x1b", "\x1b")
    expect(unwrapped).toBe(BARE)
  })
})

describe("the Warp gate", () => {
  test("nothing is emitted when Warp does not advertise the protocol", () => {
    const dir = mkdtempSync(join(tmpdir(), "opencode-warp-"))
    const log = join(dir, "notify.log")
    const protocol = process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
    const savedLog = process.env.WARP_NOTIFY_LOG
    try {
      process.env.WARP_NOTIFY_LOG = log
      delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
      warpNotify(BODY)
      expect(existsSync(log)).toBe(false)
    } finally {
      if (protocol === undefined) delete process.env.WARP_CLI_AGENT_PROTOCOL_VERSION
      else process.env.WARP_CLI_AGENT_PROTOCOL_VERSION = protocol
      if (savedLog === undefined) delete process.env.WARP_NOTIFY_LOG
      else process.env.WARP_NOTIFY_LOG = savedLog
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
