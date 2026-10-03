import { useMemo, useState } from "react";
import { Archive, MessageSquare, Search } from "lucide-react";
import type { SessionSummary } from "../../shared/types";
import { Dialog } from "./Dialog";

export function SearchDialog({ sessions, onOpen, onClose }: {
  sessions: SessionSummary[]; onOpen: (session: SessionSummary) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const results = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return sessions.filter((row) => (includeArchived || !row.archived) && words.every((word) => `${row.title || "新对话"} ${row.cwd || ""}`.toLocaleLowerCase().includes(word)))
      .sort((a, b) => (b.updatedAtMs || Date.parse(b.updatedAt || "") || 0) - (a.updatedAtMs || Date.parse(a.updatedAt || "") || 0)).slice(0, 60);
  }, [sessions, query, includeArchived]);
  return <Dialog title="搜索对话" className="search-panel" onClose={onClose} initialFocusSelector="input">
    <div className="search-field"><Search size={18} /><input autoFocus aria-label="按标题或项目搜索" placeholder="搜索标题或项目…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && results[0]) { event.preventDefault(); event.stopPropagation(); onClose(); onOpen(results[0]); } }} /></div>
    <label className="search-options"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />包含已归档对话<span>{results.length} 个结果</span></label>
    <div className="search-results">{results.length ? results.map((row) => <button className="search-result" key={row.sessionId} onClick={() => { onClose(); onOpen(row); }}>
      {row.archived ? <Archive size={16} /> : <MessageSquare size={16} />}<span><strong>{row.title || "新对话"}</strong><small>{row.cwd || "未指定项目"}</small></span>{row.running ? <i className="status-dot ready" title="进行中" /> : null}
    </button>) : <div className="panel-empty">没有找到匹配的对话<span>试试其他标题或项目名称。</span></div>}</div>
  </Dialog>;
}
