import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent, SessionMessageInfo } from "@opencode/client"
import { createWarpNotifier } from "../src/warp.ts"

const CWD = "/home/user/project"

function event(value: unknown): OpenCodeEvent {
  return value as OpenCodeEvent
}

function harness(options: { subagents?: string[]; messages?: SessionMessageInfo[] } = {}) {
  const delivered: Record<string, unknown>[] = []
  const notifier = createWarpNotifier({
    cwd: CWD,
    pluginVersion: "1.0.0",
    isSubagent: async (sessionID) => (options.subagents ?? []).includes(sessionID),
    loadMessages: async () => options.messages ?? [],
    deliver: (body) => delivered.push(JSON.parse(body)),
  })
  return { notifier, delivered }
}

describe("event mapping", () => {
  test("a new session announces itself", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(event({ type: "session.created", data: { sessionID: "ses_1" } }))
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.event).toBe("session_start")
    expect(delivered[0]?.session_id).toBe("ses_1")
    expect(delivered[0]?.project).toBe("project")
  })

  test("a subagent session stays silent", async () => {
    const { notifier, delivered } = harness({ subagents: ["ses_1"] })
    await notifier.handle(event({ type: "session.created", data: { sessionID: "ses_1" } }))
    expect(delivered).toHaveLength(0)
  })

  test("a user prompt is submitted once, not on every event", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(event({ type: "session.created", data: { sessionID: "ses_1" } }))
    await notifier.handle(
      event({
        type: "session.inbox.enqueued",
        data: { sessionID: "ses_1", item: { type: "user", payload: { text: "hello" } } },
      }),
    )
    expect(delivered.map((item) => item.event)).toEqual(["session_start", "prompt_submit"])
    expect(delivered[1]?.query).toBe("hello")
  })

  test("a synthetic message is not a prompt", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(
      event({
        type: "session.inbox.enqueued",
        data: { sessionID: "ses_1", item: { type: "synthetic", payload: { text: "note" } } },
      }),
    )
    expect(delivered).toHaveLength(0)
  })

  test("only the question tool asks a question", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(
      event({ type: "session.tool.input.started", data: { sessionID: "ses_1", id: "c1", name: "read" } }),
    )
    expect(delivered).toHaveLength(0)
    await notifier.handle(
      event({ type: "session.tool.input.started", data: { sessionID: "ses_1", id: "c2", name: "question" } }),
    )
    expect(delivered.map((item) => item.event)).toEqual(["session_start", "question_asked"])
  })

  test("a finished tool reports the name it started with", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(
      event({ type: "session.tool.input.started", data: { sessionID: "ses_1", id: "c1", name: "shell" } }),
    )
    await notifier.handle(event({ type: "session.tool.success", data: { sessionID: "ses_1", id: "c1" } }))
    const completed = delivered.find((item) => item.event === "tool_complete")
    expect(completed?.tool_name).toBe("shell")
  })

  test("a permission request summarises the command", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(
      event({
        type: "permission.asked",
        data: { sessionID: "ses_1", action: "shell", resources: ["rm -rf /"], metadata: {} },
      }),
    )
    expect(delivered[0]?.event).toBe("permission_request")
    expect(delivered[0]?.summary).toBe("Wants to run shell: rm -rf /")
  })

  test("a rejected permission is not a reply", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(
      event({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "p1", reply: "reject" } }),
    )
    expect(delivered).toHaveLength(0)
    await notifier.handle(
      event({ type: "permission.replied", data: { sessionID: "ses_1", requestID: "p1", reply: "once" } }),
    )
    expect(delivered.map((item) => item.event)).toEqual(["permission_replied"])
  })

  test("a finished turn carries the query and the response", async () => {
    const messages = [
      { type: "user", text: "what is the answer" },
      { type: "assistant", content: [{ type: "text", text: "42" }] },
    ] as unknown as SessionMessageInfo[]
    const { notifier, delivered } = harness({ messages })
    await notifier.handle(event({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } }))
    expect(delivered[0]?.event).toBe("stop")
    expect(delivered[0]?.query).toBe("what is the answer")
    expect(delivered[0]?.response).toBe("42")
  })

  test("another location is not this terminal's business", async () => {
    const { notifier, delivered } = harness()
    await notifier.handle(
      event({
        type: "session.created",
        data: { sessionID: "ses_1" },
        location: { directory: "/somewhere/else" },
      }),
    )
    expect(delivered).toHaveLength(0)
  })
})
