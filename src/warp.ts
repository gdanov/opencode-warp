import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client"
import { buildPayload } from "./payload"
import { warpNotify } from "./notify"
import { truncate } from "./utils"
import { debugLog } from "./debug"

export interface WarpNotifierOptions {
  cwd: string
  pluginVersion: string
  /** Subagent sessions are silent — their output belongs to the parent session. */
  isSubagent: (sessionID: string) => Promise<boolean>
  loadMessages: (sessionID: string) => Promise<readonly SessionMessageInfo[]>
  /** Where the payload goes. Overridden in tests. */
  deliver?: (body: string) => void
}

export interface WarpNotifier {
  handle(event: OpenCodeEvent): Promise<void>
  /** Warp treats session_start as the handshake that an agent session is live. */
  ensureStarted(sessionID: string): Promise<void>
}

function userText(messages: readonly SessionMessageInfo[]): string {
  const last = [...messages].reverse().find((message) => message.type === "user")
  return last && last.type === "user" ? last.text : ""
}

function assistantText(messages: readonly SessionMessageInfo[]): string {
  const last = [...messages].reverse().find((message) => message.type === "assistant")
  if (!last || last.type !== "assistant") return ""
  return last.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join(" ")
}

function permissionPreview(metadata: unknown, resources: readonly string[]): string {
  const input = (metadata ?? {}) as Record<string, unknown>
  if (typeof input.command === "string") return input.command
  if (typeof input.file_path === "string") return input.file_path
  if (typeof input.filePath === "string") return input.filePath
  const resource = resources[0]
  if (resource) return resource
  return Object.keys(input).length > 0 ? JSON.stringify(input).slice(0, 80) : ""
}

export function createWarpNotifier(options: WarpNotifierOptions): WarpNotifier {
  const started = new Set<string>()
  const toolNames = new Map<string, string>()

  const notify = async (sessionID: string, event: string, extra: Record<string, unknown> = {}) => {
    if (await options.isSubagent(sessionID)) return
    const deliver = options.deliver ?? warpNotify
    deliver(buildPayload(event, sessionID, options.cwd, extra))
  }

  const ensureStarted = async (sessionID: string) => {
    if (started.has(sessionID)) return
    started.add(sessionID)
    await notify(sessionID, "session_start", { plugin_version: options.pluginVersion })
  }

  const lastExchange = async (sessionID: string) => {
    try {
      const messages = await options.loadMessages(sessionID)
      return {
        query: truncate(userText(messages), 200),
        response: truncate(assistantText(messages), 200),
      }
    } catch {
      return { query: "", response: "" }
    }
  }

  const handle = async (event: OpenCodeEvent): Promise<void> => {
    debugLog("tui", "event", event.type)
    const eventLocation = "location" in event ? event.location?.directory : undefined
    if (eventLocation && String(eventLocation) !== options.cwd) return
    switch (event.type) {
      case "session.created": {
        if (event.data.parentID) return
        await ensureStarted(event.data.sessionID)
        return
      }
      case "session.inbox.enqueued": {
        const { sessionID, item } = event.data
        if (item.type !== "user") return
        const query = item.payload.text
        if (!query) return
        await ensureStarted(sessionID)
        await notify(sessionID, "prompt_submit", { query: truncate(query, 200) })
        return
      }
      case "session.tool.input.started": {
        const { sessionID, id, name } = event.data
        toolNames.set(id, name)
        if (name !== "question") return
        await ensureStarted(sessionID)
        await notify(sessionID, "question_asked", { tool_name: name })
        return
      }
      case "session.tool.success":
      case "session.tool.failed": {
        const { sessionID, id } = event.data
        const name = toolNames.get(id) ?? ""
        toolNames.delete(id)
        await notify(sessionID, "tool_complete", { tool_name: name })
        return
      }
      case "permission.asked": {
        const { sessionID, action, resources, metadata } = event.data
        const preview = permissionPreview(metadata, resources)
        const summary = preview ? `Wants to run ${action}: ${truncate(preview, 120)}` : `Wants to run ${action}`
        await notify(sessionID, "permission_request", {
          summary,
          tool_name: action,
          tool_input: metadata ?? {},
        })
        return
      }
      case "permission.replied": {
        if (event.data.reply === "reject") return
        await notify(event.data.sessionID, "permission_replied")
        return
      }
      case "session.execution.succeeded": {
        const { query, response } = await lastExchange(event.data.sessionID)
        await notify(event.data.sessionID, "stop", { query, response, transcript_path: "" })
        return
      }
      case "session.execution.failed": {
        const { query } = await lastExchange(event.data.sessionID)
        await notify(event.data.sessionID, "stop", {
          query,
          response: truncate(event.data.error.message, 200),
          transcript_path: "",
        })
        return
      }
    }
  }

  return { handle, ensureStarted }
}
