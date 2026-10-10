import type { SlashCommand } from "./slash";
import type { GrokSettings } from "./grok-settings";

export type ConnectionState =
  | "idle"
  | "starting"
  | "ready"
  | "error"
  | "stopped";

export type ToolStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | string;

export type ToolDiff = {
  path: string;
  oldText?: string;
  newText?: string;
};

export type AttachmentKind = "image" | "file";

export type MediaKind = "image" | "video" | "voice";

export type MediaAsset = {
  id: string;
  kind: MediaKind;
  path: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  src: string;
  prompt?: string;
  sessionId?: string;
  cwd?: string;
  text?: string;
};

export type PromptAttachment = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  preview?: string;
};

export type ComposerSubmitPayload = {
  text: string;
  attachments: PromptAttachment[];
  sessionRefs: SessionRef[];
  now?: boolean;
};

export type MentionHit = {
  id: string;
  kind: "file" | "session";
  label: string;
  detail?: string;
  path?: string;
  sessionId?: string;
  cwd?: string;
};

export type SessionRef = {
  sessionId: string;
  title: string;
  cwd?: string;
};

export type TimelineItem =
  | { id: string; kind: "user"; text: string; at?: number; attachments?: PromptAttachment[]; sessionRefs?: SessionRef[] }
  | { id: string; kind: "thought"; text: string; streaming?: boolean; at?: number; durationMs?: number; tokens?: number; interrupted?: boolean }
  | { id: string; kind: "assistant"; text: string; streaming?: boolean; at?: number; durationMs?: number; tokens?: number; interrupted?: boolean }
  | {
      id: string;
      kind: "tool";
      toolCallId: string;
      title: string;
      status: ToolStatus;
      toolKind?: string;
      rawInput?: unknown;
      outputText?: string;
      diffs?: ToolDiff[];
      at?: number;
      durationMs?: number;
      tokens?: number;
      background?: boolean;
      interrupted?: boolean;
    }
  | { id: string; kind: "plan"; text: string; at?: number; durationMs?: number; tokens?: number }
  | { id: string; kind: "system"; text: string; tone?: "info" | "error"; at?: number }
  | { id: string; kind: "interrupt"; at?: number; durationMs?: number };

export type PermissionOption = {
  optionId: string;
  name: string;
  kind?: string;
};

export type PermissionRequest = {
  requestId: string;
  sessionId: string;
  title: string;
  toolKind?: string;
  toolCallId?: string;
  rawInput?: unknown;
  options: PermissionOption[];
};

export type SessionSummary = {
  sessionId: string;
  sessionKind?: string;
  parentSessionId?: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
  updatedAtMs?: number;
  pinned?: boolean;
  pinOrder?: number;
  unread?: boolean;
  archived?: boolean;
  interrupted?: boolean;
  updateInterrupted?: boolean;
  /** Live Grok background tasks (commands / monitors / loops / subagents). */
  running?: boolean;
  backgroundCount?: number;
};

export type SubagentSummary = {
  id: string;
  parentSessionId: string;
  sessionId?: string;
  cwd?: string;
  description: string;
  agentType: string;
  status: string;
  prompt?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  toolCalls?: number;
  modelId?: string;
};

export type SubagentView = {
  agent: SubagentSummary;
  timeline: TimelineItem[];
  subagents: SubagentSummary[];
};

export function isMainSession(session: SessionSummary): boolean {
  return session.sessionKind !== "subagent" && !session.parentSessionId;
}

export type CustomSessionGroup = { id: string; name: string };
export type SessionOrganization = {
  groups: CustomSessionGroup[];
  assignments: Record<string, string>;
};
export type SessionBatchAction = "pin" | "unpin" | "archive" | "unarchive" | "delete" | "move";
export type SessionBatchResult = {
  snapshot: AppSnapshot;
  processedIds: string[];
  skippedIds: string[];
  errors: string[];
  backupPath?: string;
};

export type UpdateRiskSession = {
  sessionId: string;
  title: string;
  cwd?: string;
  busy?: boolean;
};

export type GrokUpdateInfo = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  channel?: string;
  installer?: string;
  checking?: boolean;
  applying?: boolean;
  error?: string;
  currentNotes?: string;
  latestNotes?: string;
  translatedLog?: string;
  translating?: boolean;
  atRisk: UpdateRiskSession[];
};

export type QuotaInfo = {
  usedPercent?: number;
  remainingPercent?: number;
  plan?: string;
  resetAt?: string;
  extraCredits?: string;
  period?: string;
  syncedAt?: number;
};

export type AccountInfo = {
  email?: string;
  plan?: string;
  modelName?: string;
  agentVersion?: string;
  connection: ConnectionState;
  grokBinary?: string;
  quota?: QuotaInfo;
};

export type SessionMode = "ask" | "auto" | "yolo" | "plan";

export type GroupSort = "recent" | "name-asc" | "name-desc" | "count" | "custom";
export type SessionSort = "recent" | "title-asc" | "title-desc" | "custom";

const GROUP_SORTS: GroupSort[] = ["recent", "name-asc", "name-desc", "count", "custom"];
const SESSION_SORTS: SessionSort[] = ["recent", "title-asc", "title-desc", "custom"];

export function parseGroupSort(value: unknown): GroupSort {
  return typeof value === "string" && (GROUP_SORTS as string[]).includes(value) ? (value as GroupSort) : "recent";
}

export function parseSessionSort(value: unknown): SessionSort {
  return typeof value === "string" && (SESSION_SORTS as string[]).includes(value) ? (value as SessionSort) : "recent";
}

export function normalizeGroupKey(cwd?: string | null): string {
  const raw = (cwd ?? "").trim();
  if (!raw) return "(unknown)";
  if (raw.startsWith("__")) return raw;
  if (raw === "(unknown)") return raw;
  let key = raw.replace(/\//g, "\\");
  while (key.length > 3 && key.endsWith("\\")) key = key.slice(0, -1);
  if (/^[a-zA-Z]:/.test(key)) key = key[0].toUpperCase() + key.slice(1);
  return key;
}

export type ModelInfo = {
  modelId: string;
  name: string;
  efforts?: string[];
  defaultEffort?: string;
};

export type StartOptions = {
  workspace: string;
  mode?: SessionMode;
  modelId?: string;
  effort?: string;
};

export type BackgroundTask = {
  id: string;
  title: string;
  kind: "command" | "monitor" | "subagent" | "loop";
  status: string;
  command?: string;
  startedAt?: number;
};

export type SessionRunStats = {
  startedAt?: number;
  turnStartedAt?: number;
  durationMs?: number;
  tokens?: number;
};

export type TokenDay = {
  day: string;
  tokens: number;
};

export type TokenUsageSummary = {
  days: TokenDay[];
  total: number;
  today: number;
};

export type QueuedPrompt = {
  id: string;
  text: string;
  attachments: PromptAttachment[];
  sessionRefs: SessionRef[];
  mode: "queue" | "steer";
  combined?: boolean;
};

export type AppSnapshot = {
  connection: ConnectionState;
  error?: string;
  workspace?: string;
  sessionId?: string;
  sessionTitle?: string;
  modelId?: string;
  modelName?: string;
  effort?: string;
  sessionMode: SessionMode;
  models: ModelInfo[];
  inspectorWidth: number;
  accountEmail?: string;
  agentVersion?: string;
  grokBinary?: string;
  timeline: TimelineItem[];
  busy: boolean;
  permission?: PermissionRequest;
  sessions: SessionSummary[];
  alwaysApprove: boolean;
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  collapsedGroups: string[];
  hiddenGroups: string[];
  groupSort: GroupSort;
  sessionSort: SessionSort;
  groupOrder: string[];
  sessionOrder: Record<string, string[]>;
  sessionOrganization?: SessionOrganization;
  account: AccountInfo;
  commands: SlashCommand[];
  settings: GrokSettings;
  update?: GrokUpdateInfo;
  backgroundTasks: BackgroundTask[];
  runStats: SessionRunStats;
  tokenUsage: TokenUsageSummary;
  promptQueue: QueuedPrompt[];
};

export type { SlashCommand } from "./slash";
export type { GrokSettings } from "./grok-settings";

export type AgentUiEvent =
  | { type: "snapshot"; snapshot: AppSnapshot }
  | { type: "timeline"; item: TimelineItem }
  | { type: "timeline-patch"; id: string; patch: Partial<TimelineItem> };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
