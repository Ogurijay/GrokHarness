import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentUiEvent,
  AppSnapshot,
  GroupSort,
  MediaAsset,
  MediaKind,
  MentionHit,
  PromptAttachment,
  SessionMode,
  SessionRef,
  SessionSort,
  StartOptions,
} from "../shared/types";
import type { GrokSettings } from "../shared/grok-settings";
import type { DesktopState } from "../shared/desktop";

export type GrokApi = {
  windowControls: {
    platform: string;
    setTheme: (theme: "system" | "light" | "dark") => Promise<void>;
  };
  desktop: {
    getState: () => Promise<DesktopState>;
    refresh: () => Promise<DesktopState>;
    chooseBinary: () => Promise<DesktopState>;
    login: () => Promise<DesktopState>;
    cancelLogin: () => Promise<DesktopState>;
    checkUpdate: () => Promise<DesktopState>;
    downloadUpdate: () => Promise<DesktopState>;
    installUpdate: () => Promise<void>;
    openLink: (link: "releases" | "install") => Promise<boolean>;
    onState: (cb: (state: DesktopState) => void) => () => void;
    onOpen: (cb: () => void) => () => void;
  };
  getState: () => Promise<AppSnapshot>;
  pickFolder: () => Promise<string | null>;
  start: (workspace: string, options?: boolean | StartOptions) => Promise<AppSnapshot>;
  beginNewChat: (workspace?: string) => Promise<AppSnapshot>;
  setWorkspace: (folder: string) => Promise<AppSnapshot>;
  setInspectorWidth: (width: number) => Promise<AppSnapshot>;
  send: (text: string, attachments?: PromptAttachment[], sessionRefs?: SessionRef[], now?: boolean) => Promise<AppSnapshot>;
  removeQueued: (id: string) => Promise<AppSnapshot>;
  sendQueuedNow: (id?: string) => Promise<AppSnapshot>;
  pickFiles: () => Promise<PromptAttachment[]>;
  inspectPaths: (paths: string[]) => Promise<PromptAttachment[]>;
  saveClipboardImage: () => Promise<PromptAttachment | null>;
  saveAudio: (bytes: ArrayBuffer, mime?: string, ext?: string) => Promise<PromptAttachment | null>;
  searchMentions: (query: string) => Promise<MentionHit[]>;
  cancel: () => Promise<AppSnapshot>;
  permission: (requestId: string, optionId: string | null) => Promise<AppSnapshot>;
  loadSession: (sessionId: string, cwd?: string) => Promise<AppSnapshot>;
  openSession: (sessionId: string, cwd?: string) => Promise<AppSnapshot>;
  refreshSessions: () => Promise<AppSnapshot>;
  renameSession: (sessionId: string, title: string) => Promise<AppSnapshot>;
  pinSession: (sessionId: string, pinned: boolean) => Promise<AppSnapshot>;
  archiveSession: (sessionId: string, archived: boolean) => Promise<AppSnapshot>;
  deleteSession: (sessionId: string) => Promise<AppSnapshot>;
  deleteArchivedSessions: (sessionIds?: string[]) => Promise<AppSnapshot>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<AppSnapshot>;
  setInspectorOpen: (open: boolean) => Promise<AppSnapshot>;
  toggleGroup: (cwd: string) => Promise<AppSnapshot>;
  setCollapsedGroups: (keys: string[]) => Promise<AppSnapshot>;
  hideWorkspace: (key: string) => Promise<AppSnapshot>;
  revealWorkspace: (key: string) => Promise<AppSnapshot>;
  deleteWorkspace: (cwd: string) => Promise<AppSnapshot>;
  setSidebarSort: (groupSort?: GroupSort, sessionSort?: SessionSort) => Promise<AppSnapshot>;
  reorderGroups: (keys: string[]) => Promise<AppSnapshot>;
  reorderSessions: (groupKey: string, ids: string[]) => Promise<AppSnapshot>;
  reorderSessionsBulk: (order: Record<string, string[]>) => Promise<AppSnapshot>;
  refreshAccount: () => Promise<AppSnapshot>;
  setAlwaysApprove: (value: boolean) => Promise<AppSnapshot>;
  setSessionMode: (mode: SessionMode) => Promise<AppSnapshot>;
  setGrokSetting: (key: keyof GrokSettings, value: unknown) => Promise<AppSnapshot>;
  setModelEffort: (modelId: string, effort?: string) => Promise<AppSnapshot>;
  checkUpdate: () => Promise<AppSnapshot>;
  applyUpdate: () => Promise<AppSnapshot>;
  dismissInterrupted: (sessionId: string) => Promise<AppSnapshot>;
  copyText: (text: string) => Promise<boolean>;
  copyImage: (source: string) => Promise<boolean>;
  imageDataUrl: (source: string) => Promise<string | null>;
  imageMenu: (source: string) => Promise<boolean>;
  openPath: (folder: string) => Promise<{ ok: boolean; error?: string }>;
  listMedia: (kind?: MediaKind) => Promise<MediaAsset[]>;
  recordMediaPrompt: (kind: MediaKind, prompt: string, sessionId?: string) => Promise<boolean>;
  saveTranscript: (text: string, prompt?: string) => Promise<MediaAsset>;
  deleteMedia: (id: string) => Promise<{ ok: boolean; error?: string }>;
  exportMedia: (path: string, name?: string) => Promise<{ ok: boolean; error?: string }>;
  revealMedia: (path: string) => Promise<boolean>;
  copyMedia: (path: string) => Promise<boolean>;
  onEvent: (cb: (event: AgentUiEvent) => void) => () => void;
};

const api: GrokApi = {
  windowControls: {
    platform: process.platform,
    setTheme: (theme) => ipcRenderer.invoke("window:setTheme", theme),
  },
  desktop: {
    getState: () => ipcRenderer.invoke("desktop:getState"),
    refresh: () => ipcRenderer.invoke("desktop:refresh"),
    chooseBinary: () => ipcRenderer.invoke("desktop:chooseBinary"),
    login: () => ipcRenderer.invoke("desktop:login"),
    cancelLogin: () => ipcRenderer.invoke("desktop:cancelLogin"),
    checkUpdate: () => ipcRenderer.invoke("desktop:checkUpdate"),
    downloadUpdate: () => ipcRenderer.invoke("desktop:downloadUpdate"),
    installUpdate: () => ipcRenderer.invoke("desktop:installUpdate"),
    openLink: (link) => ipcRenderer.invoke("desktop:openLink", link),
    onState: (cb) => {
      const listener = (_event: unknown, state: DesktopState) => cb(state);
      ipcRenderer.on("desktop:state", listener);
      return () => ipcRenderer.removeListener("desktop:state", listener);
    },
    onOpen: (cb) => {
      ipcRenderer.on("desktop:open", cb);
      return () => ipcRenderer.removeListener("desktop:open", cb);
    },
  },
  getState: () => ipcRenderer.invoke("grok:getState"),
  pickFolder: () => ipcRenderer.invoke("grok:pickFolder"),
  start: (workspace, options) => ipcRenderer.invoke("grok:start", workspace, options),
  beginNewChat: (workspace) => ipcRenderer.invoke("grok:beginNewChat", workspace),
  setWorkspace: (folder) => ipcRenderer.invoke("grok:setWorkspace", folder),
  setInspectorWidth: (width) => ipcRenderer.invoke("grok:setInspectorWidth", width),
  send: (text, attachments, sessionRefs, now) => ipcRenderer.invoke("grok:send", text, attachments, sessionRefs, now),
  removeQueued: (id) => ipcRenderer.invoke("grok:removeQueued", id),
  sendQueuedNow: (id) => ipcRenderer.invoke("grok:sendQueuedNow", id),
  pickFiles: () => ipcRenderer.invoke("grok:pickFiles"),
  inspectPaths: (paths) => ipcRenderer.invoke("grok:inspectPaths", paths),
  saveClipboardImage: () => ipcRenderer.invoke("grok:saveClipboardImage"),
  saveAudio: (bytes, mime, ext) => ipcRenderer.invoke("grok:saveAudio", bytes, mime, ext),
  searchMentions: (query) => ipcRenderer.invoke("grok:searchMentions", query),
  cancel: () => ipcRenderer.invoke("grok:cancel"),
  permission: (requestId, optionId) => ipcRenderer.invoke("grok:permission", requestId, optionId),
  loadSession: (sessionId, cwd) => ipcRenderer.invoke("grok:loadSession", sessionId, cwd),
  openSession: (sessionId, cwd) => ipcRenderer.invoke("grok:openSession", sessionId, cwd),
  refreshSessions: () => ipcRenderer.invoke("grok:refreshSessions"),
  renameSession: (sessionId, title) => ipcRenderer.invoke("grok:renameSession", sessionId, title),
  pinSession: (sessionId, pinned) => ipcRenderer.invoke("grok:pinSession", sessionId, pinned),
  archiveSession: (sessionId, archived) => ipcRenderer.invoke("grok:archiveSession", sessionId, archived),
  deleteSession: (sessionId) => ipcRenderer.invoke("grok:deleteSession", sessionId),
  deleteArchivedSessions: (sessionIds) => ipcRenderer.invoke("grok:deleteArchivedSessions", sessionIds),
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke("grok:setSidebarCollapsed", collapsed),
  setInspectorOpen: (open) => ipcRenderer.invoke("grok:setInspectorOpen", open),
  toggleGroup: (cwd) => ipcRenderer.invoke("grok:toggleGroup", cwd),
  setCollapsedGroups: (keys) => ipcRenderer.invoke("grok:setCollapsedGroups", keys),
  hideWorkspace: (key) => ipcRenderer.invoke("grok:hideWorkspace", key),
  revealWorkspace: (key) => ipcRenderer.invoke("grok:revealWorkspace", key),
  deleteWorkspace: (cwd) => ipcRenderer.invoke("grok:deleteWorkspace", cwd),
  setSidebarSort: (groupSort, sessionSort) => ipcRenderer.invoke("grok:setSidebarSort", groupSort, sessionSort),
  reorderGroups: (keys) => ipcRenderer.invoke("grok:reorderGroups", keys),
  reorderSessions: (groupKey, ids) => ipcRenderer.invoke("grok:reorderSessions", groupKey, ids),
  reorderSessionsBulk: (order) => ipcRenderer.invoke("grok:reorderSessionsBulk", order),
  refreshAccount: () => ipcRenderer.invoke("grok:refreshAccount"),
  setAlwaysApprove: (value) => ipcRenderer.invoke("grok:setAlwaysApprove", value),
  setSessionMode: (mode) => ipcRenderer.invoke("grok:setSessionMode", mode),
  setGrokSetting: (key, value) => ipcRenderer.invoke("grok:setGrokSetting", key, value),
  setModelEffort: (modelId, effort) => ipcRenderer.invoke("grok:setModelEffort", modelId, effort),
  checkUpdate: () => ipcRenderer.invoke("grok:checkUpdate"),
  applyUpdate: () => ipcRenderer.invoke("grok:applyUpdate"),
  dismissInterrupted: (sessionId) => ipcRenderer.invoke("grok:dismissInterrupted", sessionId),
  copyText: (text) => ipcRenderer.invoke("grok:copyText", text),
  copyImage: (source) => ipcRenderer.invoke("grok:copyImage", source),
  imageDataUrl: (source) => ipcRenderer.invoke("grok:imageDataUrl", source),
  imageMenu: (source) => ipcRenderer.invoke("grok:imageMenu", source),
  openPath: (folder) => ipcRenderer.invoke("grok:openPath", folder),
  listMedia: (kind) => ipcRenderer.invoke("grok:listMedia", kind),
  recordMediaPrompt: (kind, prompt, sessionId) => ipcRenderer.invoke("grok:recordMediaPrompt", kind, prompt, sessionId),
  saveTranscript: (text, prompt) => ipcRenderer.invoke("grok:saveTranscript", text, prompt),
  deleteMedia: (id) => ipcRenderer.invoke("grok:deleteMedia", id),
  exportMedia: (path, name) => ipcRenderer.invoke("grok:exportMedia", path, name),
  revealMedia: (path) => ipcRenderer.invoke("grok:revealMedia", path),
  copyMedia: (path) => ipcRenderer.invoke("grok:copyMedia", path),
  onEvent: (cb) => {
    const listener = (_event: unknown, payload: AgentUiEvent) => cb(payload);
    ipcRenderer.on("grok:event", listener);
    return () => ipcRenderer.removeListener("grok:event", listener);
  },
};

contextBridge.exposeInMainWorld("grok", api);

declare global {
  interface Window {
    grok: GrokApi;
  }
}
