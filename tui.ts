import { Plugin } from "@opencode/plugin/tui"
import { createWarpNotifier } from "./src/warp"
import { debugLog } from "./src/debug"

const PLUGIN_VERSION = "0.2.0"

/**
 * Warp notifications, from the terminal client only.
 *
 * The terminal owns the TTY, so this is where the OSC 777 sequence is
 * written. The plugin ships no server entrypoint on purpose: the OpenCode
 * service has no controlling terminal, and an unattended or non-interactive
 * run must not raise a notification.
 */
export default Plugin.define({
  id: "warp.tui",
  setup(context) {
    if (!process.env.WARP_CLI_AGENT_PROTOCOL_VERSION) {
      debugLog("Warp does not advertise cli-agent protocol support — notifications disabled")
      return
    }

    const location = context.location ?? context.data.location.default()
    const cwd = location.directory
    const subagents = new Map<string, boolean>()

    const isSubagent = async (sessionID: string): Promise<boolean> => {
      const cached = subagents.get(sessionID)
      if (cached !== undefined) return cached
      let result = false
      try {
        const session = await context.client.session.get({ sessionID })
        result = Boolean(session.parentID)
      } catch {
        result = false
      }
      subagents.set(sessionID, result)
      return result
    }

    const notifier = createWarpNotifier({
      cwd,
      pluginVersion: PLUGIN_VERSION,
      isSubagent,
      loadMessages: (sessionID) => context.client.session.context({ sessionID }),
    })

    const stop = [
      context.data.on("session.created", (event) => void notifier.handle(event)),
      context.data.on("session.inbox.enqueued", (event) => void notifier.handle(event)),
      context.data.on("session.tool.input.started", (event) => void notifier.handle(event)),
      context.data.on("session.tool.success", (event) => void notifier.handle(event)),
      context.data.on("session.tool.failed", (event) => void notifier.handle(event)),
      context.data.on("permission.asked", (event) => void notifier.handle(event)),
      context.data.on("permission.replied", (event) => void notifier.handle(event)),
      context.data.on("session.execution.succeeded", (event) => void notifier.handle(event)),
      context.data.on("session.execution.failed", (event) => void notifier.handle(event)),
    ]

    return () => {
      stop.forEach((unsubscribe) => unsubscribe())
    }
  },
})
