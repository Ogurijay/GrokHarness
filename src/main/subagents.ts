import type { SubagentView } from "../shared/types";
import { listSessionSubagents, resolveSessionDir } from "./session-store";
import { loadSessionTranscript } from "./session-transcript";

/** A read-only child inspection must never load the child into the live ACP host. */
export async function readSubagentView(parentSessionId: string, subagentId: string): Promise<SubagentView> {
  const agent = (await listSessionSubagents(parentSessionId)).find((row) => row.id === subagentId);
  if (!agent) throw new Error("找不到属于此对话的子代理");
  if (!agent.sessionId) return { agent, timeline: [], subagents: [] };
  if (!(await resolveSessionDir(agent.sessionId, agent.cwd))) throw new Error("子代理会话记录暂不可用");
  const [timeline, subagents] = await Promise.all([
    loadSessionTranscript(agent.sessionId, agent.cwd), listSessionSubagents(agent.sessionId, agent.cwd),
  ]);
  const last = timeline.at(-1);
  if (["running", "pending", "starting", "in_progress"].includes(agent.status) && last && (last.kind === "thought" || last.kind === "assistant")) last.streaming = true;
  return { agent, timeline, subagents };
}
