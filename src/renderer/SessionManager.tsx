import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, CheckSquare, Folder, FolderPlus, Pin, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { AppSnapshot, SessionBatchAction, SessionSummary } from "../shared/types";
import { isMainSession, normalizeGroupKey } from "../shared/types";
import { customGroupKey, sessionCustomGroup } from "../shared/session-organization";
import { Dialog } from "./ui/Dialog";

function title(row: SessionSummary) { return row.title || "未命名对话"; }
function folderLabel(cwd?: string) { return cwd?.split(/[/\\]/).filter(Boolean).pop() || "未知目录"; }

export function SessionManager({ state, onState, onClose, initialIds = [], initialGroup = "__all__" }: {
  state: AppSnapshot; onState: (next: AppSnapshot) => void; onClose: () => void; initialIds?: string[]; initialGroup?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(initialGroup);
  const [selected, setSelected] = useState(new Set(initialIds));
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [pending, setPending] = useState(false);
  const [deleteReview, setDeleteReview] = useState(false);
  const [groupReview, setGroupReview] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [backup, setBackup] = useState<string>();
  const rows = useMemo(() => state.sessions.filter(isMainSession), [state.sessions]);
  const organization = state.sessionOrganization ?? { groups: [], assignments: {} };
  const groups = useMemo(() => {
    const rank = new Map(state.groupOrder.map((key, index) => [key, index]));
    return [...(state.sessionOrganization?.groups ?? [])].sort((a, b) => (rank.get(customGroupKey(a.id)) ?? 1e6) - (rank.get(customGroupKey(b.id)) ?? 1e6));
  }, [state.groupOrder, state.sessionOrganization]);
  const activeGroup = groups.find((group) => customGroupKey(group.id) === filter);
  const workspaces = useMemo(() => [...new Set(rows.map((row) => row.cwd || "(unknown)"))].sort((a, b) => folderLabel(a).localeCompare(folderLabel(b), "zh-CN", { numeric: true })), [rows]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matching = rows.filter((row) => {
      const groupId = sessionCustomGroup(row, state.sessionOrganization);
      if (filter === "__archived__" && !row.archived) return false;
      if (filter === "__workspaces__" && groupId) return false;
      if (filter.startsWith("__custom__:") && customGroupKey(groupId || "") !== filter) return false;
      if (filter.startsWith("workspace:") && (row.cwd || "(unknown)") !== filter.slice(10)) return false;
      const groupName = state.sessionOrganization?.groups.find((group) => group.id === groupId)?.name || "";
      return !needle || `${title(row)} ${row.cwd || ""} ${groupName} ${row.sessionId}`.toLocaleLowerCase().includes(needle);
    });
    const orderKey = filter.startsWith("workspace:") ? normalizeGroupKey(filter.slice(10)) : filter;
    const order = state.sessionOrder[orderKey] ?? [];
    const rank = new Map(order.map((id, index) => [id, index]));
    return matching.sort((a, b) => {
      if (state.sessionSort === "custom" && order.length) {
        const delta = (rank.get(a.sessionId) ?? 1e6) - (rank.get(b.sessionId) ?? 1e6);
        if (delta) return delta;
      }
      return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
    });
  }, [rows, query, filter, state.sessionOrganization, state.sessionOrder, state.sessionSort]);
  useEffect(() => { void window.grok.refreshSessions().then(onState).catch((err) => setError(String(err))); }, []);
  useEffect(() => {
    const allow = new Set(rows.map((row) => row.sessionId));
    setSelected((prev) => new Set([...prev].filter((id) => allow.has(id))));
  }, [rows]);
  useEffect(() => { setEditing(false); setGroupReview(false); setDeleteReview(false); }, [filter]);
  const allSelected = visible.length > 0 && visible.every((row) => selected.has(row.sessionId));
  function toggleAll() {
    setSelected((prev) => { const next = new Set(prev); for (const row of visible) { if (allSelected) next.delete(row.sessionId); else next.add(row.sessionId); } return next; });
  }
  async function run(task: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError(""); setNotice("");
    try { await task(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  }
  function batch(action: SessionBatchAction) {
    const ids = [...selected];
    if (!ids.length) return;
    setDeleteReview(false);
    void run(async () => {
      const result = await window.grok.manageSessions(ids, action, action === "move" ? target || undefined : undefined);
      onState(result.snapshot);
      setSelected(new Set(result.skippedIds));
      setBackup(result.backupPath);
      setNotice(`已处理 ${result.processedIds.length} 条会话${result.skippedIds.length ? `，跳过 ${result.skippedIds.length} 条` : ""}`);
      setError(result.errors.join("\n"));
    });
  }
  function addGroup() {
    if (!newName.trim()) return;
    void run(async () => {
      const next = await window.grok.saveSessionGroup(undefined, newName);
      const added = next.sessionOrganization?.groups.find((group) => !organization.groups.some((old) => old.id === group.id));
      onState(next); setNewName("");
      if (added) { setTarget(added.id); if (!selected.size) setFilter(customGroupKey(added.id)); }
    });
  }
  function reorderGroup(id: string, delta: number) {
    const keys = groups.map((group) => customGroupKey(group.id));
    const index = keys.indexOf(customGroupKey(id)); const other = index + delta;
    if (other < 0 || other >= keys.length) return;
    [keys[index], keys[other]] = [keys[other], keys[index]];
    const existing = state.groupOrder.filter((key) => !keys.includes(key));
    void run(async () => onState(await window.grok.reorderGroups([...keys, ...existing])));
  }
  function reorderSession(id: string, delta: number) {
    const ids = visible.map((row) => row.sessionId); const index = ids.indexOf(id); const other = index + delta;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    // Include any records currently hidden by search to retain their stored order.
    const key = filter.startsWith("workspace:") ? normalizeGroupKey(filter.slice(10)) : filter;
    const rest = (state.sessionOrder[key] ?? []).filter((id) => !ids.includes(id));
    void run(async () => onState(await window.grok.reorderSessions(key, [...ids, ...rest])));
  }
  const selectedRows = rows.filter((row) => selected.has(row.sessionId));
  const allPinned = selectedRows.length > 0 && selectedRows.every((row) => row.pinned);
  const allArchived = selectedRows.length > 0 && selectedRows.every((row) => row.archived);

  return <Dialog title="管理会话" className="session-manager" onClose={() => { if (!pending) onClose(); }} initialFocusSelector=".session-manager-search input">
    <div className={`session-manager-layout ${pending ? "working" : ""}`} aria-busy={pending}>
      <nav className="session-manager-nav" aria-label="会话分组">
        <button className={filter === "__all__" ? "active" : ""} disabled={pending} onClick={() => setFilter("__all__")}><CheckSquare size={16} /><span>全部会话</span><small>{rows.length}</small></button>
        <button className={filter === "__archived__" ? "active" : ""} disabled={pending} onClick={() => setFilter("__archived__")}><Archive size={16} /><span>已归档</span><small>{rows.filter((row) => row.archived).length}</small></button>
        <div className="session-manager-nav-label">自定义分组</div>
        {groups.map((group, index) => <div className="manager-group" key={group.id}>
          <button className={filter === customGroupKey(group.id) ? "active" : ""} disabled={pending} onClick={() => setFilter(customGroupKey(group.id))}><Folder size={16} /><span>{group.name}</span><small>{rows.filter((row) => sessionCustomGroup(row, organization) === group.id).length}</small></button>
          <div className="manager-group-order">
            <button className="icon-btn" disabled={pending || index === 0} aria-label={`上移分组 ${group.name}`} onClick={() => reorderGroup(group.id, -1)}><ArrowUp size={12} /></button>
            <button className="icon-btn" disabled={pending || index === groups.length - 1} aria-label={`下移分组 ${group.name}`} onClick={() => reorderGroup(group.id, 1)}><ArrowDown size={12} /></button>
          </div>
        </div>)}
        <form className="manager-add-group" onSubmit={(event) => { event.preventDefault(); addGroup(); }}>
          <input aria-label="新分组名称" placeholder="新建分组" value={newName} maxLength={60} disabled={pending} onChange={(event) => setNewName(event.target.value)} />
          <button className="icon-btn" aria-label="创建分组" disabled={pending || !newName.trim()}><FolderPlus size={16} /></button>
        </form>
        <div className="session-manager-nav-label">工作目录</div>
        <button className={filter === "__workspaces__" ? "active" : ""} disabled={pending} onClick={() => setFilter("__workspaces__")}><Folder size={16} /><span>按原目录显示</span></button>
        {workspaces.map((cwd) => <button key={cwd} title={cwd} className={filter === `workspace:${cwd}` ? "active" : ""} disabled={pending} onClick={() => setFilter(`workspace:${cwd}`)}><Folder size={16} /><span>{folderLabel(cwd)}</span></button>)}
      </nav>
      <div className="session-manager-content">
        <div className="session-manager-search"><Search size={16} /><input aria-label="搜索管理会话" placeholder="搜索标题、工作目录或分组" value={query} disabled={pending} onChange={(event) => setQuery(event.target.value)} /><button className="icon-btn" aria-label="刷新会话列表" disabled={pending} onClick={() => void run(async () => onState(await window.grok.refreshSessions()))}><RefreshCw size={16} /></button></div>
        <div className="manager-list-heading">
          {editing && activeGroup ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => { onState(await window.grok.saveSessionGroup(activeGroup.id, editName)); setEditing(false); }); }}><input aria-label="重命名分组" value={editName} autoFocus disabled={pending} onChange={(event) => setEditName(event.target.value)} /><button className="btn" disabled={pending}>保存</button><button className="icon-btn" type="button" aria-label="取消重命名" onClick={() => setEditing(false)}><X size={14} /></button></form>
          : <><strong>{activeGroup?.name || (filter === "__archived__" ? "已归档" : filter.startsWith("workspace:") ? folderLabel(filter.slice(10)) : filter === "__workspaces__" ? "按原目录显示" : "全部会话")}</strong><small>{visible.length} 条</small></>}
          {activeGroup && !editing && <div className="manager-heading-actions"><button className="text-action" disabled={pending} onClick={() => { setEditName(activeGroup.name); setEditing(true); }}>重命名</button><button className="text-action" disabled={pending} onClick={() => setGroupReview(true)}>移除分组</button></div>}
        </div>
        {groupReview && activeGroup && <div className="manager-review"><span>移除“{activeGroup.name}”？会话会回到原工作目录分组。</span><button className="btn" disabled={pending} onClick={() => void run(async () => { onState(await window.grok.removeSessionGroup(activeGroup.id)); setFilter("__all__"); })}>移除分组</button><button className="text-action" onClick={() => setGroupReview(false)}>取消</button></div>}
        <div className="manager-select-line"><label><input type="checkbox" checked={allSelected} disabled={pending || !visible.length} onChange={toggleAll} />选择当前结果</label><span>{pending ? "正在处理…" : `已选 ${selected.size} 条`}</span>{selected.size > 0 && <button className="text-action" disabled={pending} onClick={() => { setSelected(new Set()); setDeleteReview(false); }}>清空选择</button>}</div>
        <div className="manager-session-list">
          {!visible.length && <div className="manager-empty">{query ? "没有匹配的会话" : "这个分组还没有会话"}</div>}
          {visible.map((row, index) => {
            const group = organization.groups.find((item) => item.id === sessionCustomGroup(row, organization));
            const running = row.running || (state.busy && state.sessionId === row.sessionId);
            return <div className={`manager-session-row ${selected.has(row.sessionId) ? "selected" : ""}`} key={row.sessionId}>
              <label><input type="checkbox" checked={selected.has(row.sessionId)} disabled={pending} aria-label={`选择 ${title(row)}`} onChange={() => { setDeleteReview(false); setSelected((prev) => { const next = new Set(prev); if (next.has(row.sessionId)) next.delete(row.sessionId); else next.add(row.sessionId); return next; }); }} /><span className="manager-session-copy"><strong>{title(row)}</strong><small title={row.cwd}>{group ? `${group.name} · ` : ""}{folderLabel(row.cwd)}{row.archived ? " · 已归档" : ""}{row.pinned ? " · 已置顶" : ""}</small></span></label>
              <span className="manager-session-date">{running ? "运行中" : row.updatedAtMs ? new Date(row.updatedAtMs).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : ""}</span>
              {(activeGroup || filter.startsWith("workspace:")) && <div className="manager-row-order"><button className="icon-btn" aria-label={`上移会话 ${title(row)}`} disabled={pending || !!query || index === 0} onClick={() => reorderSession(row.sessionId, -1)}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`下移会话 ${title(row)}`} disabled={pending || !!query || index === visible.length - 1} onClick={() => reorderSession(row.sessionId, 1)}><ArrowDown size={14} /></button></div>}
            </div>;
          })}
        </div>
        {(notice || error || backup) && <div className="manager-feedback" role="status">{notice && <span>{notice}</span>}{error && <span className="error-text">{error}</span>}{backup && <button className="text-action" onClick={() => void window.grok.openPath(backup)}>打开删除备份</button>}</div>}
        {deleteReview ? <div className="manager-delete-review"><strong>删除已选的 {selected.size} 条本地会话？</strong><span>保留可恢复备份，云端历史不受影响。运行中的会话会跳过。</span><div><button className="btn danger" disabled={pending || !selected.size} onClick={() => batch("delete")}>删除并保留备份</button><button className="btn" onClick={() => setDeleteReview(false)}>取消</button></div></div>
        : <div className="manager-batch-bar"><div className="manager-move"><select aria-label="目标分组" value={target} disabled={pending || !selected.size} onChange={(event) => setTarget(event.target.value)}><option value="">原工作目录</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button className="btn" disabled={pending || !selected.size} onClick={() => batch("move")}>移动到分组</button></div><div className="manager-batch-actions"><button className="btn" disabled={pending || !selected.size} onClick={() => batch(allPinned ? "unpin" : "pin")}><Pin size={14} />{allPinned ? "取消置顶" : "置顶"}</button><button className="btn" disabled={pending || !selected.size} onClick={() => batch(allArchived ? "unarchive" : "archive")}><Archive size={14} />{allArchived ? "取消归档" : "归档"}</button><button className="btn danger" disabled={pending || !selected.size} onClick={() => setDeleteReview(true)}><Trash2 size={14} />删除</button></div></div>}
      </div>
    </div>
  </Dialog>;
}
