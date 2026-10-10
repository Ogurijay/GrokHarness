import { execFile } from "node:child_process";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SessionSummary, SubagentSummary } from "../shared/types";

const execFileAsync = promisify(execFile);

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function grokHome(): string {
  return process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeCwdDir(name: string): string | undefined {
  try {
    const decoded = decodeURIComponent(name);
    return decoded.includes(":") || decoded.startsWith("/") || decoded.startsWith("\\\\")
      ? decoded
      : undefined;
  } catch {
    return undefined;
  }
}

async function readCwdOverride(groupDir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(groupDir, ".cwd"), "utf8");
    const line = raw.trim();
    return line || undefined;
  } catch {
    return undefined;
  }
}

async function readSummary(sessionDir: string, fallbackId: string, fallbackCwd?: string): Promise<SessionSummary> {
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(join(sessionDir, "summary.json"))).mtimeMs;
  } catch {
    try {
      mtimeMs = (await stat(sessionDir)).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
  }

  try {
    const raw = await readFile(join(sessionDir, "summary.json"), "utf8");
    const json = asRecord(JSON.parse(raw));
    const info = asRecord(json?.info);
    const sessionId = asString(info?.id) ?? fallbackId;
    const cwd = asString(info?.cwd) ?? fallbackCwd;
    const manual = json?.title_is_manual === true || json?.title_is_manual === 1;
    const title =
      (manual ? asString(json?.title) ?? asString(json?.generated_title) : undefined) ??
      asString(json?.generated_title) ??
      asString(json?.session_summary) ??
      truncateTitle(asString(json?.last_turn_summary));
    const updatedAt =
      asString(json?.last_active_at) ??
      asString(json?.updated_at) ??
      asString(json?.created_at);
    const updatedAtMs = updatedAt ? Date.parse(updatedAt) || mtimeMs : mtimeMs;
    return {
      sessionId,
      sessionKind: asString(json?.session_kind),
      cwd,
      title: title || "未命名对话",
      updatedAt,
      updatedAtMs,
    };
  } catch {
    return {
      sessionId: fallbackId,
      cwd: fallbackCwd,
      title: "未命名对话",
      updatedAt: mtimeMs ? new Date(mtimeMs).toISOString() : undefined,
      updatedAtMs: mtimeMs,
    };
  }
}

export function sanitizeSessionTitle(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function writeSessionTitle(sessionId: string, title: string, cwd?: string): Promise<void> {
  const dir = await resolveSessionDir(sessionId, cwd);
  if (!dir) throw new Error("找不到会话目录");
  const file = join(dir, "summary.json");
  let json: Record<string, unknown> = {};
  try {
    json = asRecord(JSON.parse(await readFile(file, "utf8"))) ?? {};
  } catch {
    json = { info: { id: sessionId, ...(cwd ? { cwd } : {}) } };
  }
  json.generated_title = title;
  json.title_is_manual = true;
  if (!asString(json.session_summary)) json.session_summary = title;
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

function truncateTitle(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 80) return oneLine;
  return `${oneLine.slice(0, 80)}…`;
}

export async function resolveSessionDir(sessionId: string, cwd?: string): Promise<string | undefined> {
  if (!SESSION_ID.test(sessionId)) return undefined;
  const root = join(grokHome(), "sessions");
  if (cwd) {
    const direct = join(root, encodeURIComponent(cwd), sessionId);
    try {
      if ((await stat(direct)).isDirectory()) return direct;
    } catch {
      /* search */
    }
  }
  let groups: string[] = [];
  try {
    groups = await readdir(root);
  } catch {
    return undefined;
  }
  for (const groupName of groups) {
    const sessionDir = join(root, groupName, sessionId);
    try {
      if ((await stat(sessionDir)).isDirectory()) return sessionDir;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Official parent/subagents/<id>/meta.json is the ownership source of truth. */
export async function listSessionSubagents(sessionId: string, cwd?: string): Promise<SubagentSummary[]> {
  const parent = await resolveSessionDir(sessionId, cwd);
  if (!parent) return [];
  return readSubagentsInDir(parent, sessionId, cwd);
}

async function readSubagentsInDir(parent: string, parentSessionId: string, cwd?: string): Promise<SubagentSummary[]> {
  let names: string[];
  try { names = await readdir(join(parent, "subagents")); } catch { return []; }
  const rows = await Promise.all(names.filter((id) => SESSION_ID.test(id)).map(async (id) => {
    try {
      const meta = asRecord(JSON.parse(await readFile(join(parent, "subagents", id, "meta.json"), "utf8")));
      if (!meta || (meta.parent_session_id && meta.parent_session_id !== parentSessionId)) return undefined;
      const child = asString(meta.child_session_id);
      const number = (key: string) => typeof meta[key] === "number" && Number.isFinite(meta[key]) ? meta[key] as number : undefined;
      return {
        id, parentSessionId, sessionId: child && SESSION_ID.test(child) ? child : undefined,
        cwd: asString(meta.child_cwd) ?? cwd,
        description: asString(meta.description) ?? asString(meta.subagent_type) ?? "子代理",
        agentType: asString(meta.subagent_type) ?? "general-purpose",
        status: asString(meta.status) ?? "unknown", prompt: asString(meta.prompt),
        startedAt: asString(meta.started_at), completedAt: asString(meta.completed_at),
        durationMs: number("duration_ms"), toolCalls: number("tool_calls"),
        modelId: asString(meta.effective_model_id),
      } satisfies SubagentSummary;
    } catch { return undefined; }
  }));
  return rows.filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? "") || a.id.localeCompare(b.id));
}

/** Read every local grok session under ~/.grok/sessions, across all working directories. */
export async function listLocalSessions(): Promise<SessionSummary[]> {
  const root = join(grokHome(), "sessions");
  let groups: string[] = [];
  try {
    groups = await readdir(root);
  } catch {
    return [];
  }

  const sessions: SessionSummary[] = [];
  const ownership = new Map<string, string>();
  for (const groupName of groups) {
    if (groupName.endsWith(".sqlite") || groupName.startsWith(".")) continue;
    const groupDir = join(root, groupName);
    let groupStat;
    try {
      groupStat = await stat(groupDir);
    } catch {
      continue;
    }
    if (!groupStat.isDirectory()) continue;

    const encodedCwd = decodeCwdDir(groupName);
    const cwdOverride = await readCwdOverride(groupDir);
    const groupCwd = cwdOverride ?? encodedCwd;

    let children: string[] = [];
    try {
      children = await readdir(groupDir);
    } catch {
      continue;
    }

    for (const name of children) {
      if (!SESSION_ID.test(name)) continue;
      const sessionDir = join(groupDir, name);
      try {
        if (!(await stat(sessionDir)).isDirectory()) continue;
      } catch {
        continue;
      }
      sessions.push(await readSummary(sessionDir, name, groupCwd));
      for (const child of await readSubagentsInDir(sessionDir, name, groupCwd)) {
        if (child.sessionId) ownership.set(child.sessionId, name);
      }
    }
  }

  for (const session of sessions) session.parentSessionId = ownership.get(session.sessionId);
  sessions.sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));
  return sessions;
}

/** Permanently remove a session via grok CLI, then drop leftover files. */
export async function purgeSession(
  sessionId: string,
  cwd?: string,
  binary?: string,
): Promise<void> {
  if (binary) {
    try {
      await execFileAsync(binary, ["sessions", "delete", sessionId], {
        timeout: 20_000,
        windowsHide: true,
        env: {
          ...process.env,
          GROK_DISABLE_AUTOUPDATER: "1",
        },
      });
    } catch {
      /* filesystem fallback below */
    }
  }
  const dir = await resolveSessionDir(sessionId, cwd);
  if (!dir) return;
  await rm(dir, { recursive: true, force: true });
}
