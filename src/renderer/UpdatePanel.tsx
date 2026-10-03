import { Dialog } from "./ui/Dialog";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GrokUpdateInfo } from "../shared/types";

export function UpdatePanel({
  update,
  onClose,
  onApply,
}: {
  update?: GrokUpdateInfo;
  onClose: () => void;
  onApply: () => void;
}) {
  const available = Boolean(update?.updateAvailable);
  const notes = available ? update?.latestNotes || update?.currentNotes : update?.currentNotes;
  const atRisk = update?.atRisk ?? [];
  const busyRisk = atRisk.some((row) => row.busy);
  return (
    <Dialog title="Grok Build 更新" className="changelog-panel" onClose={onClose}>
        <p className="settings-lead">
          {available
            ? `Grok Build ${update?.currentVersion} → ${update?.latestVersion}`
            : `当前 Grok Build ${update?.currentVersion || "—"}`}
          {update?.channel ? ` · ${update.channel}` : ""}
        </p>
        {update?.checking ? <p className="settings-lead">正在检查更新…</p> : null}
        {update?.translating ? <p className="settings-lead">正在用 Grok Build 翻译本次更新说明…</p> : null}
        {update?.error ? <div className="error-banner">{update.error}</div> : null}
        {available && atRisk.length > 0 ? (
          <section className="settings-section risk-box">
            <h3>{busyRisk ? "当前对话进行中，更新会立刻中断" : "更新会中断这些会话"}</h3>
            <ul className="risk-list">
              {atRisk.map((row) => (
                <li key={row.sessionId}>
                  <strong>{row.title}</strong>
                  {row.busy ? <em>进行中</em> : null}
                  {row.cwd ? <span>{row.cwd}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {update?.translatedLog ? (
          <section className="settings-section changelog-body">
            <h3>中文更新日志</h3>
            <div className="md changelog-md">
              <Markdown remarkPlugins={[remarkGfm]}>{update.translatedLog}</Markdown>
            </div>
          </section>
        ) : null}
        <section className="settings-section changelog-body">
          <h3>{available ? `Grok Build ${update?.latestVersion}` : "本机版本"}</h3>
          {available && update?.latestNotes ? (
            <div className="md changelog-md">
              <Markdown remarkPlugins={[remarkGfm]}>{update.latestNotes}</Markdown>
            </div>
          ) : available ? (
            <>
              <p className="settings-lead">还没有拉到 {update?.latestVersion} 的远程说明。下面是本机 {update?.currentVersion} 的日志。</p>
              {update?.currentNotes ? (
                <div className="md changelog-md">
                  <Markdown remarkPlugins={[remarkGfm]}>{update.currentNotes}</Markdown>
                </div>
              ) : null}
            </>
          ) : notes ? (
            <div className="md changelog-md">
              <Markdown remarkPlugins={[remarkGfm]}>{notes}</Markdown>
            </div>
          ) : (
            <p className="settings-lead">没有找到这一版的更新说明。</p>
          )}
        </section>
        {available ? (
          <div className="changelog-actions">
            <button className="btn ghost" type="button" onClick={onClose} disabled={update?.applying}>
              稍后
            </button>
            <button className="btn danger" type="button" onClick={onApply} disabled={update?.applying}>
              {update?.translating
                ? "正在翻译…"
                : update?.applying
                  ? "正在更新…"
                  : busyRisk || atRisk.length
                    ? "中断并更新"
                    : "立即更新"}
            </button>
          </div>
        ) : null}
    </Dialog>
  );
}
