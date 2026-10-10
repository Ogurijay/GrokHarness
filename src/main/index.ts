import { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, shell } from "electron";
import { basename, extname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AgentHost } from "./agent-host";
import { listSessionSubagents } from "./session-store";
import { readSubagentView } from "./subagents";
import { DesktopController } from "./desktop";
import { DESKTOP_RELEASES, GROK_INSTALL_GUIDE } from "../shared/desktop";
import { copyImageToClipboard, imageDataUrl, inspectPaths, saveAudioBytes, saveClipboardImage } from "./attachments";
import { isGrokSettingKey } from "../shared/grok-settings";
import type { GroupSort, MediaKind, PromptAttachment, SessionMode, SessionRef, SessionSort } from "../shared/types";
import {
  deleteMediaAsset,
  exportMediaFile,
  isAllowedMediaPath,
  listMediaLibrary,
  pathFromMediaUrl,
  saveTranscript,
} from "./media-library";

const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) {
  mkdirSync(profileDirectory, { recursive: true });
  app.setPath("userData", profileDirectory);
}
if (!app.requestSingleInstanceLock()) app.exit(0);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "grok-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

const host = new AgentHost();
const desktop = new DesktopController();
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  if (!shutdownPromise) {
    quitting = true;
    desktop.dispose();
    shutdownPromise = host.stop().finally(() => { shutdownComplete = true; });
  }
  return shutdownPromise;
}

function hasActiveWork(): boolean {
  const state = host.getSnapshot();
  return state.busy || state.backgroundTasks.length > 0 || state.sessions.some((session) => session.running);
}

app.on("second-instance", () => { if (app.isReady()) showWindow(); });

function iconDir(): string {
  return join(app.getAppPath(), "resources");
}

function windowIconFile(): string {
  return join(iconDir(), "icon.png");
}

function trayIconFile(): string {
  return join(iconDir(), process.platform === "win32" ? "icon.ico" : "icon.png");
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createMenu(): void {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" as const }] : []),
      { role: "editMenu" },
      ...(isMac ? [{ role: "windowMenu" as const }] : []),
    ]),
  );
}

function createTray(): void {
  const image = nativeImage.createFromPath(trayIconFile());
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 }));
  tray.setToolTip("Grok-Harness");
  tray.on("click", () => showWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示窗口", click: () => showWindow() },
      { label: "桌面应用与更新", click: () => {
        showWindow();
        mainWindow?.webContents.send("desktop:open");
      } },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
}

function createWindow(): void {
  const icon = nativeImage.createFromPath(windowIconFile());
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff",
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "win32" ? {
      color: nativeTheme.shouldUseDarkColors ? "#181818" : "#ffffff",
      symbolColor: nativeTheme.shouldUseDarkColors ? "#dfdfdf" : "#1a1c1f",
      height: 44,
    } : undefined,
    autoHideMenuBar: process.platform !== "darwin",
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: "Grok-Harness",
    show: false,
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const syncWindowTheme = () => {
    const dark = nativeTheme.shouldUseDarkColors;
    mainWindow?.setBackgroundColor(dark ? "#181818" : "#ffffff");
    if (process.platform === "win32") mainWindow?.setTitleBarOverlay({ color: dark ? "#181818" : "#ffffff", symbolColor: dark ? "#dfdfdf" : "#1a1c1f", height: 44 });
  };
  nativeTheme.on("updated", syncWindowTheme);
  ipcMain.handle("window:setTheme", (_event, theme: unknown) => {
    if (theme !== "system" && theme !== "light" && theme !== "dark") return;
    nativeTheme.themeSource = theme;
    syncWindowTheme();
  });
  if (process.platform === "win32") app.setAppUserModelId("ai.x.grok-harness");
  protocol.handle("grok-media", (request) => {
    try {
      const filePath = pathFromMediaUrl(request.url);
      if (!filePath || !isAllowedMediaPath(filePath)) {
        return new Response("forbidden", { status: 403, statusText: "Forbidden" });
      }
      return net.fetch(pathToFileURL(filePath).href);
    } catch {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
  });
  createMenu();
  await desktop.init();
  await host.initLocal();
  createTray();
  createWindow();

  host.onEvent((event) => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send("grok:event", event);
  });

  let hadCredentials = desktop.getState().cli.authenticated;
  desktop.onChange((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("desktop:state", state);
    if (state.cli.authenticated && !hadCredentials) void host.refreshConnection().catch(() => undefined);
    hadCredentials = state.cli.authenticated;
  });
  ipcMain.handle("desktop:getState", () => desktop.getState());
  ipcMain.handle("desktop:refresh", async () => {
    const state = await desktop.checkCli();
    if (state.cli.installed && state.cli.authenticated) await host.refreshConnection().catch(() => undefined);
    return state;
  });
  ipcMain.handle("desktop:chooseBinary", async () => {
    if (hasActiveWork()) throw new Error("请等待当前对话和后台任务结束后再切换 Grok 程序。");
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择官方 grok.exe", properties: ["openFile"], filters: [{ name: "Grok CLI", extensions: ["exe"] }],
    });
    if (result.canceled || !result.filePaths[0]) return desktop.getState();
    const state = await desktop.useBinary(result.filePaths[0]);
    if (state.cli.installed) {
      await host.stop();
      if (state.cli.authenticated) await host.refreshConnection().catch(() => undefined);
    }
    return state;
  });
  ipcMain.handle("desktop:login", () => desktop.login());
  ipcMain.handle("desktop:cancelLogin", () => desktop.cancelLogin());
  ipcMain.handle("desktop:checkUpdate", () => desktop.checkUpdate());
  ipcMain.handle("desktop:downloadUpdate", () => desktop.downloadUpdate());
  ipcMain.handle("desktop:installUpdate", async () => {
    if (hasActiveWork()) throw new Error("请等待当前对话和后台任务结束后再重启更新。");
    if (desktop.getState().update.phase !== "downloaded") return;
    await shutdown();
    desktop.installUpdate();
  });
  ipcMain.handle("desktop:openLink", (_event, link: unknown) => {
    if (link !== "releases" && link !== "install") return false;
    void shell.openExternal(link === "releases" ? DESKTOP_RELEASES : GROK_INSTALL_GUIDE);
    return true;
  });

  ipcMain.handle("grok:getState", () => host.getSnapshot());
  ipcMain.handle("grok:pickFolder", async () => {
    const win = mainWindow;
    const options: Electron.OpenDialogOptions = {
      title: "选择工作目录",
      properties: ["openDirectory"],
    };
    const result =
      win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });
  ipcMain.handle("grok:start", async (_evt, workspace: string, options?: unknown) => {
    if (options && typeof options === "object") {
      const rec = options as Record<string, unknown>;
      await host.start(String(workspace), {
        workspace: String(workspace),
        mode: rec.mode as "ask" | "auto" | "yolo" | "plan" | undefined,
        modelId: typeof rec.modelId === "string" ? rec.modelId : undefined,
        effort: typeof rec.effort === "string" ? rec.effort : undefined,
      });
    } else {
      await host.start(String(workspace), Boolean(options));
    }
    return host.getSnapshot();
  });
  ipcMain.handle("grok:beginNewChat", async (_evt, workspace?: string) => {
    await host.beginNewChat(workspace ? String(workspace) : undefined);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setWorkspace", (_evt, folder: string) => {
    host.setWorkspace(String(folder ?? ""));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setInspectorWidth", (_evt, width: number) => {
    host.setInspectorWidth(Number(width));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:send", async (_evt, text: string, attachments?: unknown, sessionRefs?: unknown, now?: unknown) => {
    const files = Array.isArray(attachments)
      ? (attachments as PromptAttachment[]).filter((row) => row && typeof row.path === "string")
      : [];
    const refs = Array.isArray(sessionRefs)
      ? (sessionRefs as SessionRef[]).filter((row) => row && typeof row.sessionId === "string")
      : [];
    await host.sendPrompt(String(text ?? ""), files, refs, { now: Boolean(now) });
    return host.getSnapshot();
  });
  ipcMain.handle("grok:removeQueued", (_evt, id: string) => {
    host.removeQueued(String(id ?? ""));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:sendQueuedNow", async (_evt, id?: unknown) => {
    await host.sendQueuedNow(typeof id === "string" && id ? id : undefined);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:pickFiles", async () => {
    const win = mainWindow;
    const options: Electron.OpenDialogOptions = {
      title: "添加文件",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "全部文件", extensions: ["*"] },
        { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] },
        { name: "音频", extensions: ["wav", "mp3", "m4a", "aac", "ogg", "webm", "flac"] },
      ],
    };
    const result =
      win && !win.isDestroyed()
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return [];
    return inspectPaths(result.filePaths);
  });
  ipcMain.handle("grok:inspectPaths", async (_evt, paths: unknown) => {
    const list = Array.isArray(paths) ? paths.map(String) : [];
    return inspectPaths(list);
  });
  ipcMain.handle("grok:saveClipboardImage", () => saveClipboardImage() ?? null);
  ipcMain.handle("grok:saveAudio", (_evt, payload: unknown, mime?: unknown, ext?: unknown) => {
    const raw =
      payload instanceof ArrayBuffer
        ? new Uint8Array(payload)
        : payload instanceof Uint8Array
          ? payload
          : Array.isArray(payload)
            ? Uint8Array.from(payload as number[])
            : undefined;
    if (!raw?.byteLength) return null;
    return saveAudioBytes(raw, String(mime || "audio/webm"), String(ext || "webm"));
  });
  ipcMain.handle("grok:searchMentions", async (_evt, query: unknown) => {
    return host.searchMentions(String(query ?? ""));
  });
  ipcMain.handle("grok:cancel", async () => {
    await host.cancel();
    return host.getSnapshot();
  });
  ipcMain.handle("grok:permission", (_evt, requestId: string, optionId: string | null) => {
    host.resolvePermission(String(requestId), optionId);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:openSession", async (_evt, sessionId: string, cwd?: string) => {
    await host.openSession(String(sessionId), cwd ? String(cwd) : undefined);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:loadSession", async (_evt, sessionId: string, cwd?: string) => {
    await host.openSession(String(sessionId), cwd ? String(cwd) : undefined);
    return host.getSnapshot();
  });
  // Read-only child views never call session/load or change the active prompt.
  ipcMain.handle("grok:listSubagents", (_evt, sessionId: string) => listSessionSubagents(String(sessionId)));
  ipcMain.handle("grok:readSubagent", (_evt, parentSessionId: string, subagentId: string) => readSubagentView(String(parentSessionId), String(subagentId)));
  ipcMain.handle("grok:refreshSessions", async () => {
    await host.refreshSessions();
    return host.getSnapshot();
  });
  ipcMain.handle("grok:manageSessions", async (_evt, ids: unknown, action: unknown, groupId?: unknown) => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("会话选择无效");
    return host.manageSessions(ids, action as import("../shared/types").SessionBatchAction, typeof groupId === "string" ? groupId : undefined);
  });
  ipcMain.handle("grok:saveSessionGroup", (_evt, id: unknown, name: unknown) => {
    host.saveSessionGroup(typeof id === "string" ? id : undefined, String(name ?? ""));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:removeSessionGroup", (_evt, id: unknown) => {
    host.removeSessionGroup(String(id));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:renameSession", async (_evt, sessionId: string, title: string) => {
    await host.renameSession(String(sessionId), String(title ?? ""));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:pinSession", async (_evt, sessionId: string, pinned: boolean) => {
    await host.setPinned(String(sessionId), Boolean(pinned));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:archiveSession", async (_evt, sessionId: string, archived: boolean) => {
    await host.setArchived(String(sessionId), Boolean(archived));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:deleteSession", async (_evt, sessionId: string) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["删除", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "删除会话",
      message: "删除这个本地会话？",
      detail: "会话及其子代理记录将移到 .grok/session-cleanup-backups，保留可恢复备份。不会删除云端历史或项目文件。运行中的会话会跳过。",
    };
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (result.response !== 0) return host.getSnapshot();
    await host.deleteSession(String(sessionId));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:deleteArchivedSessions", async (_evt, sessionIds?: unknown) => {
    const archived = host.getSnapshot().sessions.filter((session) => session.archived);
    const allow = new Set(archived.map((session) => session.sessionId));
    const explicit = Array.isArray(sessionIds);
    const selected = explicit ? sessionIds.map(String).filter((id) => allow.has(id)) : [];
    const requested = explicit ? selected : [...allow];
    const count = requested.length;
    if (!count) return host.getSnapshot();
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["删除", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "删除已归档会话",
      message: explicit
        ? `删除已选的 ${count} 个本地已归档会话？`
        : `删除全部 ${count} 个本地已归档会话？`,
      detail: "保留可恢复备份到 .grok/session-cleanup-backups，云端历史不受影响。运行中的会话会跳过。",
    };
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (result.response !== 0) return host.getSnapshot();
    await host.deleteArchivedSessions(requested);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setSidebarCollapsed", (_evt, collapsed: boolean) => {
    host.setSidebarCollapsed(Boolean(collapsed));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setInspectorOpen", (_evt, open: boolean) => {
    host.setInspectorOpen(Boolean(open));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:toggleGroup", (_evt, cwd: string) => {
    host.toggleGroup(String(cwd));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setCollapsedGroups", (_evt, keys: string[]) => {
    host.setCollapsedGroups(Array.isArray(keys) ? keys.map(String) : []);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:hideWorkspace", (_evt, key: string) => {
    host.hideWorkspace(String(key ?? ""));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:revealWorkspace", (_evt, key: string) => {
    host.revealWorkspace(String(key ?? ""));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:deleteWorkspace", async (_evt, cwd: string) => {
    const target = String(cwd ?? "").trim();
    if (!target) return host.getSnapshot();
    const count = host.getSnapshot().sessions.filter((session) => (session.cwd?.trim() || "(unknown)") === target).length;
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["删除", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "删除工作区",
      message: "删除这个工作区的全部会话？",
      detail: `将删除 ${count} 个本地会话，并保留备份到 .grok/session-cleanup-backups。云端历史和项目文件夹不受影响，运行中的会话会跳过。`,
    };
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (result.response !== 0) return host.getSnapshot();
    await host.deleteWorkspace(target);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setSidebarSort", (_evt, groupSort?: unknown, sessionSort?: unknown) => {
    host.setSidebarSort(groupSort as GroupSort | undefined, sessionSort as SessionSort | undefined);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:reorderGroups", (_evt, keys: string[]) => {
    host.reorderGroups(Array.isArray(keys) ? keys.map(String) : []);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:reorderSessions", (_evt, groupKey: string, ids: string[]) => {
    host.reorderSessions(String(groupKey ?? ""), Array.isArray(ids) ? ids.map(String) : []);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:reorderSessionsBulk", (_evt, order: Record<string, string[]>) => {
    host.reorderSessionsBulk(order && typeof order === "object" ? order : {});
    return host.getSnapshot();
  });
  ipcMain.handle("grok:refreshAccount", async () => {
    await host.refreshAccount();
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setAlwaysApprove", (_evt, value: boolean) => {
    host.setAlwaysApprove(Boolean(value));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setSessionMode", (_evt, mode: string) => {
    const next: SessionMode =
      mode === "auto" || mode === "yolo" || mode === "plan" || mode === "ask" ? mode : "ask";
    host.setSessionMode(next);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setGrokSetting", (_evt, key: string, value: unknown) => {
    if (isGrokSettingKey(key)) host.setGrokSetting(key, value);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:setModelEffort", async (_evt, modelId: string, effort?: string) => {
    await host.setModelEffort(String(modelId ?? ""), effort ? String(effort) : undefined);
    return host.getSnapshot();
  });
  ipcMain.handle("grok:checkUpdate", async () => {
    await host.refreshUpdate();
    return host.getSnapshot();
  });
  ipcMain.handle("grok:applyUpdate", async () => {
    try {
      await host.applyGrokUpdate();
    } catch (err) {
      console.error("apply grok update failed", err);
    }
    return host.getSnapshot();
  });
  ipcMain.handle("grok:dismissInterrupted", async (_evt, sessionId: string) => {
    await host.dismissInterrupted(String(sessionId));
    return host.getSnapshot();
  });
  ipcMain.handle("grok:copyText", (_evt, text: string) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  ipcMain.handle("grok:copyImage", (_evt, source: string) => {
    return copyImageToClipboard(String(source ?? ""));
  });
  ipcMain.handle("grok:imageDataUrl", (_evt, source: string) => {
    return imageDataUrl(String(source ?? "")) ?? null;
  });
  ipcMain.handle("grok:imageMenu", (_evt, source: string) => {
    const path = String(source ?? "");
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const menu = Menu.buildFromTemplate([
      {
        label: "复制图片",
        click: () => {
          copyImageToClipboard(path);
        },
      },
      {
        label: "复制路径",
        click: () => clipboard.writeText(path),
      },
      { type: "separator" },
      {
        label: "打开文件",
        click: () => {
          void shell.openPath(path);
        },
      },
    ]);
    menu.popup({ window: win });
    return true;
  });
  ipcMain.handle("grok:openPath", async (_evt, folder: string) => {
    const target = String(folder ?? "").trim();
    if (!target) return { ok: false, error: "没有可打开的路径" };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle("grok:listMedia", async (_evt, kind?: unknown) => {
    const filter: MediaKind | undefined =
      kind === "image" || kind === "video" || kind === "voice" ? kind : undefined;
    return listMediaLibrary(host.localDb(), filter);
  });
  ipcMain.handle("grok:recordMediaPrompt", (_evt, kind: unknown, prompt: unknown, sessionId?: unknown) => {
    if (kind !== "image" && kind !== "video" && kind !== "voice") return false;
    host.localDb().addPendingPrompt(kind, String(prompt ?? ""), typeof sessionId === "string" ? sessionId : undefined);
    return true;
  });
  ipcMain.handle("grok:saveTranscript", async (_evt, text: unknown, prompt?: unknown) => {
    return saveTranscript(host.localDb(), String(text ?? ""), typeof prompt === "string" ? prompt : undefined);
  });
  ipcMain.handle("grok:deleteMedia", async (_evt, id: unknown) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["删除", "取消"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "删除资源",
      message: "从资源库删除这个文件？",
      detail: "会删除磁盘上的生成文件，无法恢复。",
    };
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (result.response !== 0) return { ok: false };
    return deleteMediaAsset(host.localDb(), String(id ?? ""));
  });
  ipcMain.handle("grok:exportMedia", async (_evt, path: unknown, name?: unknown) => {
    const src = String(path ?? "");
    if (!src || !isAllowedMediaPath(src)) return { ok: false, error: "找不到文件" };
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const fileName = typeof name === "string" && name.trim() ? name.trim() : basename(src);
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: fileName })
      : await dialog.showSaveDialog({ defaultPath: fileName });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      await exportMediaFile(src, result.filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle("grok:revealMedia", (_evt, path: unknown) => {
    const target = String(path ?? "");
    if (!target || !isAllowedMediaPath(target)) return false;
    shell.showItemInFolder(target);
    return true;
  });
  ipcMain.handle("grok:copyMedia", async (_evt, path: unknown) => {
    const src = String(path ?? "");
    if (!src || !isAllowedMediaPath(src)) return false;
    const ext = extname(src).slice(1).toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return copyImageToClipboard(src);
    clipboard.writeText(src);
    return true;
  });

  app.on("activate", () => showWindow());
});

app.on("window-all-closed", () => {
  /* keep tray */
});

app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  void shutdown().finally(() => app.quit());
});
