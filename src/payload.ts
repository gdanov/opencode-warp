import path from "node:path"

const PLUGIN_MAX_PROTOCOL_VERSION = 1

function negotiateProtocolVersion(): number {
  const warpVersion = parseInt(process.env.WARP_CLI_AGENT_PROTOCOL_VERSION || "1", 10)
  if (Number.isNaN(warpVersion)) return PLUGIN_MAX_PROTOCOL_VERSION
  return Math.min(warpVersion, PLUGIN_MAX_PROTOCOL_VERSION)
}

export function buildPayload(
  event: string,
  sessionID: string,
  cwd: string,
  extraFields: Record<string, unknown> = {},
): string {
  const base = {
    v: negotiateProtocolVersion(),
    agent: "opencode",
    event,
    session_id: sessionID,
    cwd,
    project: cwd ? path.basename(cwd) : "",
  }
  return JSON.stringify({ ...base, ...extraFields })
}
