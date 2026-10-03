import { useEffect, useRef, useState } from "react";
import { Dialog } from "./ui/Dialog";
import { CheckCircle2, Download, ExternalLink, FolderOpen, LogIn, RefreshCw, RotateCw, X } from "lucide-react";
import type { DesktopState } from "../shared/desktop";
import "./desktop.css";

export function DesktopPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const [state, setState] = useState<DesktopState>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const initial = useRef(true);
  const openCallback = useRef(onOpen);
  openCallback.current = onOpen;

  useEffect(() => {
    const receive = (next: DesktopState) => {
      setState(next);
      if (initial.current && !next.cli.checking) {
        initial.current = false;
        if (!next.cli.installed || !next.cli.authenticated) openCallback.current();
      }
    };
    const unsubscribe = window.grok.desktop.onState(receive);
    const unsubscribeOpen = window.grok.desktop.onOpen(() => openCallback.current());
    void window.grok.desktop.getState().then(receive).catch(() => setError("无法读取桌面应用状态。"));
    return () => { unsubscribe(); unsubscribeOpen(); };
  }, []);

  const run = async (action: () => Promise<DesktopState | void | boolean>) => {
    setPending(true); setError("");
    try {
      const next = await action();
      if (next && typeof next === "object") setState(next);
    } catch { setError("操作未完成，请确认当前对话已结束后重试。"); }
    finally { setPending(false); }
  };
  if (!open) return null;
  const cli = state?.cli;
  const update = state?.update;
  const updating = update?.phase === "checking" || update?.phase === "downloading";
  return (
    <Dialog title="Grok-Harness" className="desktop-panel" closeLabel="关闭桌面应用面板" onClose={onClose}>
        <p className="settings-lead">桌面应用 {state ? `v${state.version}` : ""}</p>
        <section className="desktop-section">
          <div className="desktop-row"><h3>Grok Build</h3><span className={`desktop-status ${cli?.installed ? "ready" : ""}`}>{cli?.checking ? "检查中" : cli?.installed ? `v${cli.version}` : "未安装"}</span></div>
          {cli?.binary && <div className="desktop-path" title={cli.binary}>{cli.binary}</div>}
          <div className="desktop-row desktop-auth"><span>账户</span><span>{cli?.loggingIn ? "等待浏览器登录" : cli?.authenticated ? <><CheckCircle2 size={15} /> 已保存登录凭据</> : "未登录"}</span></div>
          {cli?.error && <p className="desktop-error" role="alert">{cli.error}</p>}
          <div className="desktop-actions">
            {!cli?.installed && <button onClick={() => void run(() => window.grok.desktop.openLink("install"))} disabled={pending}><ExternalLink size={16} />安装 Grok CLI</button>}
            <button onClick={() => void run(window.grok.desktop.chooseBinary)} disabled={pending || cli?.loggingIn}><FolderOpen size={16} />选择程序</button>
            {cli?.installed && (cli.loggingIn ? <button onClick={() => void run(window.grok.desktop.cancelLogin)} disabled={pending}><X size={16} />取消登录</button> : <button className="primary" onClick={() => void run(window.grok.desktop.login)} disabled={pending}><LogIn size={16} />{cli.authenticated ? "重新登录" : "浏览器登录"}</button>)}
            <button className="desktop-icon" title="重新检查 Grok 与账户" aria-label="重新检查 Grok 与账户" onClick={() => void run(window.grok.desktop.refresh)} disabled={pending || cli?.checking}><RefreshCw size={16} /></button>
          </div>
        </section>
        <section className="desktop-section">
          <div className="desktop-row"><h3>应用更新</h3><span className="desktop-status">{update?.latestVersion ? `发行版 v${update.latestVersion}` : "GitHub Releases"}</span></div>
          <p className="desktop-update" aria-live="polite">{update?.phase === "checking" ? "正在检查应用更新" : update?.phase === "available" ? `发现 v${update.latestVersion}` : update?.phase === "downloading" ? `正在下载 ${Math.round(update.percent || 0)}%` : update?.phase === "downloaded" ? "更新已下载，等待重启安装" : update?.error || update?.message || "尚未检查"}</p>
          {update?.phase === "downloading" && <progress max={100} value={update.percent || 0} aria-label="应用更新下载进度" />}
          <div className="desktop-actions">
            <button onClick={() => void run(window.grok.desktop.checkUpdate)} disabled={pending || updating || update?.phase === "downloaded"}><RefreshCw size={16} />检查更新</button>
            {update?.phase === "available" && state?.packaged && <button className="primary" onClick={() => void run(window.grok.desktop.downloadUpdate)} disabled={pending}><Download size={16} />下载更新</button>}
            {update?.phase === "downloaded" && <button className="primary" onClick={() => void run(window.grok.desktop.installUpdate)} disabled={pending}><RotateCw size={16} />重启安装</button>}
            <button className="desktop-icon" title="打开 GitHub 发行页" aria-label="打开 GitHub 发行页" onClick={() => void run(() => window.grok.desktop.openLink("releases"))} disabled={pending}><ExternalLink size={16} /></button>
          </div>
        </section>
        {error && <p className="desktop-error" role="alert">{error}</p>}
    </Dialog>
  );
}
