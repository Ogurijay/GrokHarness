import { randomUUID } from "node:crypto";
import { app, BrowserWindow, Notification } from "electron";
import { ABSORBED_BY_STREAM, AcpClient } from "../shared/acp-client";
import type {
  AgentUiEvent,
  AppSnapshot,
  BackgroundTask,
  JsonValue,
  MentionHit,
  ModelInfo,
  PermissionOption,
  PermissionRequest,
  PromptAttachment,
  QueuedPrompt,
  GroupSort,
  SessionMode,
  SessionRef,
  SessionRunStats,
  SessionSummary,
  SessionOrganization,
  SessionBatchAction,
  SessionBatchResult,
  SessionSort,
  StartOptions,
  TimelineItem,
  ToolDiff,
} from "../shared/types";
import { isMainSession, normalizeGroupKey, parseGroupSort, parseSessionSort } from "../shared/types";
import { cleanGroupName, customGroupKey, normalizeOrganization, removeCustomGroup } from "../shared/session-organization";
import { activeLocalSessionIds, collectSessionTree, retireLocalSessions } from "./session-management";
import { resolveGrokBinary } from "./resolve-binary";
import { startGrokServe, stopGrokServe, type ServeHandle } from "./grok-process";
import { listLocalSessions, sanitizeSessionTitle, writeSessionTitle } from "./session-store";
import { loadSessionTranscript } from "./session-transcript";
import { LocalDb } from "./local-db";
import { fetchQuota, loadAccountSeed, parseUsagePayload } from "./account";
import { mergeSlashCommands, parseSlashCommands } from "../shared/slash";
import { normalizeUserText } from "../shared/message-text";
import { readEventStats, touchStats, type StatsCursor } from "../shared/step-stats";
import { GROK_SETTINGS_DEFAULTS, isGrokSettingKey, type GrokSettings } from "../shared/grok-settings";
import { applySetting, loadGrokToml, resolveWorkspace, saveGrokToml, settingsFromToml } from "./grok-config";
import { buildPromptBlocks, inspectPath, searchWorkspaceFiles } from "./attachments";
import { checkGrokUpdate, collectAtRisk, installGrokUpdate, recordTranslatedUpdate } from "./grok-update";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cwdLabel(cwd?: string): string {
  if (!cwd) return "";
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function parseModel(rec: Record<string, unknown>): ModelInfo | undefined {
  const modelId = asString(rec.modelId);
  if (!modelId) return undefined;
  const meta = asRecord(rec._meta) ?? rec;
  const raw = meta.reasoningEfforts ?? rec.reasoningEfforts;
  const efforts: string[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (typeof row === "string" && row.trim()) efforts.push(row.trim());
      else {
        const nested = asRecord(row);
        const id = asString(nested?.id) ?? asString(nested?.value) ?? asString(nested?.effort);
        if (id) efforts.push(id);
      }
    }
  }
  const supports = meta.supportsReasoningEffort === true || efforts.length > 0;
  return {
    modelId,
    name: asString(rec.name) ?? modelId,
    efforts: supports ? (efforts.length ? efforts : ["low", "medium", "high", "xhigh"]) : [],
    defaultEffort: asString(meta.reasoningEffort) ?? asString(meta.defaultReasoningEffort),
  };
}

function clampInspectorWidth(width: number): number {
  return Math.min(720, Math.max(240, Math.round(width)));
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  const rec = asRecord(content);
  if (!rec) return "";
  if (typeof rec.text === "string") return rec.text;
  if (Array.isArray(rec.content)) {
    return rec.content.map(collectText).filter(Boolean).join("");
  }
  return "";
}

function collectDiffs(content: unknown): ToolDiff[] {
  if (!Array.isArray(content)) return [];
  const diffs: ToolDiff[] = [];
  for (const entry of content) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const type = asString(rec.type);
    if (type === "diff") {
      diffs.push({
        path: asString(rec.path) ?? "file",
        oldText: asString(rec.oldText),
        newText: asString(rec.newText),
      });
    }
  }
  return diffs;
}

function collectHaystack(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    if (value.trim()) into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectHaystack(entry, into);
    return;
  }
  const rec = asRecord(value);
  if (!rec) return;
  for (const entry of Object.values(rec)) collectHaystack(entry, into);
}

function collectOutput(content: unknown): string | undefined {
  const parts: string[] = [];
  collectHaystack(content, parts);
  return parts.length ? parts.join("\n") : undefined;
}

function looksBackground(text?: string): boolean {
  if (!text) return false;
  return /moved to (the )?background|still running|<status>\s*running\s*<\/status>|status:\s*running|automatically moved to background|background:\s*true/i.test(
    text,
  );
}

function taskKindFrom(raw?: string, title?: string): BackgroundTask["kind"] {
  const hay = `${raw ?? ""} ${title ?? ""}`.toLowerCase();
  if (/monitor/.test(hay)) return "monitor";
  if (/subagent|spawn/.test(hay)) return "subagent";
  if (/loop|scheduler/.test(hay)) return "loop";
  return "command";
}

function parseBackgroundTask(raw: unknown): BackgroundTask | undefined {
  const rec = asRecord(raw);
  if (!rec) return undefined;
  const snap = asRecord(rec.task_snapshot) ?? rec;
  const id =
    asString(snap.task_id) ??
    asString(snap.taskId) ??
    asString(snap.id) ??
    asString(rec.task_id) ??
    asString(rec.taskId) ??
    asString(rec.tool_call_id) ??
    asString(rec.toolCallId);
  if (!id) return undefined;
  const command = asString(snap.command) ?? asString(rec.command);
  const title =
    asString(snap.description) ??
    asString(rec.description) ??
    asString(snap.title) ??
    asString(rec.title) ??
    command ??
    "task";
  const kindRaw = asString(snap.kind) ?? asString(rec.kind);
  const start = asRecord(snap.start_time) ?? asRecord(rec.start_time);
  const startedAt =
    typeof start?.secs_since_epoch === "number"
      ? start.secs_since_epoch * 1000 + Math.floor((Number(start.nanos_since_epoch) || 0) / 1e6)
      : Date.now();
  return {
    id,
    title,
    kind: taskKindFrom(kindRaw, title),
    status: "running",
    command,
    startedAt,
  };
}

export class AgentHost {
  private serve: ServeHandle | undefined;
  private client: AcpClient | undefined;
  private connectionPromise?: Promise<AcpClient>;
  private connectionAbort?: AbortController;
  private grokBinary?: string;
  private db = new LocalDb();
  private listeners = new Set<(event: AgentUiEvent) => void>();
  private hydrating = false;
  private sessionLoadEpoch = 0;
  private loadingSessionId?: string;
  private seenSessionEventIds = new Set<string>();
  private hydrationUpdates: Array<{
    update: Record<string, unknown>;
    meta?: Record<string, unknown>;
    sessionId?: string;
  }> = [];
  private drainingQueue = false;
  private promptEpoch = 0;
  private ignoreUpdates = false;
  private accountRefreshing = false;
  private statsCursor: StatsCursor = {};
  private sessionTasks = new Map<string, Map<string, BackgroundTask>>();
  private permissionWaiters = new Map<
    string,
    { resolve: (optionId: string | null) => void }
  >();
  private snapshot: AppSnapshot = {
    connection: "idle",
    models: [],
    timeline: [],
    busy: false,
    sessions: [],
    alwaysApprove: false,
    sessionMode: "ask",
    sidebarCollapsed: false,
    inspectorOpen: false,
    inspectorWidth: 320,
    collapsedGroups: [],
    hiddenGroups: [],
    groupSort: "recent",
    sessionSort: "recent",
    groupOrder: [],
    sessionOrder: {},
    sessionOrganization: { groups: [], assignments: {} },
    account: { connection: "idle" },
    commands: mergeSlashCommands(),
    settings: GROK_SETTINGS_DEFAULTS,
    backgroundTasks: [],
    runStats: {},
    tokenUsage: { days: [], total: 0, today: 0 },
    promptQueue: [],
  };

  onEvent(listener: (event: AgentUiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): AppSnapshot {
    return this.snapshot;
  }

  localDb(): LocalDb {
    return this.db;
  }

  private emit(event: AgentUiEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private patch(partial: Partial<AppSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.snapshot.account = {
      ...this.snapshot.account,
      email: this.snapshot.accountEmail ?? this.snapshot.account.email,
      modelName: this.snapshot.modelName ?? this.snapshot.account.modelName,
      agentVersion: this.snapshot.agentVersion ?? this.snapshot.account.agentVersion,
      grokBinary: this.snapshot.grokBinary ?? this.snapshot.account.grokBinary,
      connection: this.snapshot.connection,
    };
    this.syncDerived();
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  setAlwaysApprove(value: boolean): void {
    this.setSessionMode(value ? "yolo" : "ask");
  }

  setSessionMode(mode: SessionMode): void {
    this.db.setKv("lastMode", mode);
    if (mode === "ask" || mode === "auto" || mode === "yolo") {
      this.setGrokSetting("permissionMode", mode === "yolo" ? "always-approve" : mode);
    }
    this.patch({
      sessionMode: mode,
      alwaysApprove: mode === "yolo",
    });
  }

  async initLocal(): Promise<void> {
    try {
      await this.db.init();
    } catch (err) {
      console.error("local sqlite init failed", err);
    }
    const seed = await loadAccountSeed();
    this.patch({
      sidebarCollapsed: this.db.getBool("sidebarCollapsed", false),
      inspectorOpen: this.db.getBool("inspectorOpen", false),
      inspectorWidth: clampInspectorWidth(this.db.getNumber("inspectorWidth", 320)),
      collapsedGroups: this.readCollapsedGroups(),
      hiddenGroups: this.readHiddenGroups(),
      groupSort: parseGroupSort(this.readSidebarPrefs()?.groupSort ?? this.db.getKv("groupSort")),
      sessionSort: parseSessionSort(this.readSidebarPrefs()?.sessionSort ?? this.db.getKv("sessionSort")),
      groupOrder: this.readGroupOrder(),
      sessionOrder: this.readSessionOrder(),
      sessionOrganization: normalizeOrganization(this.db.getJson("sessionOrganization", {})),
      alwaysApprove: this.db.getBool("alwaysApprove", false),
      sessionMode: (this.db.getKv("lastMode") as SessionMode | undefined) ?? "ask",
      workspace: this.db.getKv("lastWorkspace"),
      modelId: this.db.getKv("lastModelId"),
      effort: this.db.getKv("lastEffort"),
      account: {
        email: seed.email,
        connection: this.snapshot.connection,
      },
    });
    this.reloadGrokSettings();
    await this.loadLocalSessions();
    void this.refreshAccount();
    void this.refreshUpdate();
    setInterval(() => void this.refreshAccount(), 5 * 60_000);
    setInterval(() => void this.refreshUpdate(), 30 * 60_000);
    void this.ensureConnected().catch((err) => {
      console.error("auto-connect failed", err);
    });
  }

  private reloadGrokSettings(): GrokSettings {
    const settings = settingsFromToml(loadGrokToml());
    const alwaysApprove = settings.permissionMode === "always-approve";
    this.db.setKv("alwaysApprove", alwaysApprove ? "1" : "0");
    this.patch({
      settings,
      alwaysApprove,
      sessionMode: alwaysApprove
        ? "yolo"
        : settings.permissionMode === "auto"
          ? "auto"
          : this.snapshot.sessionMode === "plan"
            ? "plan"
            : "ask",
    });
    return settings;
  }

  setGrokSetting(key: keyof GrokSettings, value: unknown): GrokSettings {
    if (!isGrokSettingKey(key)) return this.snapshot.settings;
    const table = loadGrokToml();
    applySetting(table, key, value);
    saveGrokToml(table);
    const settings = this.reloadGrokSettings();
    if (key === "defaultModel" && typeof value === "string" && value.trim()) {
      this.db.setKv("lastModelId", value);
      const named = this.snapshot.models.find((model) => model.modelId === value);
      this.patch({ modelId: value, modelName: named?.name ?? value });
      void this.setConfigOption("model", value);
    }
    if (key === "defaultEffort" && typeof value === "string" && value.trim()) {
      this.db.setKv("lastEffort", value);
      this.patch({ effort: value });
      void this.setConfigOption("reasoning_effort", value);
    }
    return settings;
  }

  async setModelEffort(modelId: string, effort?: string): Promise<void> {
    const id = modelId.trim();
    const nextEffort = effort?.trim();
    if (id) {
      this.db.setKv("lastModelId", id);
      const named = this.snapshot.models.find((model) => model.modelId === id);
      this.patch({ modelId: id, modelName: named?.name ?? this.snapshot.modelName });
      await this.setConfigOption("model", id);
    }
    if (nextEffort) {
      this.db.setKv("lastEffort", nextEffort);
      this.patch({ effort: nextEffort });
      await this.setConfigOption("reasoning_effort", nextEffort);
    }
  }

  async refreshUpdate(): Promise<void> {
    if (this.snapshot.update?.applying) return;
    const previous = this.snapshot.update;
    this.patch({
      update: {
        currentVersion: previous?.currentVersion ?? this.snapshot.agentVersion ?? "",
        latestVersion: previous?.latestVersion,
        updateAvailable: previous?.updateAvailable ?? false,
        channel: previous?.channel,
        installer: previous?.installer,
        currentNotes: previous?.currentNotes,
        latestNotes: previous?.latestNotes,
        translatedLog: previous?.translatedLog,
        atRisk: previous?.atRisk ?? [],
        checking: true,
        error: undefined,
      },
    });
    try {
      const info = await checkGrokUpdate(this.grokBinary);
      info.atRisk = collectAtRisk(this.snapshot.sessions, this.snapshot.sessionId, this.snapshot.busy);
      this.patch({ update: { ...info, checking: false } });
    } catch (err) {
      this.patch({
        update: {
          currentVersion: previous?.currentVersion ?? this.snapshot.agentVersion ?? "",
          latestVersion: previous?.latestVersion,
          updateAvailable: previous?.updateAvailable ?? false,
          currentNotes: previous?.currentNotes,
          latestNotes: previous?.latestNotes,
          translatedLog: previous?.translatedLog,
          atRisk: previous?.atRisk ?? [],
          checking: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  async applyGrokUpdate(): Promise<void> {
    const current = this.snapshot.update ?? (await checkGrokUpdate(this.grokBinary));
    const atRisk = collectAtRisk(this.snapshot.sessions, this.snapshot.sessionId, this.snapshot.busy);
    this.patch({ update: { ...current, atRisk, applying: true, checking: false, error: undefined } });
    const resumeId = this.snapshot.sessionId;
    const resumeCwd = this.snapshot.workspace;
    const interruptIds = new Set(atRisk.map((row) => row.sessionId));
    if (resumeId) interruptIds.add(resumeId);
    this.db.markUpdateInterrupted([...interruptIds]);
    try {
      if (this.snapshot.busy) {
        try {
          await this.cancel();
        } catch {
          /* continue */
        }
      }
      await this.stop();
      await installGrokUpdate(this.grokBinary, current.installer);
      this.grokBinary = resolveGrokBinary();
      const info = await checkGrokUpdate(this.grokBinary);
      this.patch({ update: { ...info, applying: true, translating: true, atRisk: [] } });
      try {
        info.translatedLog = await recordTranslatedUpdate(
          this.grokBinary,
          info.currentVersion,
          info.currentNotes || current.latestNotes || current.currentNotes || "",
        );
      } catch (err) {
        console.error("record translated changelog failed", err);
      }
      this.patch({ update: { ...info, applying: false, translating: false, atRisk: [] } });
      await this.ensureConnected();
      await this.loadLocalSessions();
      if (resumeId) {
        await this.openSession(resumeId, resumeCwd);
        this.pushItem({
          id: randomUUID(),
          kind: "system",
          tone: "info",
          text: `Grok Build 已更新到 ${info.currentVersion}。上一轮对话已中断。`,
          at: Date.now(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.patch({
        update: { ...current, atRisk, applying: false, error: message },
      });
      try {
        await this.ensureConnected();
      } catch {
        /* leave connection error */
      }
      await this.loadLocalSessions();
      throw err;
    }
  }

  async dismissInterrupted(sessionId: string): Promise<void> {
    this.db.clearUpdateInterrupted(sessionId);
    await this.loadLocalSessions();
  }

  private desktopNotify(kind: "turn_complete" | "approval_required", body: string): void {
    try {
      const settings = this.snapshot.settings;
      if (settings.notifyMethod === "none" || settings.notifyCondition === "never") return;
      if (kind === "turn_complete" && !settings.notifyTurnComplete) return;
      if (kind === "approval_required" && !settings.notifyApproval) return;
      if (settings.notifyCondition === "unfocused") {
        const focused = BrowserWindow.getAllWindows().some((win) => !win.isDestroyed() && win.isFocused());
        if (focused) return;
      }
      new Notification({ title: "Grok", body }).show();
    } catch (err) {
      console.error("desktop notify failed", err);
    }
  }

  private pushItem(item: TimelineItem): void {
    this.snapshot = { ...this.snapshot, timeline: [...this.snapshot.timeline, item] };
    this.syncDerived();
    this.emit({ type: "timeline", item });
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private patchItem(id: string, patch: Partial<TimelineItem>): void {
    this.snapshot = {
      ...this.snapshot,
      timeline: this.snapshot.timeline.map((item) =>
        item.id === id ? ({ ...item, ...patch } as TimelineItem) : item,
      ),
    };
    this.syncDerived();
    this.emit({ type: "timeline-patch", id, patch });
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private noteTokens(before?: number): void {
    if (this.hydrating) return;
    const after = this.statsCursor.lastTokens;
    if (before == null || after == null || after <= before) return;
    this.db.addTokens(after - before);
  }

  private computeRunStats(): SessionRunStats {
    let tokens = 0;
    let startedAt: number | undefined;
    let lastAt: number | undefined;
    for (const item of this.snapshot.timeline) {
      if ("tokens" in item && item.tokens) tokens += item.tokens;
      if (item.at != null) {
        startedAt = startedAt == null ? item.at : Math.min(startedAt, item.at);
        const end = item.at + ("durationMs" in item && item.durationMs ? item.durationMs : 0);
        lastAt = lastAt == null ? end : Math.max(lastAt, end);
      }
    }
    const turnStartedAt = this.snapshot.busy ? this.snapshot.runStats.turnStartedAt : undefined;
    const endAt = this.snapshot.busy ? Date.now() : lastAt;
    const durationMs = startedAt != null && endAt != null ? Math.max(0, endAt - startedAt) : undefined;
    return { startedAt, turnStartedAt, durationMs, tokens: tokens || undefined };
  }

  private tasksFor(sessionId?: string): BackgroundTask[] {
    if (!sessionId) return [];
    return [...(this.sessionTasks.get(sessionId)?.values() ?? [])];
  }

  private bagFor(sessionId: string): Map<string, BackgroundTask> {
    let bag = this.sessionTasks.get(sessionId);
    if (!bag) {
      bag = new Map();
      this.sessionTasks.set(sessionId, bag);
    }
    return bag;
  }

  private clearLiveTasks(): void {
    this.sessionTasks.clear();
  }

  private applyBackgroundTaskUpdate(
    kind: string,
    update: Record<string, unknown>,
    sessionId?: string,
  ): void {
    const snap = asRecord(update.task_snapshot);
    const owner =
      asString(snap?.owner_session_id) ??
      asString(update.owner_session_id) ??
      sessionId ??
      this.snapshot.sessionId;
    if (!owner) return;

    if (kind === "task_backgrounded") {
      const task = parseBackgroundTask(update);
      if (!task) return;
      const prev = this.bagFor(owner).get(task.id);
      this.bagFor(owner).set(task.id, {
        ...task,
        startedAt: prev?.startedAt ?? task.startedAt,
      });
      const toolCallId = asString(update.tool_call_id) ?? asString(update.toolCallId) ?? task.id;
      const existing = this.snapshot.timeline.find(
        (item): item is Extract<TimelineItem, { kind: "tool" }> =>
          item.kind === "tool" && (item.toolCallId === toolCallId || item.toolCallId === task.id),
      );
      if (existing && !existing.background) {
        this.patchItem(existing.id, { background: true });
        return;
      }
      this.patch({});
      return;
    }

    if (kind === "task_completed") {
      const task = parseBackgroundTask(update);
      const id = task?.id ?? asString(update.task_id) ?? asString(update.taskId);
      if (!id) return;
      const bag = this.sessionTasks.get(owner);
      bag?.delete(id);
      if (bag && bag.size === 0) this.sessionTasks.delete(owner);
      this.patch({});
      return;
    }

    if (kind === "background_tasks") {
      const rows = Array.isArray(update.tasks) ? update.tasks : [];
      if (!rows.length) return;
      const bag = new Map<string, BackgroundTask>();
      for (const row of rows) {
        const task = parseBackgroundTask(row);
        if (task) bag.set(task.id, task);
      }
      if (bag.size) this.sessionTasks.set(owner, bag);
      else this.sessionTasks.delete(owner);
      this.patch({});
    }
  }

  private listBackgroundTasks(): BackgroundTask[] {
    return this.tasksFor(this.snapshot.sessionId);
  }

  private decorateSessions(sessions: SessionSummary[]): SessionSummary[] {
    const currentId = this.snapshot.sessionId;
    const currentTasks = this.listBackgroundTasks();
    return sessions.map((session) => {
      const tasks = session.sessionId === currentId ? currentTasks : this.tasksFor(session.sessionId);
      return {
        ...session,
        running: tasks.length > 0,
        backgroundCount: tasks.length,
      };
    });
  }

  private syncDerived(): void {
    const hadBackground = this.snapshot.backgroundTasks.length > 0;
    const backgroundTasks = this.listBackgroundTasks();
    this.snapshot = {
      ...this.snapshot,
      runStats: this.computeRunStats(),
      backgroundTasks,
      sessions: this.decorateSessions(this.snapshot.sessions),
      tokenUsage: this.db.tokenSummary(),
    };
    if (hadBackground && !backgroundTasks.length && !this.snapshot.busy && this.snapshot.promptQueue.length) {
      void this.drainQueue();
    }
  }

  private fail(message: string): void {
    this.patch({ connection: "error", error: message, busy: false });
  }

  async loadLocalSessions(): Promise<void> {
    const sessions = this.db.mergeSessions(await listLocalSessions(), this.snapshot.sessionId);
    const current = sessions.find((row) => row.sessionId === this.snapshot.sessionId);
    this.patch({
      sessions,
      sessionTitle: current?.title ?? this.snapshot.sessionTitle,
    });
  }

  private sessionManagementBusy = false;

  private saveOrganization(value: SessionOrganization): void {
    const sessionOrganization = normalizeOrganization(value);
    this.db.setKv("sessionOrganization", JSON.stringify(sessionOrganization));
    this.patch({ sessionOrganization });
  }

  saveSessionGroup(id: string | undefined, name: string): void {
    const clean = cleanGroupName(name);
    if (!clean) throw new Error("请输入分组名称");
    const organization = normalizeOrganization(this.snapshot.sessionOrganization);
    if (organization.groups.some((group) => group.id !== id && group.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("已经有同名分组");
    if (id) {
      const group = organization.groups.find((group) => group.id === id);
      if (!group) throw new Error("找不到分组");
      group.name = clean;
    } else {
      const groupId = randomUUID();
      organization.groups.push({ id: groupId, name: clean });
      this.reorderGroups([...this.snapshot.groupOrder, customGroupKey(groupId)]);
    }
    this.saveOrganization(organization);
  }

  removeSessionGroup(id: string): void {
    this.saveOrganization(removeCustomGroup(normalizeOrganization(this.snapshot.sessionOrganization), id));
    const key = customGroupKey(id);
    const sessionOrder = { ...this.snapshot.sessionOrder };
    delete sessionOrder[key];
    const groupOrder = this.snapshot.groupOrder.filter((item) => item !== key);
    const collapsedGroups = this.snapshot.collapsedGroups.filter((item) => item !== key);
    this.writeSidebarPrefs({ sessionOrder, groupOrder, collapsedGroups });
    this.patch({ sessionOrder, groupOrder, collapsedGroups });
  }

  async manageSessions(ids: string[], action: SessionBatchAction, groupId?: string): Promise<SessionBatchResult> {
    if (this.sessionManagementBusy) throw new Error("上一批会话操作还未完成");
    if (!["pin", "unpin", "archive", "unarchive", "move", "delete"].includes(action)) throw new Error("未知会话操作");
    this.sessionManagementBusy = true;
    try {
      await this.loadLocalSessions();
      const requested = [...new Set(ids)].slice(0, 2000);
      const rows = this.snapshot.sessions.filter((row) => requested.includes(row.sessionId) && isMainSession(row));
      const organization = normalizeOrganization(this.snapshot.sessionOrganization);
      if (action === "move" && groupId && !organization.groups.some((group) => group.id === groupId)) throw new Error("目标分组不存在");
      const processedIds: string[] = [];
      const errors: string[] = [];
      let backupPath: string | undefined;
      if (action === "delete") {
        const registered = await activeLocalSessionIds();
        const idle = rows.filter((row) => {
          const tree = collectSessionTree(this.snapshot.sessions, [row.sessionId]);
          const running = tree.some((child) => registered.has(child.sessionId) || child.sessionId === this.loadingSessionId || child.running || (child.sessionId === this.snapshot.sessionId && this.snapshot.busy));
          if (running) errors.push(`${row.title || row.sessionId}：正在运行或加载，已跳过`);
          return !running;
        });
        if (idle.length) {
          // Close an idle loaded session before moving its durable files, so an
          // agent's final persistence on close cannot recreate the removed folder.
          if (this.snapshot.sessionId && idle.some((row) => row.sessionId === this.snapshot.sessionId) && this.client?.connected) {
            try { await this.client.request("session/close", { sessionId: this.snapshot.sessionId }, 8000); } catch { /* optional ACP method */ }
          }
          const result = await retireLocalSessions(collectSessionTree(this.snapshot.sessions, idle.map((row) => row.sessionId)));
          backupPath = result.backupPath;
          errors.push(...result.errors);
          for (const id of result.movedIds) { this.db.deleteFlags(id); delete organization.assignments[id]; }
          processedIds.push(...idle.filter((row) => result.movedIds.includes(row.sessionId)).map((row) => row.sessionId));
          if (this.snapshot.sessionId && result.movedIds.includes(this.snapshot.sessionId)) {
            this.patch({ sessionId: undefined, sessionTitle: undefined, timeline: [], permission: undefined, promptQueue: [], runStats: {} });
          }
          this.saveOrganization(organization);
        }
      } else {
        for (const row of rows) {
          if (action === "pin" || action === "unpin") this.db.setPinned(row.sessionId, action === "pin");
          if (action === "archive" || action === "unarchive") this.db.setArchived(row.sessionId, action === "archive");
          if (action === "move") {
            if (groupId) organization.assignments[row.sessionId] = groupId;
            else delete organization.assignments[row.sessionId];
          }
          processedIds.push(row.sessionId);
        }
        if (action === "move") this.saveOrganization(organization);
      }
      await this.loadLocalSessions();
      return { snapshot: this.getSnapshot(), processedIds, skippedIds: requested.filter((id) => !processedIds.includes(id)), errors, backupPath };
    } finally { this.sessionManagementBusy = false; }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    const clean = sanitizeSessionTitle(title);
    if (!clean) return;
    const known = this.snapshot.sessions.find((row) => row.sessionId === sessionId);
    this.db.setTitle(sessionId, clean);
    await writeSessionTitle(sessionId, clean, known?.cwd);
    if (this.snapshot.sessionId === sessionId) {
      this.patch({ sessionTitle: clean });
    }
    await this.loadLocalSessions();
  }

  async setPinned(sessionId: string, pinned: boolean): Promise<void> {
    this.db.setPinned(sessionId, pinned);
    await this.loadLocalSessions();
  }

  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    this.db.setArchived(sessionId, archived);
    if (archived && this.snapshot.collapsedGroups.includes("__archived__")) {
      this.setCollapsedGroups(this.snapshot.collapsedGroups.filter((key) => key !== "__archived__"));
    }
    await this.loadLocalSessions();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const result = await this.manageSessions([sessionId], "delete");
    if (result.errors.length) throw new Error(result.errors.join("\n"));
  }

  async deleteArchivedSessions(sessionIds?: string[]): Promise<void> {
    const allow = new Set(
      this.snapshot.sessions.filter((session) => session.archived && isMainSession(session)).map((session) => session.sessionId),
    );
    const ids = [
      ...new Set(
        (sessionIds ?? [...allow]).map(String).filter((id) => allow.has(id)),
      ),
    ];
    const result = await this.manageSessions(ids, "delete");
    if (result.errors.length) throw new Error(result.errors.join("\n"));
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.db.setKv("sidebarCollapsed", collapsed ? "1" : "0");
    this.patch({ sidebarCollapsed: collapsed });
  }

  setInspectorOpen(open: boolean): void {
    this.db.setKv("inspectorOpen", open ? "1" : "0");
    this.patch({ inspectorOpen: open });
  }

  setInspectorWidth(width: number): void {
    const inspectorWidth = clampInspectorWidth(width);
    this.db.setKv("inspectorWidth", String(inspectorWidth));
    this.patch({ inspectorWidth });
  }

  setWorkspace(folder: string): void {
    const next = folder.trim();
    this.db.setKv("lastWorkspace", next);
    if (next) this.revealWorkspace(next);
    if (!this.snapshot.sessionId) this.patch({ workspace: next || undefined });
  }

  async beginNewChat(workspace?: string): Promise<void> {
    const nextWorkspace = workspace?.trim() || this.db.getKv("lastWorkspace") || this.snapshot.workspace;
    try {
      await this.ensureConnected();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
    }
    if (nextWorkspace) {
      this.db.setKv("lastWorkspace", nextWorkspace);
      this.revealWorkspace(nextWorkspace);
    }
    this.patch({
      sessionId: undefined,
      sessionTitle: "新对话",
      timeline: [],
      permission: undefined,
      busy: false,
      promptQueue: [],
      error: undefined,
      workspace: nextWorkspace,
      sessionMode: (this.db.getKv("lastMode") as SessionMode | undefined) ?? this.snapshot.sessionMode,
      modelId: this.db.getKv("lastModelId") ?? this.snapshot.modelId,
      effort: this.db.getKv("lastEffort") ?? this.snapshot.effort,
    });
  }

  toggleGroup(cwd: string): void {
    const key = normalizeGroupKey(cwd);
    const set = new Set(this.snapshot.collapsedGroups);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    this.setCollapsedGroups([...set]);
  }

  setCollapsedGroups(keys: string[]): void {
    const collapsedGroups = this.uniqueKeys(keys);
    this.writeSidebarPrefs({ collapsedGroups });
    this.patch({ collapsedGroups });
  }

  setHiddenGroups(keys: string[]): void {
    const hiddenGroups = this.uniqueKeys(keys);
    this.db.setKv("hiddenGroups", JSON.stringify(hiddenGroups));
    this.patch({ hiddenGroups });
  }

  hideWorkspace(key: string): void {
    const id = String(key ?? "").trim();
    if (!id || id === "__pinned__" || id === "__archived__") return;
    this.setHiddenGroups([...this.snapshot.hiddenGroups, id]);
  }

  revealWorkspace(key: string): void {
    const id = String(key ?? "").trim();
    if (!id) return;
    if (!this.snapshot.hiddenGroups.includes(id)) return;
    this.setHiddenGroups(this.snapshot.hiddenGroups.filter((item) => item !== id));
  }

  async deleteWorkspace(cwd: string): Promise<void> {
    const target = cwd.trim();
    if (!target) return;
    const ids = this.snapshot.sessions
      .filter((session) => (session.cwd?.trim() || "(unknown)") === target && isMainSession(session))
      .map((session) => session.sessionId);
    const result = await this.manageSessions(ids, "delete");
    if (result.errors.length) throw new Error(result.errors.join("\n"));
    this.revealWorkspace(target);
    if (this.snapshot.workspace?.trim() === target) {
      this.db.setKv("lastWorkspace", "");
      if (!this.snapshot.sessionId) this.patch({ workspace: undefined });
    }
  }

  setSidebarSort(groupSort?: GroupSort, sessionSort?: SessionSort): void {
    const nextGroup = parseGroupSort(groupSort ?? this.snapshot.groupSort);
    const nextSession = parseSessionSort(sessionSort ?? this.snapshot.sessionSort);
    this.writeSidebarPrefs({ groupSort: nextGroup, sessionSort: nextSession });
    this.patch({ groupSort: nextGroup, sessionSort: nextSession });
  }

  reorderGroups(keys: string[]): void {
    const groupOrder = this.uniqueKeys(keys);
    this.writeSidebarPrefs({ groupSort: "custom", groupOrder });
    this.patch({ groupSort: "custom", groupOrder });
  }

  reorderSessions(groupKey: string, ids: string[]): void {
    const key = normalizeGroupKey(groupKey);
    const sessionOrder = {
      ...this.snapshot.sessionOrder,
      [key]: [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))],
    };
    this.writeSidebarPrefs({ sessionSort: "custom", sessionOrder });
    this.patch({ sessionSort: "custom", sessionOrder });
  }

  reorderSessionsBulk(order: Record<string, string[]>): void {
    const sessionOrder = { ...this.snapshot.sessionOrder };
    for (const [key, ids] of Object.entries(order ?? {})) {
      if (!Array.isArray(ids)) continue;
      sessionOrder[normalizeGroupKey(key)] = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
    }
    this.writeSidebarPrefs({ sessionSort: "custom", sessionOrder });
    this.patch({ sessionSort: "custom", sessionOrder });
  }

  private uniqueKeys(keys: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of keys) {
      const trimmed = String(raw ?? "").trim();
      if (!trimmed) continue;
      const key = normalizeGroupKey(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  }

  private readSidebarPrefs(): {
    collapsedGroups?: string[];
    groupSort?: string;
    sessionSort?: string;
    groupOrder?: string[];
    sessionOrder?: Record<string, string[]>;
  } | undefined {
    return this.db.getJson("sidebarPrefs", undefined);
  }

  private readGroupOrder(): string[] {
    const raw = this.readSidebarPrefs()?.groupOrder ?? this.db.getJson<string[]>("groupOrder", []);
    return this.uniqueKeys(Array.isArray(raw) ? raw : []);
  }

  private readSessionOrder(): Record<string, string[]> {
    const raw = this.readSidebarPrefs()?.sessionOrder ?? this.db.getJson<Record<string, string[]>>("sessionOrder", {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, ids] of Object.entries(raw)) {
      if (!Array.isArray(ids)) continue;
      out[normalizeGroupKey(key)] = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
    }
    return out;
  }

  private readCollapsedGroups(): string[] {
    const fromPrefs = this.readSidebarPrefs()?.collapsedGroups;
    const raw = Array.isArray(fromPrefs) ? fromPrefs : this.db.getJson<string[]>("collapsedGroups", []);
    return this.uniqueKeys(Array.isArray(raw) ? raw : []);
  }

  private readHiddenGroups(): string[] {
    return this.uniqueKeys(this.db.getJson<string[]>("hiddenGroups", []));
  }

  private writeSidebarPrefs(partial: {
    collapsedGroups?: string[];
    groupSort?: GroupSort;
    sessionSort?: SessionSort;
    groupOrder?: string[];
    sessionOrder?: Record<string, string[]>;
  }): void {
    const collapsedGroups = partial.collapsedGroups ?? this.snapshot.collapsedGroups;
    const groupSort = partial.groupSort ?? this.snapshot.groupSort;
    const sessionSort = partial.sessionSort ?? this.snapshot.sessionSort;
    const groupOrder = partial.groupOrder ?? this.snapshot.groupOrder;
    const sessionOrder = partial.sessionOrder ?? this.snapshot.sessionOrder;
    const prefs = { collapsedGroups, groupSort, sessionSort, groupOrder, sessionOrder };
    this.db.setKv("sidebarPrefs", JSON.stringify(prefs));
    this.db.setKv("collapsedGroups", JSON.stringify(collapsedGroups));
    this.db.setKv("groupSort", groupSort);
    this.db.setKv("sessionSort", sessionSort);
    this.db.setKv("groupOrder", JSON.stringify(groupOrder));
    this.db.setKv("sessionOrder", JSON.stringify(sessionOrder));
  }

  async refreshAccount(): Promise<void> {
    if (this.accountRefreshing) return;
    this.accountRefreshing = true;
    try {
      const quota = (await this.fetchUsage()) ?? this.snapshot.account.quota;
      this.patch({
        account: {
          ...this.snapshot.account,
          plan: quota?.plan ?? this.snapshot.account.plan,
          quota,
        },
      });
    } finally {
      this.accountRefreshing = false;
    }
  }

  private async fetchUsage() {
    if (this.client?.connected) {
      const methods = ["_x.ai/billing", "x.ai/billing"];
      for (const method of methods) {
        try {
          const result = await this.client.request(method, {}, 15_000);
          if (result === ABSORBED_BY_STREAM) continue;
          const quota = parseUsagePayload(result);
          if (quota) return quota;
        } catch {
          /* try the next spelling, then HTTP */
        }
      }
    }
    return fetchQuota();
  }

  private ensureConnected(alwaysApprove = this.snapshot.alwaysApprove): Promise<AcpClient> {
    if (this.connectionPromise) return this.connectionPromise;
    const controller = new AbortController();
    this.connectionAbort = controller;
    this.connectionPromise = this.connectAgent(alwaysApprove, controller.signal).finally(() => {
      if (this.connectionAbort === controller) {
        this.connectionPromise = undefined;
        this.connectionAbort = undefined;
      }
    });
    return this.connectionPromise;
  }

  private async connectAgent(alwaysApprove: boolean, signal: AbortSignal): Promise<AcpClient> {
    if (this.client?.connected) {
      this.patch({ connection: "ready", alwaysApprove, error: undefined });
      return this.client;
    }

    this.clearLiveTasks();
    this.patch({
      connection: "starting",
      error: undefined,
      alwaysApprove,
      busy: false,
      permission: undefined,
      backgroundTasks: [],
    });

    const binary = resolveGrokBinary();
    this.grokBinary = binary;
    this.patch({ grokBinary: binary });
    this.serve = await startGrokServe(binary, signal);
    const client = new AcpClient({
      onNotification: (method, params) => this.onNotification(method, params),
      onRequest: (id, method, params) => this.onRequest(id, method, params),
      onError: (err) => this.fail(err.message),
      onClose: (code, reason) => {
        if (this.snapshot.connection === "ready") {
          this.fail(`agent 连接关闭 (${code}) ${reason}`.trim());
        }
      },
    });
    this.client = client;
    await client.connect(this.serve.url);

    const init = asRecord(
      await client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "grok-harness", version: app.getVersion() },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      }),
    );
    const meta = asRecord(init?._meta);
    const modelState = asRecord(meta?.modelState);
    const models: ModelInfo[] = [];
    const available = modelState?.availableModels;
    if (Array.isArray(available)) {
      for (const row of available) {
        const rec = asRecord(row);
        if (!rec) continue;
        const model = parseModel(rec);
        if (model) models.push(model);
      }
    }
    const currentModelId = asString(modelState?.currentModelId) ?? this.snapshot.modelId;
    const currentModel = models.find((model) => model.modelId === currentModelId);

    const auth = asRecord(
      await client.request("authenticate", { methodId: "cached_token" }),
    );
    const authMeta = asRecord(auth?._meta);
    if (signal.aborted) throw new Error("Grok connection cancelled");

    this.patch({
      connection: "ready",
      commands: mergeSlashCommands(parseSlashCommands(meta?.availableCommands), this.snapshot.commands),
      agentVersion: asString(meta?.agentVersion),
      modelId: currentModelId,
      modelName: currentModel?.name,
      effort: this.snapshot.effort ?? currentModel?.defaultEffort,
      models,
      accountEmail: asString(authMeta?.email),
      alwaysApprove,
      account: {
        ...this.snapshot.account,
        email: asString(authMeta?.email) ?? this.snapshot.account.email,
        plan: asString(authMeta?.subscription_tier) ?? this.snapshot.account.plan,
        connection: "ready",
      },
    });
    void this.refreshAccount();
    return client;
  }

  async start(workspace: string, options: boolean | StartOptions | Record<string, unknown> = false): Promise<void> {
    const cwd = resolveWorkspace(workspace);
    const opts: StartOptions =
      typeof options === "boolean"
        ? { workspace: cwd, mode: options ? "yolo" : "ask" }
        : { ...(options as StartOptions), workspace: cwd };
    const mode: SessionMode = opts.mode ?? "ask";
    const alwaysApprove = mode === "yolo";
    this.statsCursor = {};
    this.db.setKv("lastWorkspace", cwd);
    this.revealWorkspace(cwd);
    this.db.setKv("lastMode", mode);
    if (opts.modelId) this.db.setKv("lastModelId", opts.modelId);
    if (opts.effort) this.db.setKv("lastEffort", opts.effort);
    this.patch({
      workspace: cwd,
      sessionId: undefined,
      timeline: [],
      permission: undefined,
      busy: false,
      alwaysApprove,
      sessionMode: mode,
      modelId: opts.modelId ?? this.snapshot.modelId,
      effort: opts.effort ?? this.snapshot.effort,
      error: undefined,
    });
    try {
      const client = await this.ensureConnected(alwaysApprove);
      const created = asRecord(
        await client.request("session/new", {
          cwd,
          mcpServers: [],
          _meta: {
            yoloMode: alwaysApprove,
            autoMode: mode === "auto",
          },
        }),
      );
      const sessionId = asString(created?.sessionId);
      if (!sessionId) throw new Error("session/new 没有返回 sessionId");
      this.db.markRead(sessionId, Date.now());
      const createdMeta = asRecord(created?._meta);
      this.patch({
        connection: "ready",
        sessionId,
        workspace: cwd,
        alwaysApprove,
        sessionMode: mode,
        sessionTitle: "新会话",
        commands: mergeSlashCommands(
          this.snapshot.commands,
          parseSlashCommands(created?.availableCommands),
          parseSlashCommands(createdMeta?.availableCommands),
        ),
      });
      const modelId = opts.modelId ?? this.snapshot.modelId;
      if (modelId) {
        await this.setConfigOption("model", modelId);
        const named = this.snapshot.models.find((model) => model.modelId === modelId);
        this.patch({ modelId, modelName: named?.name ?? this.snapshot.modelName });
      }
      const effort = opts.effort ?? this.snapshot.effort;
      if (effort) {
        await this.setConfigOption("reasoning_effort", effort);
        this.patch({ effort });
      }
      await this.loadLocalSessions();
    } catch (err) {
      await this.stop();
      this.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async setConfigOption(configId: string, value: string): Promise<void> {
    const client = this.client;
    const sessionId = this.snapshot.sessionId;
    if (!client?.connected || !sessionId || !value) return;
    try {
      await client.request("session/set_config_option", {
        sessionId,
        configId,
        value: { value },
      });
    } catch (err) {
      console.error(`set_config_option ${configId} failed`, err);
    }
  }

  async refreshConnection(): Promise<void> {
    await this.ensureConnected();
    await this.refreshAccount();
  }

  async stop(): Promise<void> {
    const connecting = this.connectionPromise;
    this.connectionAbort?.abort();
    for (const waiter of this.permissionWaiters.values()) waiter.resolve(null);
    this.permissionWaiters.clear();
    this.client?.close();
    this.client = undefined;
    await stopGrokServe(this.serve?.child);
    await connecting?.catch(() => undefined);
    this.serve = undefined;
    this.clearLiveTasks();
    if (this.snapshot.connection !== "error") {
      this.patch({
        connection: "stopped",
        busy: false,
        permission: undefined,
        sessionId: undefined,
      });
    } else {
      this.patch({ busy: false, permission: undefined, sessionId: undefined });
    }
  }

  async searchMentions(query: string): Promise<MentionHit[]> {
    const q = query.trim().toLowerCase();
    const hits: MentionHit[] = [];
    const currentId = this.snapshot.sessionId;
    const sessions = this.snapshot.sessions
      .filter((session) => session.sessionId !== currentId && !session.archived)
      .filter((session) => {
        if (!q) return true;
        const hay = `${session.title ?? ""} ${session.cwd ?? ""} ${session.sessionId}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
    for (const session of sessions) {
      hits.push({
        id: `session:${session.sessionId}`,
        kind: "session",
        label: session.title || "未命名对话",
        detail: session.cwd ? cwdLabel(session.cwd) : session.sessionId.slice(0, 8),
        sessionId: session.sessionId,
        cwd: session.cwd,
      });
    }
    const workspace = this.snapshot.workspace?.trim();
    if (workspace) {
      const files = await searchWorkspaceFiles(workspace, query, 12);
      hits.push(...files);
    }
    return hits;
  }

  private mergeQueued(base: QueuedPrompt, extra: QueuedPrompt): QueuedPrompt {
    const seen = new Set(base.attachments.map((item) => item.path));
    const attachments = [...base.attachments];
    for (const item of extra.attachments) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      attachments.push(item);
    }
    const refs = [...base.sessionRefs];
    for (const ref of extra.sessionRefs) {
      if (refs.some((item) => item.sessionId === ref.sessionId)) continue;
      refs.push(ref);
    }
    return {
      ...base,
      text: [base.text, extra.text].map((part) => part.trim()).filter(Boolean).join("\n\n"),
      attachments,
      sessionRefs: refs,
      combined: true,
    };
  }

  enqueueFollowUp(text: string, attachments: PromptAttachment[] = [], sessionRefs: SessionRef[] = []): void {
    const item: QueuedPrompt = {
      id: randomUUID(),
      text: text.trim(),
      attachments,
      sessionRefs,
      mode: this.snapshot.settings.followUpBehavior === "steer" ? "steer" : "queue",
    };
    if (!item.text && !item.attachments.length && !item.sessionRefs.length) return;
    let queue = [...this.snapshot.promptQueue];
    const last = queue[queue.length - 1];
    if (this.snapshot.settings.combineQueuedPrompts && last) {
      queue[queue.length - 1] = this.mergeQueued(last, item);
    } else {
      queue.push(item);
    }
    this.patch({ promptQueue: queue });
    if (this.snapshot.settings.followUpBehavior === "steer") {
      const latest = queue[queue.length - 1];
      if (latest) void this.injectSteer(latest);
    }
  }

  removeQueued(id: string): void {
    this.patch({ promptQueue: this.snapshot.promptQueue.filter((item) => item.id !== id) });
  }

  async sendQueuedNow(id?: string): Promise<void> {
    const queue = this.snapshot.promptQueue;
    const item = id ? queue.find((row) => row.id === id) : queue[0];
    if (!item) return;
    this.patch({ promptQueue: queue.filter((row) => row.id !== item.id) });
    if (this.snapshot.busy) {
      try {
        await this.cancel();
      } catch {
        /* send anyway */
      }
    }
    await this.sendPrompt(item.text, item.attachments, item.sessionRefs, { now: true });
  }

  private async injectSteer(item: QueuedPrompt): Promise<void> {
    const client = this.client;
    const sessionId = this.snapshot.sessionId;
    if (!client?.connected || !sessionId) return;
    const { blocks } = await buildPromptBlocks({
      text: item.text,
      attachments: item.attachments,
      sessionNotes: [],
    });
    if (!blocks.length) return;
    const payloads: Array<{ method: string; params: JsonValue }> = [
      { method: "_session/steering", params: { sessionId, prompt: blocks as unknown as JsonValue } },
      { method: "x.ai/session/steer", params: { sessionId, prompt: blocks as unknown as JsonValue } },
    ];
    for (const payload of payloads) {
      try {
        await client.request(payload.method, payload.params, 8_000);
        this.patch({ promptQueue: this.snapshot.promptQueue.filter((row) => row.id !== item.id) });
        return;
      } catch {
        /* try next */
      }
    }
  }

  private async drainQueue(): Promise<void> {
    if (this.drainingQueue) return;
    this.drainingQueue = true;
    try {
      while (!this.snapshot.busy && !this.snapshot.backgroundTasks.length && this.snapshot.promptQueue.length) {
        const queue = this.snapshot.promptQueue;
        if (this.snapshot.settings.combineQueuedPrompts && queue.length > 1) {
          const merged = queue.reduce((acc, item) => this.mergeQueued(acc, item));
          this.patch({ promptQueue: [] });
          await this.sendPrompt(merged.text, merged.attachments, merged.sessionRefs, { now: true });
          continue;
        }
        const next = queue[0];
        this.patch({ promptQueue: queue.slice(1) });
        await this.sendPrompt(next.text, next.attachments, next.sessionRefs, { now: true });
      }
    } finally {
      this.drainingQueue = false;
    }
  }

  async sendPrompt(
    text: string,
    attachments: PromptAttachment[] = [],
    sessionRefs: SessionRef[] = [],
    opts: { now?: boolean } = {},
  ): Promise<void> {
    if (this.snapshot.busy && !opts.now) {
      this.enqueueFollowUp(text, attachments, sessionRefs);
      return;
    }
    const epoch = ++this.promptEpoch;
    this.ignoreUpdates = false;
    const client = this.client;
    const sessionId = this.snapshot.sessionId;
    if (!client || !sessionId) throw new Error("还没有就绪的会话");
    const trimmed = text.trim();
    const files: PromptAttachment[] = [];
    const seen = new Set<string>();
    for (const row of attachments) {
      const item = await inspectPath(row.path);
      if (!item || seen.has(item.path)) continue;
      seen.add(item.path);
      files.push({ ...item, preview: row.preview ?? item.preview });
    }
    if (!trimmed && !files.length && !sessionRefs.length) return;

    const firstTurn = !this.snapshot.timeline.some((item) => item.kind === "user");
    const planPrefix =
      this.snapshot.sessionMode === "plan" && firstTurn && !trimmed.startsWith("/") ? "/plan " : "";
    const sessionNotes: string[] = [];
    for (const ref of sessionRefs.slice(0, 5)) {
      const note = await this.formatSessionNote(ref);
      if (note) sessionNotes.push(note);
    }
    const { blocks, hasImages } = await buildPromptBlocks({
      text: `${planPrefix}${trimmed}`,
      attachments: files,
      sessionNotes,
    });
    if (!blocks.length) return;

    this.pushItem({
      id: randomUUID(),
      kind: "user",
      text: trimmed,
      at: Date.now(),
      attachments: files,
      sessionRefs: sessionRefs.slice(0, 5),
    });
    if (sessionId) {
      this.db.markRead(sessionId, Date.now());
      this.db.clearInterrupted(sessionId);
    }
    this.patch({ busy: true, runStats: { ...this.snapshot.runStats, turnStartedAt: Date.now() } });
    try {
      const sendBlocks = async (prompt: typeof blocks) =>
        client.request("session/prompt", { sessionId, prompt }, 15 * 60_000);
      let result: JsonValue | typeof ABSORBED_BY_STREAM;
      try {
        result = await sendBlocks(blocks);
      } catch (err) {
        if (!hasImages) throw err;
        result = await sendBlocks(blocks.filter((block) => block.type !== "image"));
      }
      if (epoch !== this.promptEpoch) return;
      if (result !== ABSORBED_BY_STREAM) {
        this.finishStreaming();
      }
    } catch (err) {
      if (epoch !== this.promptEpoch) return;
      this.pushItem({
        id: randomUUID(),
        kind: "system",
        tone: "error",
        text: err instanceof Error ? err.message : String(err),
      });
      this.finishStreaming();
      throw err;
    } finally {
      if (epoch !== this.promptEpoch) return;
      this.patch({ busy: false });
      this.desktopNotify("turn_complete", "本轮已完成");
      if (!this.drainingQueue) void this.drainQueue();
    }
  }

  private async formatSessionNote(ref: SessionRef): Promise<string | undefined> {
    const known = this.snapshot.sessions.find((session) => session.sessionId === ref.sessionId);
    const title = ref.title || known?.title || "未命名对话";
    const cwd = ref.cwd || known?.cwd;
    const items = await loadSessionTranscript(ref.sessionId, cwd);
    const lines: string[] = [];
    for (const item of items) {
      if (item.kind === "user" && item.text.trim()) lines.push(`User: ${item.text.trim()}`);
      if (item.kind === "assistant" && item.text.trim()) lines.push(`Grok: ${item.text.trim()}`);
    }
    let body = lines.join("\n\n");
    if (body.length > 8000) body = `…\n${body.slice(-8000)}`;
    const header = `Referenced conversation: ${title}\nSession: ${ref.sessionId}${cwd ? `\nWorkspace: ${cwd}` : ""}`;
    return body ? `${header}\n\n${body}` : header;
  }

  async cancel(): Promise<void> {
    const wasBusy = this.snapshot.busy;
    this.promptEpoch += 1;
    this.ignoreUpdates = true;
    if (wasBusy) {
      const started = this.snapshot.runStats.turnStartedAt;
      this.snapshot = {
        ...this.snapshot,
        timeline: this.snapshot.timeline.map((item) => {
          if ((item.kind === "thought" || item.kind === "assistant") && item.streaming) {
            return { ...item, streaming: false, interrupted: true };
          }
          if (
            item.kind === "tool" &&
            !item.background &&
            (item.status === "pending" || item.status === "in_progress")
          ) {
            return { ...item, status: "cancelled", interrupted: true };
          }
          return item;
        }),
      };
      this.pushItem({
        id: randomUUID(),
        kind: "interrupt",
        at: Date.now(),
        durationMs: started != null ? Math.max(0, Date.now() - started) : undefined,
      });
      if (this.snapshot.sessionId) {
        this.db.markInterrupted([this.snapshot.sessionId]);
        await this.loadLocalSessions();
      }
    }
    this.patch({ busy: false, permission: undefined });
    const client = this.client;
    const sessionId = this.snapshot.sessionId;
    if (!client?.connected || !sessionId) return;
    try {
      await client.request("session/cancel", { sessionId }, 8_000);
    } catch {
      /* agent 可能已经停了 */
    }
  }

  resolvePermission(requestId: string, optionId: string | null): void {
    const waiter = this.permissionWaiters.get(requestId);
    if (!waiter) return;
    this.permissionWaiters.delete(requestId);
    this.patch({ permission: undefined });
    waiter.resolve(optionId);
  }

  async openSession(sessionId: string, cwd?: string): Promise<void> {
    // Selecting the current row must not cancel the turn or reload its live view.
    if ((sessionId === this.snapshot.sessionId && this.snapshot.busy) || this.loadingSessionId === sessionId) return;
    const loadEpoch = ++this.sessionLoadEpoch;
    this.loadingSessionId = sessionId;
    if (this.snapshot.busy) {
      try {
        await this.cancel();
      } catch {
        /* continue */
      }
    }
    if (loadEpoch !== this.sessionLoadEpoch) return;
    const known = this.snapshot.sessions.find((row) => row.sessionId === sessionId);
    const workspace = cwd || known?.cwd;
    this.db.markRead(sessionId, Math.max(Date.now(), known?.updatedAtMs ?? 0));
    this.ignoreUpdates = false;
    this.hydrating = true;
    this.hydrationUpdates = [];
    const eventIds = new Set<string>();
    const timeline = await loadSessionTranscript(sessionId, workspace, eventIds);
    if (loadEpoch !== this.sessionLoadEpoch) return;
    this.seenSessionEventIds = eventIds;
    this.statsCursor = {};
    this.patch({
      workspace,
      sessionId,
      sessionTitle: known?.title ?? "未命名对话",
      timeline,
      permission: undefined,
      busy: false,
      promptQueue: [],
      error: undefined,
      sessions: this.snapshot.sessions.map((row) =>
        row.sessionId === sessionId ? { ...row, unread: false } : row,
      ),
    });
    try {
      const client = await this.ensureConnected();
      if (loadEpoch !== this.sessionLoadEpoch) return;
      try {
        const loaded = asRecord(
          await client.request("session/load", {
            sessionId,
            mcpServers: [],
            ...(workspace ? { cwd: workspace } : {}),
          }),
        );
        if (loadEpoch !== this.sessionLoadEpoch) return;
        const loadedMeta = asRecord(loaded?._meta);
        // A running agent can append output while session/load replays history.
        // Re-read the durable log, then apply only buffered events absent from it.
        const latestEventIds = new Set<string>();
        const latestTimeline = await loadSessionTranscript(sessionId, workspace, latestEventIds);
        if (loadEpoch !== this.sessionLoadEpoch) return;
        this.seenSessionEventIds = latestEventIds;
        this.patch({
          connection: "ready",
          sessionId: asString(loaded?.sessionId) ?? sessionId,
          workspace: workspace ?? this.snapshot.workspace,
          sessionTitle: known?.title ?? this.snapshot.sessionTitle,
          timeline: latestTimeline,
          commands: mergeSlashCommands(
            this.snapshot.commands,
            parseSlashCommands(loaded?.availableCommands),
            parseSlashCommands(loadedMeta?.availableCommands),
          ),
        });
      } finally {
        if (loadEpoch === this.sessionLoadEpoch) {
          this.hydrating = false;
          const updates = this.hydrationUpdates;
          this.hydrationUpdates = [];
          for (const row of updates) this.applySessionUpdate(row.update, row.meta, row.sessionId);
        }
      }
    } catch (err) {
      if (loadEpoch !== this.sessionLoadEpoch) return;
      this.hydrating = false;
      this.hydrationUpdates = [];
      this.fail(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      if (loadEpoch !== this.sessionLoadEpoch) return;
      this.loadingSessionId = undefined;
      this.db.markRead(sessionId, Date.now());
      await this.loadLocalSessions();
    }
  }

  async refreshSessions(): Promise<void> {
    await this.loadLocalSessions();
  }

  private finishStreaming(): void {
    this.snapshot = {
      ...this.snapshot,
      timeline: this.snapshot.timeline.map((item) =>
        "streaming" in item && item.streaming ? { ...item, streaming: false } : item,
      ),
      busy: false,
    };
    this.syncDerived();
    this.emit({ type: "snapshot", snapshot: this.snapshot });
  }

  private touch(item: { at?: number; durationMs?: number; tokens?: number }, at?: number, totalTokens?: number): void {
    const before = this.statsCursor.lastTokens;
    touchStats(item, at, totalTokens, this.statsCursor);
    this.noteTokens(before);
  }

  private onNotification(method: string, params: JsonValue | undefined): void {
    if (
      method === "session/update" ||
      method === "_x.ai/session/update" ||
      method === "x.ai/session/update"
    ) {
      const rec = asRecord(params) ?? {};
      const update = asRecord(rec.update) ?? rec;
      this.applySessionUpdate(update, asRecord(rec._meta), asString(rec.sessionId));
      return;
    }
    if (/^(?:_x\.ai|x\.ai)\/session\/prompt_complete$/.test(method)) {
      const rec = asRecord(params) ?? {};
      this.applySessionUpdate({
        sessionUpdate: "turn_completed",
        stop_reason: rec.stopReason,
        agent_result: rec.agentResult,
      }, asRecord(rec._meta), asString(rec.sessionId));
      return;
    }
    if (method.startsWith("x.ai/") || method.startsWith("_x.ai/")) {
      return;
    }
  }

  private applySessionUpdate(
    update: Record<string, unknown>,
    envelopeMeta?: Record<string, unknown>,
    sessionId?: string,
  ): void {
    const kind = asString(update.sessionUpdate);
    if (kind === "task_backgrounded" || kind === "task_completed" || kind === "background_tasks") {
      if (!this.hydrating) this.applyBackgroundTaskUpdate(kind, update, sessionId);
      return;
    }
    if (sessionId && sessionId !== this.snapshot.sessionId) return;
    if (this.hydrating) {
      this.hydrationUpdates.push({ update, meta: envelopeMeta, sessionId });
      return;
    }
    const eventId = asString(envelopeMeta?.eventId);
    if (eventId) {
      if (this.seenSessionEventIds.has(eventId)) return;
      this.seenSessionEventIds.add(eventId);
    }
    const stats = readEventStats(update, envelopeMeta, Date.now());
    if (this.ignoreUpdates && !this.hydrating) {
      if (kind === "available_commands" || kind === "available_commands_update") {
        this.patch({
          commands: mergeSlashCommands(
            this.snapshot.commands,
            parseSlashCommands(update.availableCommands ?? update.commands ?? update),
          ),
        });
      }
      return;
    }
    if (kind === "turn_completed") {
      const reason = asString(update.stop_reason) ?? asString(update.stopReason);
      if (reason === "error") {
        this.pushItem({ id: randomUUID(), kind: "system", tone: "error", text: asString(update.agent_result) ?? asString(update.agentResult) ?? "Grok 本轮执行失败" });
      }
      this.finishStreaming();
      return;
    }
    if ((kind === "agent_message_chunk" || kind === "agent_thought_chunk" || kind === "tool_call") && !this.snapshot.busy) {
      this.patch({ busy: true, runStats: { ...this.snapshot.runStats, turnStartedAt: Date.now() } });
    }
    if (kind === "user_message_chunk") {
      const text = normalizeUserText(collectText(update.content ?? update));
      if (!text) return;
      if (this.snapshot.timeline.some((item) => item.kind === "user" && item.text === text)) return;
      const last = [...this.snapshot.timeline].reverse().find((item) => item.kind === "user");
      if (last && last.kind === "user") {
        if ((last.attachments?.length || last.sessionRefs?.length) && !last.text) return;
        if (text.startsWith(last.text) || last.text.startsWith(text)) {
          if (text.length > last.text.length) this.patchItem(last.id, { text });
          return;
        }
      }
      this.pushItem({ id: randomUUID(), kind: "user", text, at: Date.now() });
      return;
    }
    if (kind === "agent_message_chunk" || kind === "agent_message") {
      const text = collectText(update.content ?? update);
      this.appendStreaming("assistant", text, stats.at, stats.totalTokens);
      return;
    }
    if (kind === "agent_thought_chunk" || kind === "agent_thought") {
      const text = collectText(update.content ?? update);
      this.appendStreaming("thought", text, stats.at, stats.totalTokens);
      return;
    }
    if (kind === "tool_call") {
      const toolCallId = asString(update.toolCallId) ?? randomUUID();
      const existing = this.snapshot.timeline.find(
        (item): item is Extract<TimelineItem, { kind: "tool" }> =>
          item.kind === "tool" && item.toolCallId === toolCallId,
      );
      const diffs = collectDiffs(update.content);
      const outputText = collectOutput(update.content);
      if (existing) {
        this.touch(existing, stats.at, stats.totalTokens);
        this.patchItem(existing.id, {
          title: asString(update.title) ?? existing.title,
          status: asString(update.status) ?? existing.status,
          toolKind: asString(update.kind) ?? existing.toolKind,
          rawInput: update.rawInput ?? existing.rawInput,
          diffs: diffs.length ? diffs : existing.diffs,
          outputText: outputText ?? existing.outputText,
          durationMs: existing.durationMs,
          tokens: existing.tokens,
          at: existing.at,
          background:
            existing.background ||
            looksBackground(outputText) ||
            looksBackground(asString(update.title) ?? existing.title),
        });
      } else {
        const item = {
          id: randomUUID(),
          kind: "tool" as const,
          toolCallId,
          title: asString(update.title) ?? asString(update.toolName) ?? "tool",
          status: asString(update.status) ?? "pending",
          toolKind: asString(update.kind) ?? asString(update.toolName),
          rawInput: update.rawInput,
          diffs,
          outputText,
          at: stats.at ?? Date.now(),
        };
        this.touch(item, stats.at, stats.totalTokens);
        this.pushItem({
          ...item,
          background: looksBackground(outputText) || looksBackground(item.title),
        });
      }
      return;
    }
    if (kind === "tool_call_update") {
      const toolCallId = asString(update.toolCallId);
      if (!toolCallId) return;
      const existing = this.snapshot.timeline.find(
        (item) => item.kind === "tool" && item.toolCallId === toolCallId,
      );
      if (!existing || existing.kind !== "tool") return;
      const diffs = collectDiffs(update.content);
      const outputText = collectOutput(update.content);
      this.touch(existing, stats.at, stats.totalTokens);
      this.patchItem(existing.id, {
        status: asString(update.status) ?? existing.status,
        title: asString(update.title) ?? existing.title,
        diffs: diffs.length ? diffs : existing.diffs,
        outputText: outputText ?? existing.outputText,
        rawInput: update.rawInput ?? existing.rawInput,
        durationMs: existing.durationMs,
        tokens: existing.tokens,
        at: existing.at,
        background:
          existing.background ||
          looksBackground(outputText) ||
          looksBackground(asString(update.title) ?? existing.title),
      });
      return;
    }
    if (kind === "available_commands" || kind === "available_commands_update") {
      this.patch({
        commands: mergeSlashCommands(
          this.snapshot.commands,
          parseSlashCommands(update.availableCommands ?? update.commands ?? update),
        ),
      });
      return;
    }
    if (kind === "plan") {
      const text =
        typeof update.entries === "string"
          ? update.entries
          : JSON.stringify(update.entries ?? update, null, 2);
      const existing = [...this.snapshot.timeline].reverse().find((item) => item.kind === "plan");
      if (existing) this.patchItem(existing.id, { text });
      else this.pushItem({ id: randomUUID(), kind: "plan", text, at: Date.now() });
    }
  }

  private appendStreaming(
    kind: "assistant" | "thought",
    text: string,
    at?: number,
    totalTokens?: number,
  ): void {
    if (!text) return;
    const last = this.snapshot.timeline[this.snapshot.timeline.length - 1];
    if (last && last.kind === kind && last.streaming) {
      this.touch(last, at, totalTokens);
      this.patchItem(last.id, {
        text: last.text + text,
        streaming: true,
        durationMs: last.durationMs,
        tokens: last.tokens,
        at: last.at,
      });
      return;
    }
    this.snapshot = {
      ...this.snapshot,
      timeline: this.snapshot.timeline.map((item) =>
        (item.kind === "assistant" || item.kind === "thought") && item.streaming
          ? { ...item, streaming: false }
          : item,
      ),
    };
    const item = { id: randomUUID(), kind, text, streaming: true, at: at ?? Date.now() };
    this.touch(item, at, totalTokens);
    this.pushItem(item);
  }

  private async onRequest(
    _id: number | string,
    method: string,
    params: JsonValue | undefined,
  ): Promise<JsonValue> {
    if (method === "session/request_permission") {
      return this.handlePermission(params);
    }
    if (method === "x.ai/folder_trust/request") {
      return { trusted: true, outcome: "allow" };
    }
    throw new Error(`未处理的反向请求: ${method}`);
  }

  private async handlePermission(params: JsonValue | undefined): Promise<JsonValue> {
    const rec = asRecord(params) ?? {};
    const toolCall = asRecord(rec.toolCall) ?? {};
    const rawOptions = Array.isArray(rec.options) ? rec.options : [];
    const options: PermissionOption[] = [];
    for (const row of rawOptions) {
      const opt = asRecord(row);
      const optionId = asString(opt?.optionId);
      if (!optionId) continue;
      options.push({
        optionId,
        name: asString(opt?.name) ?? optionId,
        kind: asString(opt?.kind),
      });
    }

    if (this.snapshot.alwaysApprove) {
      const allow =
        options.find((o) => /allow/i.test(o.kind ?? "") || /allow/i.test(o.optionId)) ??
        options[0];
      if (allow) {
        return { outcome: { outcome: "selected", optionId: allow.optionId } };
      }
    }

    const request: PermissionRequest = {
      requestId: randomUUID(),
      sessionId: asString(rec.sessionId) ?? this.snapshot.sessionId ?? "",
      title: asString(toolCall.title) ?? asString(toolCall.toolName) ?? "需要批准",
      toolKind: asString(toolCall.kind),
      toolCallId: asString(toolCall.toolCallId),
      rawInput: toolCall.rawInput ?? rec.rawInput,
      options,
    };
    this.patch({ permission: request });
    this.desktopNotify("approval_required", request.title);

    const optionId = await new Promise<string | null>((resolve) => {
      this.permissionWaiters.set(request.requestId, { resolve });
    });
    if (!optionId) {
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId } };
  }
}
