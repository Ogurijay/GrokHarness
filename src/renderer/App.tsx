import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type {
  AppSnapshot,
  BackgroundTask,
  GroupSort,
  PermissionRequest,
  ComposerSubmitPayload,
  PromptAttachment,
  SessionRef,
  SessionSort,
  SessionSummary,
  TimelineItem,
  ToolDiff,
} from "../shared/types";
import { normalizeGroupKey } from "../shared/types";
import { CodeView, prettyUnknown } from "./CodeView";
import { formatDuration, formatElapsedClock, formatSessionElapsed, formatTokens } from "../shared/step-stats";
import { GROK_SETTINGS_DEFAULTS } from "../shared/grok-settings";
import { ComposerPane } from "./ComposerPane";
import { SettingsPanel } from "./SettingsPanel";
import { UpdatePanel } from "./UpdatePanel";
import { DesktopPanel } from "./DesktopPanel";
import { UsagePanel } from "./UsagePanel";
import { MediaStudio, type StudioTab } from "./MediaStudio";
import { Image as ImageIcon, Mic, MoreHorizontal, PanelLeft, PanelRight, Plus, Search, Settings as SettingsIcon, Video, FolderOpen, FolderClosed, ChevronsDown, ChevronsUp, ListFilter } from "lucide-react";
import { SidebarNavigation } from "./ui/SidebarNavigation";
import { SearchDialog } from "./ui/SearchDialog";
import { Dialog } from "./ui/Dialog";
import { useAppearance } from "./ui/appearance";

const empty: AppSnapshot = {
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
  account: { connection: "idle" },
  commands: [],
  settings: GROK_SETTINGS_DEFAULTS,
  backgroundTasks: [],
  runStats: {},
  tokenUsage: { days: [], total: 0, today: 0 },
  promptQueue: [],
};

const GROUP_SORT_OPTIONS: { id: GroupSort; label: string }[] = [
  { id: "custom", label: "自定义排列" },
  { id: "recent", label: "最近活动" },
  { id: "name-asc", label: "名称 A→Z" },
  { id: "name-desc", label: "名称 Z→A" },
  { id: "count", label: "会话数量" },
];

const SESSION_SORT_OPTIONS: { id: SessionSort; label: string }[] = [
  { id: "custom", label: "自定义排列" },
  { id: "recent", label: "最近活动" },
  { id: "title-asc", label: "名称 A→Z" },
  { id: "title-desc", label: "名称 Z→A" },
];

const DRAG_MIME = "application/x-grok-sidebar";

type SidebarDrag =
  | { kind: "group"; key: string }
  | { kind: "session"; id: string; groupKey: string };

type SidebarDragState = SidebarDrag & { overId?: string; edge?: "before" | "after" };

function moveKey(order: string[], from: string, to: string, edge: "before" | "after"): string[] {
  if (from === to) return order;
  const next = order.filter((key) => key !== from);
  const index = next.indexOf(to);
  if (index < 0) return [...next, from];
  next.splice(edge === "before" ? index : index + 1, 0, from);
  return next;
}

function mergeOrder(visual: string[], stored: string[]): string[] {
  const seen = new Set(visual);
  return [...visual, ...stored.filter((key) => !seen.has(key))];
}

function dropEdge(event: DragEvent, el: HTMLElement): "before" | "after" {
  const rect = el.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function FoldChevron({ open = false }: { open?: boolean }) {
  return (
    <svg
      className={`chevron ${open ? "open" : ""}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.2 2.2 8.4 6 4.2 9.8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Fold({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  return (
    <div className={`fold ${collapsed ? "collapsed" : ""}`}>
      <div className="fold-inner">{children}</div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.4 8.3 6.5 11.4 12.6 4.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.8 2.4 13.6 6.2c.3.3.3.8 0 1.1l-1.2 1.2-1.8-.3-2.4 2.4v2.2L6.6 11.2 3.2 14.6 1.4 12.8l3.4-3.4L3.2 7.8h2.2l2.4-2.4-.3-1.8 1.2-1.2c.3-.3.8-.3 1.1 0Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatImage({
  path,
  preview,
  name,
  onOpen,
}: {
  path: string;
  preview?: string;
  name?: string;
  onOpen: (path: string, preview?: string, name?: string) => void;
}) {
  const remote = /^https?:/i.test(path);
  return (
    <button
      type="button"
      className="chat-image"
      title={name || path}
      onClick={() => onOpen(path, preview, name)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!remote) void window.grok.imageMenu(path);
      }}
    >
      {preview ? <img src={preview} alt={name || ""} /> : <span className="attach-name">{name || path}</span>}
    </button>
  );
}

const ChatMarkdown = memo(function ChatMarkdown({
  text,
  onOpenImage,
}: {
  text: string;
  onOpenImage: (path: string, preview?: string, name?: string) => void;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        img({ src, alt }) {
          if (!src) return null;
          if (/^https?:/i.test(src) || src.startsWith("data:")) {
            return (
              <button
                type="button"
                className="chat-image"
                onClick={() => onOpenImage(src, src, alt)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (src.startsWith("data:")) void window.grok.imageMenu(src);
                }}
              >
                <img src={src} alt={alt || ""} />
              </button>
            );
          }
          return <ChatImage path={src} name={alt} onOpen={onOpenImage} />;
        },
      }}
    >
      {text}
    </Markdown>
  );
});

function MessageExtras({
  attachments,
  sessionRefs,
  onOpenImage,
}: {
  attachments?: PromptAttachment[];
  sessionRefs?: SessionRef[];
  onOpenImage: (path: string, preview?: string, name?: string) => void;
}) {
  if (!attachments?.length && !sessionRefs?.length) return null;
  return (
    <div className="message-extras">
      {attachments?.map((item) =>
        item.kind === "image" ? (
          <ChatImage
            key={item.path}
            path={item.path}
            preview={item.preview}
            name={item.name}
            onOpen={onOpenImage}
          />
        ) : (
          <div className={`attach-chip static ${item.kind}`} key={item.path} title={item.path}>
            <span className="attach-name">{item.name}</span>
          </div>
        ),
      )}
      {sessionRefs?.map((item) => (
        <div className="attach-chip static session" key={item.sessionId}>
          <span className="attach-kind">对话</span>
          <span className="attach-name">{item.title}</span>
        </div>
      ))}
    </div>
  );
}

function PromptQueueBar({
  queue,
  followUp,
  holding,
  combine,
  onSendNow,
  onRemove,
}: {
  queue: AppSnapshot["promptQueue"];
  followUp: "queue" | "steer";
  holding: boolean;
  combine: boolean;
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (!queue.length) return null;
  const hint = holding
    ? "后台任务结束后发送 · 空回车立即发送"
    : followUp === "steer"
      ? "将在下一空隙注入"
      : "本轮结束后发送";
  return (
    <div className="prompt-queue">
      <div className="prompt-queue-head">
        <span>
          追问 {queue.length}
          {combine ? " · 合并" : ""}
        </span>
        <em>{hint}</em>
      </div>
      {queue.map((item) => (
        <div className="prompt-queue-row" key={item.id}>
          <span className="prompt-queue-text">{item.text || (item.attachments.length ? "附件" : "追问")}</span>
          <button type="button" className="text-action" onClick={() => onSendNow(item.id)}>
            立即发送
          </button>
          <button type="button" className="text-action" onClick={() => onRemove(item.id)}>
            移除
          </button>
        </div>
      ))}
    </div>
  );
}

function formatBackgroundLine(tasks: BackgroundTask[]): string {
  const counts = { command: 0, monitor: 0, subagent: 0, loop: 0 };
  for (const task of tasks) counts[task.kind] += 1;
  const parts: string[] = [];
  if (counts.command) parts.push(`${counts.command} command${counts.command === 1 ? "" : "s"}`);
  if (counts.monitor) parts.push(`${counts.monitor} monitor${counts.monitor === 1 ? "" : "s"}`);
  if (counts.loop) parts.push(`${counts.loop} loop${counts.loop === 1 ? "" : "s"}`);
  if (counts.subagent) parts.push(`${counts.subagent} subagent${counts.subagent === 1 ? "" : "s"}`);
  return `◎ ${parts.join(" · ") || `${tasks.length} task${tasks.length === 1 ? "" : "s"}`} still running`;
}

function formatTaskAge(ms?: number): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

function formatSessionRunning(session: SessionSummary): string | undefined {
  const n = session.backgroundCount ?? 0;
  if (!session.running || n <= 0) return undefined;
  return `◎ ${n} task${n === 1 ? "" : "s"} still running`;
}

function sessionLive(session: SessionSummary, state: AppSnapshot): boolean {
  return Boolean(session.running) || (state.busy && session.sessionId === state.sessionId);
}

function TasksPane({ tasks }: { tasks: BackgroundTask[] }) {
  const now = useNow(tasks.length > 0);
  if (!tasks.length) return null;
  return (
    <details className="tasks-pane" open>
      <summary>
        <FoldChevron />
        <span>Tasks {tasks.length}</span>
      </summary>
      <ul className="tasks-pane-list">
        {tasks.map((task) => (
          <li key={task.id} title={task.command || task.id}>
            <span className="tasks-bullet">·</span>
            <span className="tasks-label">Task {task.title}</span>
            {task.startedAt ? (
              <span className="tasks-age">{formatTaskAge(now - task.startedAt)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function TurnClock({ startedAt, title }: { startedAt?: number; title?: string }) {
  const now = useNow(true);
  return (
    <span className="turn-clock" title={title}>
      {formatElapsedClock(now - (startedAt ?? now))}
    </span>
  );
}

function StillRunningLine({ tasks }: { tasks: BackgroundTask[] }) {
  if (!tasks.length) return null;
  return (
    <div className="still-running" title={tasks.map((task) => task.command || task.title).join("\n")}>
      {formatBackgroundLine(tasks)}
    </div>
  );
}

function useNow(active: boolean, interval = 500): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(id);
  }, [active, interval]);
  return active ? now : Date.now();
}

function Stamp({ at, show = true }: { at?: number; show?: boolean }) {
  if (!show || !at) return null;
  return <time className="stamp">{formatClock(at)}</time>;
}

function StreamingDots() {
  return (
    <span className="stream-dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

function StreamPlaceholder({ label }: { label: string }) {
  return (
    <div className="stream-placeholder" role="status" aria-live="polite" aria-label={label}>
      <div className="stream-placeholder-label">{label}</div>
      <div className="stream-placeholder-dialog">
        <StreamingDots />
      </div>
    </div>
  );
}

function isBlank(text?: string) {
  return !text || !text.trim();
}

function toolTitlePending(item: Extract<TimelineItem, { kind: "tool" }>) {
  const live = item.status === "pending" || item.status === "in_progress";
  if (!live) return false;
  const title = item.title.trim();
  return !title || title === "tool";
}

function isActivityItem(item: TimelineItem): boolean {
  return item.kind === "thought" || item.kind === "tool" || item.kind === "plan";
}

function isLiveItem(item: TimelineItem): boolean {
  if ("streaming" in item && item.streaming) return true;
  return item.kind === "tool" && (item.status === "pending" || item.status === "in_progress");
}

type TimelineBlock =
  | { type: "single"; item: TimelineItem }
  | { type: "ops"; id: string; items: TimelineItem[]; streaming: boolean };

function groupTimeline(items: TimelineItem[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = [];
  let work: TimelineItem[] = [];

  const flushWork = () => {
    if (!work.length) return;
    blocks.push({
      type: "ops",
      id: work[0].id,
      items: work,
      streaming: work.some(isLiveItem),
    });
    work = [];
  };

  for (const item of items) {
    if (isActivityItem(item)) {
      work.push(item);
      continue;
    }
    flushWork();
    blocks.push({ type: "single", item });
  }
  flushWork();
  return blocks;
}

function baseName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function diffLineStats(diffs?: ToolDiff[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const diff of diffs ?? []) {
    const oldLines = (diff.oldText ?? "").split("\n");
    const newLines = (diff.newText ?? "").split("\n");
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    for (const line of newLines) if (!oldSet.has(line)) added += 1;
    for (const line of oldLines) if (!newSet.has(line)) removed += 1;
  }
  return { added, removed };
}

type ToolRole = "edit" | "search" | "run" | "read" | "fetch" | "other";

function toolRole(item: Extract<TimelineItem, { kind: "tool" }>): ToolRole {
  const kind = (item.toolKind ?? "").toLowerCase();
  const title = item.title.trim();
  const hay = `${kind} ${title}`.toLowerCase();
  if (kind === "edit" || kind === "write" || item.diffs?.length || /^\s*edit\b/i.test(title) || /search_replace/.test(hay)) {
    return "edit";
  }
  if (kind === "search" || kind === "grep" || /searched|grep|glob/.test(hay) || /^web search/i.test(title)) return "search";
  if (kind === "execute" || kind === "terminal" || kind === "bash" || item.background) return "run";
  if (/run_terminal|\[bg\]|^\s*(run|execute)\s/i.test(hay) || /^(run|execute)\b/i.test(title)) return "run";
  if (kind === "read" || /^(read|list)\b/i.test(title)) return "read";
  if (kind === "fetch" || /web_search|fetch|open_page/.test(hay) || /^fetch\b/i.test(title)) return "fetch";
  return "other";
}

function thoughtLabel(item: Extract<TimelineItem, { kind: "thought" }>, live: boolean): string {
  if (item.interrupted) return "Thought interrupted";
  const duration = formatDuration(
    item.durationMs ?? (live && item.at != null ? Math.max(0, Date.now() - item.at) : undefined),
  );
  if (live && !item.durationMs) return duration ? `Thought for ${duration}` : "Thinking…";
  return duration ? `Thought for ${duration}` : "Thought";
}

function toolLabel(item: Extract<TimelineItem, { kind: "tool" }>): { role: ToolRole; text: string; added?: number; removed?: number } {
  const role = toolRole(item);
  if (role === "edit") {
    const fromDiff = item.diffs?.[0]?.path;
    const tick = item.title.match(/`([^`]+)`/);
    const name = baseName(fromDiff || tick?.[1] || item.title.replace(/^edit\s+/i, ""));
    const stats = diffLineStats(item.diffs);
    return { role, text: `Edit ${name}`, added: stats.added || undefined, removed: stats.removed || undefined };
  }
  if (role === "search") {
    if (/^searched\b/i.test(item.title)) return { role, text: item.title };
    const count = item.title.match(/(\d+)\s*(pattern|file|match)/i);
    if (count) {
      const unit = count[2].toLowerCase();
      const n = count[1];
      const plural = n === "1" || /s$/.test(unit) ? unit : `${unit}s`;
      return { role, text: `Searched ${n} ${plural}` };
    }
    return { role, text: item.title };
  }
  if (role === "run") {
    let text = item.title.replace(/^\[bg\]\s*/i, "").replace(/^execute\s+/i, "Run ");
    if (text.length > 88) text = `${text.slice(0, 85)}…`;
    return { role, text };
  }
  return { role, text: item.title };
}

function TimelineItemView({
  item,
  selectedId,
  onSelectTool,
  showTimestamps = true,
  onOpenImage,
}: {
  item: TimelineItem;
  selectedId?: string;
  onSelectTool: (item: Extract<TimelineItem, { kind: "tool" }>) => void;
  showTimestamps?: boolean;
  onOpenImage: (path: string, preview?: string, name?: string) => void;
}) {
  if (item.kind === "user") {
    return (
      <div className="bubble user">
        <div className="kicker">
          你
          <Stamp at={item.at} show={showTimestamps} />
        </div>
        <div className="md">
          {item.text ? <ChatMarkdown text={item.text} onOpenImage={onOpenImage} /> : null}
          <MessageExtras
            attachments={item.attachments}
            sessionRefs={item.sessionRefs}
            onOpenImage={onOpenImage}
          />
        </div>
      </div>
    );
  }
  if (item.kind === "interrupt") {
    return (
      <div className="turn-interrupt" role="status">
        <span>已中断</span>
        {item.durationMs != null ? <em>{formatElapsedClock(item.durationMs)}</em> : null}
      </div>
    );
  }
  if (item.kind === "thought") {
    return <ThoughtRow item={item} />;
  }
  if (item.kind === "assistant") {
    return (
      <div className={`bubble assistant${item.interrupted ? " interrupted" : ""}`}>
        <div className="kicker">
          {item.interrupted ? "Grok · 已中断" : "Grok"}
          <Stamp at={item.at} show={showTimestamps} />
        </div>
        <div className="md">
          {isBlank(item.text) && item.streaming ? (
            <StreamingDots />
          ) : (
            <ChatMarkdown text={item.text} onOpenImage={onOpenImage} />
          )}
        </div>
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <ToolRow item={item} active={selectedId === item.id} onSelect={() => onSelectTool(item)} />
    );
  }
  if (item.kind === "plan") {
    return (
      <div className="bubble">
        <div className="kicker">
          Plan
          <Stamp at={item.at} show={showTimestamps} />
        </div>
        <pre>{item.text}</pre>
      </div>
    );
  }
  return (
    <div className="bubble">
      <div className={`kicker ${item.tone === "error" ? "thought" : ""}`}>
        {item.tone === "error" ? "错误" : "系统"}
        <Stamp at={item.at} show={showTimestamps} />
      </div>
      <div className="error-banner">{item.text}</div>
    </div>
  );
}

function toolHasDetail(item: Extract<TimelineItem, { kind: "tool" }>): boolean {
  return Boolean((item.outputText && item.outputText.trim()) || item.diffs?.length);
}

function useLiveFold(live: boolean) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = live;
  }, [live]);
  return ref;
}

function ThoughtRow({ item }: { item: Extract<TimelineItem, { kind: "thought" }> }) {
  const live = Boolean(item.streaming);
  const foldRef = useLiveFold(live);
  const hasBody = live || !isBlank(item.text);
  const row = (
    <>
      <span className={`op-fold ${hasBody ? "" : "empty"}`}>{hasBody ? <FoldChevron /> : null}</span>
      <span className="op-glyph thought" aria-hidden="true">
        ◆
      </span>
      <span className="op-copy">{thoughtLabel(item, live)}</span>
    </>
  );
  if (!hasBody) {
    return <div className={`op-row thought${item.interrupted ? " interrupted" : ""}`}>{row}</div>;
  }
  return (
    <details
      ref={foldRef}
      className={`op-item thought${item.interrupted ? " interrupted" : ""}${live ? " live" : ""}`}
    >
      <summary className="op-row thought">{row}</summary>
      <div className="thought-inline">{isBlank(item.text) ? <StreamingDots /> : item.text}</div>
    </details>
  );
}

function ToolRow({
  item,
  active,
  onSelect,
}: {
  item: Extract<TimelineItem, { kind: "tool" }>;
  active: boolean;
  onSelect: () => void;
}) {
  const live = item.status === "pending" || item.status === "in_progress";
  const foldRef = useLiveFold(live);
  const { role, text, added, removed } = toolLabel(item);
  const hasBody = toolHasDetail(item);
  const glyph =
    role === "run" ? (
      <span className={`op-bar ${live ? "live" : item.status}`} aria-hidden="true" />
    ) : (
      <span className={`op-glyph ${role}`} aria-hidden="true">
        {role === "edit" ? ">" : role === "search" || role === "fetch" ? "◈" : role === "read" ? "·" : "•"}
      </span>
    );
  const copy = (
    <span className="op-copy">
      {toolTitlePending(item) ? <StreamingDots /> : text}
      {added || removed ? (
        <>
          {" "}
          <span className="op-diff">
            {added ? <span className="op-add">+{added}</span> : null}
            {added && removed ? "/" : null}
            {removed ? <span className="op-del">-{removed}</span> : null}
          </span>
        </>
      ) : null}
    </span>
  );
  const rowClass = `op-row ${role} ${live ? "live" : ""} ${item.status} ${active ? "active" : ""}`;
  const head = (
    <>
      <span className={`op-fold ${hasBody ? "" : "empty"}`}>{hasBody ? <FoldChevron /> : null}</span>
      {glyph}
      {copy}
    </>
  );
  if (!hasBody) {
    return (
      <button type="button" className={rowClass} onClick={onSelect}>
        {head}
      </button>
    );
  }
  return (
    <details ref={foldRef} className={`op-item tool ${active ? "active" : ""}`}>
      <summary className={rowClass} onClick={() => onSelect()}>
        {head}
      </summary>
      <div className="op-detail">
        {item.diffs?.map((diff) => (
          <div className="op-detail-path" key={diff.path}>
            {diff.path}
          </div>
        ))}
        {item.outputText?.trim() ? <pre className="op-detail-out">{item.outputText}</pre> : null}
      </div>
    </details>
  );
}

function ActivityStream({
  block,
  selectedId,
  onSelectTool,
}: {
  block: Extract<TimelineBlock, { type: "ops" }>;
  selectedId?: string;
  onSelectTool: (item: Extract<TimelineItem, { kind: "tool" }>) => void;
}) {
  return (
    <div className={`op-stream${block.streaming ? " live" : ""}`}>
      {block.items.map((item) => {
        if (item.kind === "thought") return <ThoughtRow key={item.id} item={item} />;
        if (item.kind === "tool") {
          return (
            <ToolRow
              key={item.id}
              item={item}
              active={selectedId === item.id}
              onSelect={() => onSelectTool(item)}
            />
          );
        }
        if (item.kind === "plan") {
          return (
            <details key={item.id} className="op-item plan">
              <summary className="op-row">
                <span className="op-fold">
                  <FoldChevron />
                </span>
                <span className="op-glyph" aria-hidden="true">
                  ▸
                </span>
                <span className="op-copy">Plan</span>
              </summary>
              <pre className="thought-inline">{item.text}</pre>
            </details>
          );
        }
        return null;
      })}
    </div>
  );
}

const TimelineView = memo(function TimelineView({
  items,
  busy,
  selectedId,
  onSelectTool,
  showThoughts = true,
  groupTools = true,
  showTimestamps = true,
  onOpenImage,
}: {
  items: TimelineItem[];
  busy?: boolean;
  selectedId?: string;
  onSelectTool: (item: Extract<TimelineItem, { kind: "tool" }>) => void;
  showThoughts?: boolean;
  groupTools?: boolean;
  showTimestamps?: boolean;
  onOpenImage: (path: string, preview?: string, name?: string) => void;
}) {
  const blocks = useMemo(() => {
    const grouped = groupTools ? groupTimeline(items) : items.map((item) => ({ type: "single" as const, item }));
    if (showThoughts) return grouped;
    return grouped.filter((block) => !(block.type === "single" && block.item.kind === "thought"));
  }, [items, groupTools, showThoughts]);
  const waiting = Boolean(busy) && !items.some(isLiveItem);
  const lastBlock = blocks[blocks.length - 1];
  const waitingLabel =
    lastBlock?.type === "ops" && lastBlock.items.some((item) => item.kind === "tool")
      ? "正在操作"
      : "正在思考";
  return (
    <>
      {blocks.map((block) => {
        if (block.type === "ops") {
          return (
            <ActivityStream
              key={block.id}
              block={block}
              selectedId={selectedId}
              onSelectTool={onSelectTool}
            />
          );
        }
        return (
          <div key={block.item.id}>
            <TimelineItemView
              item={block.item}
              selectedId={selectedId}
              onSelectTool={onSelectTool}
              showTimestamps={showTimestamps}
              onOpenImage={onOpenImage}
            />
          </div>
        );
      })}
      {waiting ? <StreamPlaceholder label={waitingLabel} /> : null}
    </>
  );
});

function Inspector({
  item,
  collapsedEdits,
}: {
  item?: Extract<TimelineItem, { kind: "tool" }>;
  collapsedEdits?: boolean;
}) {
  if (!item) {
    return (
      <aside className="inspector pane">
        <h2>检查器</h2>
        <p className="topbar-title">点选一条工具调用查看详情。</p>
      </aside>
    );
  }
  const input = item.rawInput == null ? undefined : prettyUnknown(item.rawInput);
  const output = item.outputText ? prettyUnknown(item.outputText) : undefined;
  return (
    <aside className="inspector pane">
      <h2>{item.title}</h2>
      <div className={`pill ${item.status}`}>{item.status}</div>
      {input && (
        <div className="diff">
          <CodeView code={input.code} language={input.language ?? "json"} path="input" />
        </div>
      )}
      {output && (
        <div className="diff fill">
          <CodeView fill code={output.code} language={output.language} path="output" />
        </div>
      )}
      {item.diffs?.map((diff) => {
        const body = (
          <CodeView
            code={diff.newText ?? diff.oldText ?? ""}
            path={collapsedEdits ? undefined : diff.path}
          />
        );
        if (!collapsedEdits) {
          return (
            <div className="diff" key={diff.path}>
              {body}
            </div>
          );
        }
        const added = diff.newText?.split("\n").length ?? 0;
        const removed = diff.oldText?.split("\n").length ?? 0;
        return (
          <details className="diff" key={diff.path}>
            <summary className="path">
              <FoldChevron />
              {diff.path} +{added} / -{removed}
            </summary>
            {body}
          </details>
        );
      })}
    </aside>
  );
}

function permissionHaystack(option: PermissionRequest["options"][number]): string {
  return `${option.optionId} ${option.name} ${option.kind ?? ""}`.toLowerCase();
}

function isPreferredPermission(option: PermissionRequest["options"][number], pref: string): boolean {
  const hay = permissionHaystack(option);
  switch (pref) {
    case "always_allow_all_sessions":
      return /all.?session|always_allow_all|always allow on all/.test(hay);
    case "allow_command_always":
      return /command_always|this command|always allow this|always_allow/.test(hay) && !/all.?session/.test(hay);
    case "allow_once":
      return /allow_once|allow once|\byes\b/.test(hay) || (/allow/.test(hay) && !/always/.test(hay));
    case "reject":
      return /reject|deny|refuse|\bno\b/.test(hay);
    default:
      return false;
  }
}

function PermissionBar({
  permission,
  preferred,
  rememberApprovals,
  onChoose,
}: {
  permission: PermissionRequest;
  preferred?: string;
  rememberApprovals?: boolean;
  onChoose: (optionId: string | null) => void;
}) {
  const options =
    rememberApprovals === false
      ? permission.options.filter((option) => !/always_allow|always-allow|always allow/.test(permissionHaystack(option)))
      : permission.options;
  const shown = options.length ? options : permission.options;
  const preferredId = shown.find((option) => preferred && isPreferredPermission(option, preferred))?.optionId;
  return (
    <div className="permission">
      <h4>{permission.title}</h4>
      <div className="permission-actions">
        {shown.map((opt) => (
          <button
            key={opt.optionId}
            className={`btn ${opt.optionId === preferredId ? "primary" : ""}`}
            type="button"
            onClick={() => onChoose(opt.optionId)}
          >
            {opt.name}
          </button>
        ))}
        <button className="btn ghost" type="button" onClick={() => onChoose(null)}>
          取消
        </button>
      </div>
    </div>
  );
}

function SessionRow({
  session,
  active,
  busy,
  runningHint,
  menuOpen,
  renaming,
  dragging,
  dropEdge: edge,
  selecting,
  selected,
  onOpen,
  onPin,
  onMenu,
  onStartRename,
  onRename,
  onCancelRename,
  onToggleSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  session: SessionSummary;
  active: boolean;
  busy?: boolean;
  runningHint?: string;
  menuOpen: boolean;
  renaming: boolean;
  dragging?: boolean;
  dropEdge?: "before" | "after";
  selecting?: boolean;
  selected?: boolean;
  onOpen: () => void;
  onPin: (event: MouseEvent) => void;
  onMenu: (event: MouseEvent) => void;
  onStartRename: () => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
  onToggleSelect?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
}) {
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const skipBlur = useRef(false);
  const skipClick = useRef(false);
  const [draftTitle, setDraftTitle] = useState(session.title || "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!renaming) return;
    setDraftTitle(session.title || "");
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [renaming, session.title]);

  useEffect(() => () => clearTimeout(openTimer.current), []);

  function commitRename() {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    const next = draftTitle.trim();
    if (!next || next === (session.title || "").trim()) {
      onCancelRename();
      return;
    }
    onRename(next);
  }

  return (
    <div
      className={`session-row ${active ? "active" : ""} ${busy ? "busy" : ""} ${menuOpen ? "menu-open" : ""} ${renaming ? "renaming" : ""} ${dragging ? "dragging" : ""} ${edge ? `drop-${edge}` : ""} ${selecting ? "selecting" : ""} ${selected ? "selected" : ""}`}
      aria-busy={busy || undefined}
      aria-selected={selecting ? selected : undefined}
      draggable={!renaming && !selecting}
      onContextMenu={onMenu}
      onDragStart={(event) => {
        skipClick.current = true;
        onDragStart?.(event);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => {
        skipClick.current = true;
        onDragEnd?.();
      }}
    >
      {selecting ? (
        <button
          className={`session-check ${selected ? "on" : ""}`}
          type="button"
          draggable={false}
          aria-pressed={selected}
          title={selected ? "取消选择" : "选择"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect?.();
          }}
        >
          {selected ? <CheckIcon /> : null}
        </button>
      ) : null}
      {renaming ? (
        <div className="session-open">
          <input
            ref={inputRef}
            className="session-rename"
            value={draftTitle}
            maxLength={80}
            onChange={(event) => setDraftTitle(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                skipBlur.current = true;
                onCancelRename();
              }
            }}
            onBlur={commitRename}
          />
          <small>{formatAgo(session.updatedAtMs ?? session.updatedAt)}</small>
        </div>
      ) : (
        <div
          className="session-open"
          role="button"
          tabIndex={0}
          title={busy ? runningHint || "执行中" : session.title || "未命名对话"}
          onClick={() => {
            if (skipClick.current) {
              skipClick.current = false;
              return;
            }
            if (selecting) {
              onToggleSelect?.();
              return;
            }
            clearTimeout(openTimer.current);
            openTimer.current = setTimeout(() => onOpen(), 280);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (selecting) onToggleSelect?.();
              else onOpen();
            }
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            clearTimeout(openTimer.current);
            if (!selecting) onStartRename();
          }}
        >
          <span className="session-title">
            <span className="session-title-text">{session.title || "未命名对话"}</span>
            {session.interrupted ? <span className="interrupt-chip" title="本轮被强制打断">中断</span> : null}
            {busy ? (
              <span className="session-spinner" title={runningHint || "执行中"}>
                <Spinner />
              </span>
            ) : session.unread ? (
              <span className="unread-dot" title="未读" />
            ) : null}
          </span>
          <small>{runningHint || formatAgo(session.updatedAtMs ?? session.updatedAt)}</small>
        </div>
      )}
      {selecting ? null : (
        <div className="session-actions">
          <button className={`pin ${session.pinned ? "on" : ""}`} type="button" title={session.pinned ? "取消置顶" : "置顶"} draggable={false} onClick={onPin}>
            <PinIcon filled={Boolean(session.pinned)} />
          </button>
        </div>
      )}
    </div>
  );
}

type MenuEntry =
  | { type: "sep"; id: string }
  | { type: "label"; id: string; label: string }
  | { type: "item"; id: string; label: string; danger?: boolean; disabled?: boolean; checked?: boolean; onClick: () => void };

type AppMenu =
  | { kind: "session"; id: string; x: number; y: number }
  | { kind: "group"; id: string; x: number; y: number }
  | { kind: "sort"; x: number; y: number };

type SessionGroup = {
  key: string;
  label: string;
  cwd?: string;
  sessions: SessionSummary[];
  nested?: SessionGroup[];
};

function PopupMenu({ x, y, items }: { x: number; y: number; items: MenuEntry[] }) {
  const width = 204;
  const height = items.reduce((sum, item) => sum + (item.type === "sep" ? 9 : item.type === "label" ? 22 : 28), 8);
  const left = Math.min(Math.max(8, x - 8), window.innerWidth - width - 8);
  const top = y + 6 + height > window.innerHeight ? Math.max(8, y - height - 4) : y + 6;
  return createPortal(
    <div
      className="session-menu"
      role="menu"
      style={{ top, left, width }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) =>
        item.type === "sep" ? (
          <div className="menu-sep" key={item.id} />
        ) : item.type === "label" ? (
          <div className="menu-label" key={item.id}>
            {item.label}
          </div>
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={[item.danger ? "danger" : "", item.checked ? "checked" : ""].filter(Boolean).join(" ") || undefined}
            disabled={item.disabled}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

function HoverCard({
  x,
  y,
  title,
  path,
  lines,
}: {
  x: number;
  y: number;
  title: string;
  path?: string;
  lines: string[];
}) {
  const width = 300;
  const left = Math.min(x, window.innerWidth - width - 12);
  const top = Math.min(y, window.innerHeight - 160);
  return createPortal(
    <div className="hover-card" style={{ top, left, width }} role="tooltip">
      <h4>{title}</h4>
      {path ? <div className="hover-path">{path}</div> : null}
      {lines.length > 0 ? <div className="hover-meta">{lines.join(" · ")}</div> : null}
    </div>,
    document.body,
  );
}

export function App() {
  const [state, setState] = useState<AppSnapshot>(empty);
  const [selectedToolId, setSelectedToolId] = useState<string | undefined>();
  const [busyError, setBusyError] = useState<string | undefined>();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountDockRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [appearance, setAppearance] = useAppearance();
  const [desktopOpen, setDesktopOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [menu, setMenu] = useState<AppMenu | undefined>();
  const [hover, setHover] = useState<{ group: SessionGroup; x: number; y: number } | undefined>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const [draftWorkspace, setDraftWorkspace] = useState("");
  const [inspectorWidth, setInspectorWidth] = useState(320);
  const [renamingId, setRenamingId] = useState<string | undefined>();
  const [archiveSelecting, setArchiveSelecting] = useState(false);
  const [archiveSelected, setArchiveSelected] = useState<Set<string>>(() => new Set());
  const [usageOpen, setUsageOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTab | undefined>();
  const [injectText, setInjectText] = useState<string | undefined>();
  const [lightbox, setLightbox] = useState<{ path: string; src: string; name?: string } | undefined>();
  const [sidebarDrag, setSidebarDrag] = useState<SidebarDragState | undefined>();
  const sidebarDragRef = useRef<SidebarDragState | undefined>(sidebarDrag);
  sidebarDragRef.current = sidebarDrag;
  const skipGroupClick = useRef(false);
  const inspectorWidthRef = useRef(320);
  const resizing = useRef(false);

  useEffect(() => {
    const unsub = window.grok.onEvent((event) => {
      if (event.type === "snapshot") setState(event.snapshot);
    });
    void window.grok.getState().then((snap) => {
      setState(snap);
      setDraftWorkspace(snap.workspace ?? "");
      setInspectorWidth(snap.inspectorWidth || 320);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (state.inspectorWidth) setInspectorWidth(state.inspectorWidth);
  }, [state.inspectorWidth]);

  useEffect(() => {
    followOutput.current = true;
  }, [state.sessionId]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const follow = state.settings.pageFlipOnSend;
    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight <= 120;
    let frame = 0;
    let pinning = false;
    const onScroll = () => {
      if (pinning) return;
      followOutput.current = nearBottom();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const pin = () => {
      frame = 0;
      if (!follow || !followOutput.current) return;
      const top = el.scrollHeight - el.clientHeight;
      if (Math.abs(el.scrollTop - top) <= 1) return;
      pinning = true;
      el.scrollTop = top;
      pinning = false;
    };
    const schedule = () => {
      if (!follow || !followOutput.current || frame) return;
      frame = requestAnimationFrame(pin);
    };
    const inner = el.querySelector(".thread");
    const ro = new ResizeObserver(schedule);
    if (inner) ro.observe(inner);
    ro.observe(el);
    schedule();
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [state.sessionId, state.settings.pageFlipOnSend]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(undefined);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const dock = accountDockRef.current;
      if (!dock || !(event.target instanceof Node) || dock.contains(event.target)) return;
      setAccountOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);
  inspectorWidthRef.current = inspectorWidth;

  useEffect(() => {
    const onMove = (event: globalThis.MouseEvent) => {
      if (!resizing.current) return;
      const width = Math.min(720, Math.max(240, window.innerWidth - event.clientX));
      inspectorWidthRef.current = width;
      setInspectorWidth(width);
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      void window.grok.setInspectorWidth(inspectorWidthRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const selectedTool = useMemo(() => {
    return state.timeline.find(
      (item): item is Extract<TimelineItem, { kind: "tool" }> =>
        item.kind === "tool" && item.id === selectedToolId,
    );
  }, [state.timeline, selectedToolId]);

  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); void beginNew(); }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  async function startIn(folder: string) {
    await beginNew(folder);
  }

  async function beginNew(workspace?: string) {
    setBusyError(undefined);
    setStudioTab(undefined);
    try {
      const snap = await window.grok.beginNewChat(workspace);
      setState(snap);
      setDraftWorkspace(workspace || snap.workspace || "");
    } catch (err) {
      setBusyError(err instanceof Error ? err.message : String(err));
    }
  }

  async function pickAndStart() {
    const folder = await window.grok.pickFolder();
    if (!folder) return;
    await beginNew(folder);
  }

  async function pickWorkspace() {
    const folder = await window.grok.pickFolder();
    if (!folder) return;
    const snap = await window.grok.setWorkspace(folder);
    setState(snap);
    setDraftWorkspace(snap.workspace ?? folder);
  }

  async function clearWorkspace(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    const snap = await window.grok.setWorkspace("");
    setState(snap);
    setDraftWorkspace(snap.workspace ?? "");
  }

  async function openSession(session: SessionSummary) {
    setBusyError(undefined);
    setStudioTab(undefined);
    followOutput.current = true;
    try {
      setState(await window.grok.openSession(session.sessionId, session.cwd));
    } catch (err) {
      setBusyError(err instanceof Error ? err.message : String(err));
    }
  }

  async function renameSession(session: SessionSummary, title: string) {
    setRenamingId(undefined);
    setBusyError(undefined);
    try {
      setState(await window.grok.renameSession(session.sessionId, title));
    } catch (err) {
      setBusyError(err instanceof Error ? err.message : String(err));
    }
  }

  async function pinSession(event: MouseEvent, session: SessionSummary) {
    event.preventDefault();
    event.stopPropagation();
    setState(await window.grok.pinSession(session.sessionId, !session.pinned));
  }

  function placeMenu(event: MouseEvent, next: { kind: "session" | "group"; id: string }) {
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(hoverTimer.current);
    setHover(undefined);
    const fromButton = event.type === "click";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = fromButton ? rect.right : event.clientX;
    const y = fromButton ? rect.bottom : event.clientY;
    setMenu((current) =>
      fromButton && current?.kind === next.kind && current.id === next.id ? undefined : { ...next, x, y },
    );
  }

  function showGroupHover(event: MouseEvent<HTMLElement>, group: SessionGroup) {
    if (menu) return;
    const el = event.currentTarget;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      setHover({ group, x: rect.right + 10, y: rect.top });
    }, 380);
  }

  function hideGroupHover() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(undefined), 80);
  }

  async function archiveSession(session: SessionSummary) {
    setMenu(undefined);
    setState(await window.grok.archiveSession(session.sessionId, !session.archived));
  }

  async function deleteSession(session: SessionSummary) {
    setMenu(undefined);
    setBusyError(undefined);
    try {
      setState(await window.grok.deleteSession(session.sessionId));
    } catch (err) {
      setBusyError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleArchiveSelected(sessionId: string) {
    setArchiveSelecting(true);
    setArchiveSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  function exitArchiveSelect() {
    setArchiveSelecting(false);
    setArchiveSelected(new Set());
  }

  async function beginArchiveSelect() {
    setMenu(undefined);
    setArchiveSelecting(true);
    if (state.collapsedGroups.includes("__archived__")) {
      setState(await window.grok.toggleGroup("__archived__"));
    }
  }

  async function deleteArchivedSessions(ids?: string[]) {
    setMenu(undefined);
    setBusyError(undefined);
    try {
      setState(await window.grok.deleteArchivedSessions(ids));
      setArchiveSelected(new Set());
      if (!ids?.length) setArchiveSelecting(false);
    } catch (err) {
      setBusyError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyText(text: string) {
    setMenu(undefined);
    await window.grok.copyText(text);
  }

  async function openFolder(folder?: string) {
    setMenu(undefined);
    if (!folder) return;
    const result = await window.grok.openPath(folder);
    if (!result.ok) setBusyError(result.error || "无法打开工作目录");
  }

  const openImage = useCallback(async (path: string, preview?: string, name?: string) => {
    const src = (await window.grok.imageDataUrl(path)) || preview || path;
    setLightbox({ path, src, name });
  }, []);

  const selectTool = useCallback((item: Extract<TimelineItem, { kind: "tool" }>) => {
    setSelectedToolId(item.id);
    void window.grok.setInspectorOpen(true);
  }, []);

  const stopTurn = useCallback(async () => {
    setBusyError(undefined);
    try {
      setState(await window.grok.cancel());
    } catch (err) {
      setBusyError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const sendComposer = useCallback(
    async ({ text, attachments, sessionRefs, now }: ComposerSubmitPayload) => {
      followOutput.current = true;
      setBusyError(undefined);
      try {
        if (!state.sessionId) {
          const workspace = draftWorkspace.trim();
          const snap = await window.grok.start(workspace, {
            workspace,
            mode: state.sessionMode,
            modelId: state.modelId || undefined,
            effort: state.effort || undefined,
          });
          setDraftWorkspace(snap.workspace ?? workspace);
        }
        setState(await window.grok.send(text, attachments, sessionRefs, now));
      } catch (err) {
        setBusyError(err instanceof Error ? err.message : String(err));
        throw err;
      }
    },
    [state.sessionId, state.sessionMode, state.modelId, state.effort, draftWorkspace],
  );

  const sendQueuedNow = useCallback(async () => {
    if (state.promptQueue.length) setState(await window.grok.sendQueuedNow());
  }, [state.promptQueue.length]);

  const setModelEffort = useCallback((modelId: string, effort?: string) => {
    void window.grok.setModelEffort(modelId, effort).then(setState);
  }, []);

  const consumeInject = useCallback(() => setInjectText(undefined), []);

  const account = state.account;
  const initial = (account.email ?? "G").slice(0, 1).toUpperCase();
  const quota = account.quota;
  const used = quota?.usedPercent ?? (quota?.remainingPercent != null ? 100 - quota.remainingPercent : undefined);
  const liveSessions = useMemo(
    () => state.sessions.filter((session) => !session.archived),
    [state.sessions],
  );
  const archivedSessions = useMemo(
    () => sortSessions(
      state.sessions.filter((session) => session.archived),
      state.sessionSort,
      false,
      state.sessionOrder?.__archived__,
    ),
    [state.sessions, state.sessionSort, state.sessionOrder],
  );
  const allLiveGroups = useMemo(
    () => buildGroups(liveSessions, state.groupSort, state.sessionSort, state.groupOrder ?? [], state.sessionOrder ?? {}),
    [liveSessions, state.groupSort, state.sessionSort, state.groupOrder, state.sessionOrder],
  );
  const hiddenKeySet = useMemo(() => new Set(state.hiddenGroups), [state.hiddenGroups]);
  const liveGroups = useMemo(
    () => allLiveGroups.filter((group) => group.key === "__pinned__" || !hiddenKeySet.has(group.key)),
    [allLiveGroups, hiddenKeySet],
  );
  const hiddenWorkspaceGroups = useMemo(
    () => allLiveGroups.filter((group) => hiddenKeySet.has(group.key)),
    [allLiveGroups, hiddenKeySet],
  );
  const archivedGroup: SessionGroup = {
    key: "__archived__",
    label: "已归档",
    sessions: archivedSessions,
  };
  const archiveAllSelected =
    archivedSessions.length > 0 && archivedSessions.every((session) => archiveSelected.has(session.sessionId));

  useEffect(() => {
    const ids = new Set(archivedSessions.map((session) => session.sessionId));
    setArchiveSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (ids.size === 0 && archiveSelecting) setArchiveSelecting(false);
  }, [archivedSessions, archiveSelecting]);
  const menuSession =
    menu?.kind === "session" ? state.sessions.find((session) => session.sessionId === menu.id) : undefined;
  const menuGroup =
    menu?.kind === "group"
      ? menu.id === "__archived__"
        ? archivedGroup
        : allLiveGroups.find((group) => group.key === menu.id) ??
          allLiveGroups.flatMap((group) => group.nested ?? []).find((group) => group.key === menu.id)
      : undefined;
  const currentSession = state.sessions.find((session) => session.sessionId === state.sessionId);
  const archivedCollapsed = state.collapsedGroups.includes("__archived__");
  const hiddenCollapsed = state.collapsedGroups.includes("__hidden__");
  const workspaceGroups = liveGroups.filter((group) => group.key !== "__pinned__");

  function parseDrag(event: DragEvent): SidebarDragState | undefined {
    try {
      const raw = event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");
      if (!raw) return sidebarDragRef.current;
      const parsed = JSON.parse(raw) as SidebarDrag;
      if (parsed?.kind === "group" && parsed.key) return parsed;
      if (parsed?.kind === "session" && parsed.id && parsed.groupKey) return parsed;
    } catch {
      /* ignore */
    }
    return sidebarDragRef.current;
  }

  function beginGroupDrag(event: DragEvent, key: string) {
    const payload: SidebarDrag = { kind: "group", key };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    skipGroupClick.current = true;
    sidebarDragRef.current = payload;
    setSidebarDrag(payload);
  }

  function beginSessionDrag(event: DragEvent, sessionId: string, groupKey: string) {
    const payload: SidebarDrag = { kind: "session", id: sessionId, groupKey };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    sidebarDragRef.current = payload;
    setSidebarDrag(payload);
  }

  function hoverDrop(event: DragEvent<HTMLElement>, kind: "group" | "session", overId: string, groupKey?: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const dragging = sidebarDragRef.current ?? parseDrag(event);
    if (!dragging || dragging.kind !== kind) return;
    if (kind === "session" && dragging.kind === "session" && dragging.groupKey !== groupKey) return;
    const edge = dropEdge(event, event.currentTarget);
    setSidebarDrag((current) => {
      const next = current ?? dragging;
      if (next.overId === overId && next.edge === edge) return current;
      return { ...next, overId, edge };
    });
  }

  function dropGroup(event: DragEvent<HTMLElement>, toKey: string) {
    event.preventDefault();
    const dragging = parseDrag(event);
    const edge = sidebarDrag?.edge ?? dropEdge(event, event.currentTarget);
    setSidebarDrag(undefined);
    if (!dragging || dragging.kind !== "group" || dragging.key === toKey) return;
    const visual = workspaceGroups.map((group) => group.key);
    const next = moveKey(mergeOrder(visual, state.groupOrder ?? []), dragging.key, toKey, edge);
    void window.grok.reorderGroups(next).then(setState);
  }

  function dropSession(event: DragEvent<HTMLElement>, toId: string, groupKey: string, sessions: SessionSummary[]) {
    event.preventDefault();
    const dragging = parseDrag(event);
    const edge = sidebarDrag?.edge ?? dropEdge(event, event.currentTarget);
    setSidebarDrag(undefined);
    if (!dragging || dragging.kind !== "session" || dragging.groupKey !== groupKey || dragging.id === toId) return;
    const visual = sessions.map((session) => session.sessionId);
    const next = moveKey(mergeOrder(visual, state.sessionOrder?.[groupKey] ?? []), dragging.id, toId, edge);
    void window.grok.reorderSessions(groupKey, next).then(setState);
  }

  function sessionDragProps(session: SessionSummary, groupKey: string, sessions: SessionSummary[]) {
    return {
      dragging: sidebarDrag?.kind === "session" && sidebarDrag.id === session.sessionId,
      dropEdge: sidebarDrag?.kind === "session" && sidebarDrag.overId === session.sessionId ? sidebarDrag.edge : undefined,
      onDragStart: (event: DragEvent<HTMLDivElement>) => beginSessionDrag(event, session.sessionId, groupKey),
      onDragOver: (event: DragEvent<HTMLDivElement>) => hoverDrop(event, "session", session.sessionId, groupKey),
      onDrop: (event: DragEvent<HTMLDivElement>) => dropSession(event, session.sessionId, groupKey, sessions),
      onDragEnd: () => {
        sidebarDragRef.current = undefined;
        setSidebarDrag(undefined);
      },
    };
  }
  const sessionMenuItems: MenuEntry[] = menuSession
    ? [
        {
          type: "item",
          id: "rename",
          label: "重命名",
          onClick: () => {
            setMenu(undefined);
            setRenamingId(menuSession.sessionId);
          },
        },
        {
          type: "item",
          id: "copy-id",
          label: "复制会话 ID",
          onClick: () => void copyText(menuSession.sessionId),
        },
        {
          type: "item",
          id: "copy-session",
          label: "复制会话",
          onClick: () => void copyText(formatSessionCopy(menuSession)),
        },
        {
          type: "item",
          id: "open-cwd",
          label: "打开工作目录",
          disabled: !menuSession.cwd,
          onClick: () => void openFolder(menuSession.cwd),
        },
        { type: "sep", id: "sep-1" },
        {
          type: "item",
          id: "pin",
          label: menuSession.pinned ? "取消置顶" : "置顶",
          onClick: () => {
            setMenu(undefined);
            void window.grok.pinSession(menuSession.sessionId, !menuSession.pinned).then(setState);
          },
        },
        {
          type: "item",
          id: "archive",
          label: menuSession.archived ? "取消归档" : "归档",
          onClick: () => void archiveSession(menuSession),
        },
        { type: "sep", id: "sep-2" },
        {
          type: "item",
          id: "delete",
          label: "删除",
          danger: true,
          onClick: () => void deleteSession(menuSession),
        },
      ]
    : [];
  const groupMenuItems: MenuEntry[] = menuGroup
    ? [
        ...(menuGroup.cwd
          ? [
              {
                type: "item" as const,
                id: "new",
                label: "在此新建会话",
                onClick: () => {
                  setMenu(undefined);
                  void startIn(menuGroup.cwd!);
                },
              },
              {
                type: "item" as const,
                id: "open-cwd",
                label: "打开工作目录",
                onClick: () => void openFolder(menuGroup.cwd),
              },
              {
                type: "item" as const,
                id: "copy-path",
                label: "复制路径",
                onClick: () => void copyText(menuGroup.cwd!),
              },
              { type: "sep" as const, id: "sep-1" },
            ]
          : []),
        {
          type: "item",
          id: "toggle",
          label: state.collapsedGroups.includes(menuGroup.key) ? "展开" : "折叠",
          onClick: () => {
            setMenu(undefined);
            void window.grok.toggleGroup(menuGroup.key).then(setState);
          },
        },
        ...(menuGroup.key === "__archived__"
          ? [
              {
                type: "item" as const,
                id: "select",
                label: archiveSelecting ? "完成选择" : "选择会话",
                onClick: () => {
                  if (archiveSelecting) exitArchiveSelect();
                  else void beginArchiveSelect();
                },
              },
              {
                type: "item" as const,
                id: "select-all",
                label: archiveAllSelected ? "取消全选" : "全选",
                onClick: () => {
                  setMenu(undefined);
                  setArchiveSelecting(true);
                  setArchiveSelected(
                    archiveAllSelected
                      ? new Set()
                      : new Set(archivedSessions.map((session) => session.sessionId)),
                  );
                  if (state.collapsedGroups.includes("__archived__")) {
                    void window.grok.toggleGroup("__archived__").then(setState);
                  }
                },
              },
              { type: "sep" as const, id: "sep-archive-del" },
              {
                type: "item" as const,
                id: "delete-selected",
                label: archiveSelected.size ? `删除已选（${archiveSelected.size}）` : "删除已选",
                danger: true,
                disabled: archiveSelected.size === 0,
                onClick: () => void deleteArchivedSessions([...archiveSelected]),
              },
              {
                type: "item" as const,
                id: "delete-all-archived",
                label: "删除全部会话",
                danger: true,
                onClick: () => void deleteArchivedSessions(),
              },
            ]
          : []),
        ...(menuGroup.cwd
          ? [
              {
                type: "item" as const,
                id: "hide",
                label: hiddenKeySet.has(menuGroup.key) ? "取消隐藏" : "隐藏工作区",
                onClick: () => {
                  setMenu(undefined);
                  void (
                    hiddenKeySet.has(menuGroup.key)
                      ? window.grok.revealWorkspace(menuGroup.key)
                      : window.grok.hideWorkspace(menuGroup.key)
                  ).then(setState);
                },
              },
              { type: "sep" as const, id: "sep-hide" },
              {
                type: "item" as const,
                id: "delete-workspace",
                label: "删除工作区",
                danger: true,
                onClick: () => {
                  setMenu(undefined);
                  void window.grok.deleteWorkspace(menuGroup.key).then(setState);
                },
              },
            ]
          : []),
      ]
    : [];
  const sortMenuItems: MenuEntry[] = [
    { type: "label", id: "group-sort", label: "分组" },
    ...GROUP_SORT_OPTIONS.map((option) => ({
      type: "item" as const,
      id: `group-${option.id}`,
      label: option.label,
      checked: state.groupSort === option.id,
      onClick: () => {
        setMenu(undefined);
        if (option.id === "custom") {
          const keys = workspaceGroups.map((group) => group.key);
          void window.grok.reorderGroups(mergeOrder(keys, state.groupOrder ?? [])).then(setState);
          return;
        }
        void window.grok.setSidebarSort(option.id, state.sessionSort).then(setState);
      },
    })),
    { type: "sep", id: "sort-sep" },
    { type: "label", id: "session-sort", label: "会话" },
    ...SESSION_SORT_OPTIONS.map((option) => ({
      type: "item" as const,
      id: `session-${option.id}`,
      label: option.label,
      checked: state.sessionSort === option.id,
      onClick: () => {
        setMenu(undefined);
        if (option.id === "custom") {
          const order: Record<string, string[]> = {};
          for (const group of liveGroups) order[group.key] = group.sessions.map((session) => session.sessionId);
          if (archivedSessions.length) order.__archived__ = archivedSessions.map((session) => session.sessionId);
          void window.grok.reorderSessionsBulk(order).then(setState);
          return;
        }
        void window.grok.setSidebarSort(state.groupSort, option.id).then(setState);
      },
    })),
  ];

  const firstProjectKey = liveGroups.find((group) => group.key !== "__pinned__")?.key;
  const listToolbar = (
    <div className="workspace-actions">
            <span className="nav-section-label">项目</span>
            {(liveGroups.length > 0 || archivedSessions.length > 0) && (
              <div className="group-bulk">
                <button
                  className="icon-btn"
                  type="button"
                  title="展开所有项目"
                  onClick={() => void window.grok.setCollapsedGroups([]).then(setState)}
                >
                  <ChevronsDown size={16} />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  title="收起所有项目"
                  onClick={() => {
                    const keys = [
                      ...liveGroups.flatMap((group) => [group.key, ...(group.nested?.map((child) => child.key) ?? [])]),
                      ...(hiddenWorkspaceGroups.length ? ["__hidden__"] : []),
                      ...(archivedSessions.length ? ["__archived__"] : []),
                    ];
                    void window.grok.setCollapsedGroups(keys).then(setState);
                  }}
                >
                  <ChevronsUp size={16} />
                </button>
                <button
                  className={`icon-btn ${menu?.kind === "sort" ? "on" : ""}`}
                  type="button"
                  title="排序方式"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    clearTimeout(hoverTimer.current);
                    setHover(undefined);
                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu((current) =>
                      current?.kind === "sort"
                        ? undefined
                        : { kind: "sort", x: rect.right, y: rect.bottom },
                    );
                  }}
                >
                  <ListFilter size={16} />
                </button>
              </div>
            )}
          </div>
  );

  const appClass = [
    "app",
    state.sidebarCollapsed ? "sidebar-collapsed" : "",
    state.inspectorOpen && !studioTab ? "inspector-open" : "",
    state.settings.compactMode ? "compact" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const home = !state.sessionId;

  return (
    <div className={appClass} style={{ ["--inspector" as string]: `${inspectorWidth}px` }}>
      {state.sidebarCollapsed ? (
        <aside className="rail pane">
          <button className="icon-btn" type="button" title="展开侧栏" onClick={() => void window.grok.setSidebarCollapsed(false)}>
            <PanelLeft size={18} />
          </button>
          <button className="icon-btn" type="button" title="搜索对话" aria-label="搜索对话" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
          <button className="icon-btn" type="button" title="添加对话" onClick={() => void beginNew()}>
            <Plus size={18} />
          </button>
          <button
            className={`icon-btn ${studioTab === "image" ? "on" : ""}`}
            type="button"
            title="图片生成"
            onClick={() => setStudioTab("image")}
          >
            <ImageIcon size={18} />
          </button>
          <button
            className={`icon-btn ${studioTab === "video" ? "on" : ""}`}
            type="button"
            title="视频生成"
            onClick={() => setStudioTab("video")}
          >
            <Video size={18} />
          </button>
          <button
            className={`icon-btn ${studioTab === "voice" ? "on" : ""}`}
            type="button"
            title="语音转写"
            onClick={() => setStudioTab("voice")}
          >
            <Mic size={18} />
          </button>
          <div className="rail-foot">
            <button
              className="icon-btn"
              type="button"
              title="设置"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={18} />
            </button>
            {state.update?.updateAvailable ? (
              <button
                className="update-proto rail-update"
                type="button"
                title={`更新到 ${state.update.latestVersion}`}
                onClick={() => {
                  setChangelogOpen(true);
                  void window.grok.checkUpdate().then(setState);
                }}
              >
                更新
              </button>
            ) : null}
          </div>
        </aside>
      ) : (
        <aside className="sidebar pane">
          <div className="sidebar-head">
            <span className="brand-mark">Grok Harness</span>
            <button className="icon-btn" type="button" title="收起侧栏" onClick={() => void window.grok.setSidebarCollapsed(true)}>
              <PanelLeft size={16} />
            </button>
          </div>
          <SidebarNavigation studioTab={studioTab} onNew={() => void beginNew()} onSearch={() => setSearchOpen(true)} onWorkspace={() => void pickAndStart()} onStudio={setStudioTab} />


          <div className="session-list">
            {liveSessions.length === 0 && archivedSessions.length === 0 && (
              <div className="session-empty">本机还没有会话</div>
            )}
            {liveGroups.map((group) => {
              const isCollapsed = state.collapsedGroups.includes(group.key);
              const nested = group.nested ?? [];
              return (
                <Fragment key={group.key}>
                {group.key === firstProjectKey ? listToolbar : null}
                <section className={`session-group ${group.key === "__pinned__" ? "pinned" : "project"}`}>
                  <header
                    className={`session-group-head ${menu?.kind === "group" && menu.id === group.key ? "menu-open" : ""} ${sidebarDrag?.kind === "group" && sidebarDrag.key === group.key ? "dragging" : ""} ${sidebarDrag?.kind === "group" && sidebarDrag.overId === group.key ? `drop-${sidebarDrag.edge}` : ""}`}
                    draggable={Boolean(group.cwd)}
                    onMouseEnter={(event) => showGroupHover(event, group)}
                    onMouseLeave={hideGroupHover}
                    onContextMenu={(event) => placeMenu(event, { kind: "group", id: group.key })}
                    onDragStart={(event) => {
                      if (!group.cwd) {
                        event.preventDefault();
                        return;
                      }
                      beginGroupDrag(event, group.key);
                    }}
                    onDragOver={(event) => {
                      if (group.cwd) hoverDrop(event, "group", group.key);
                    }}
                    onDrop={(event) => {
                      if (group.cwd) dropGroup(event, group.key);
                    }}
                    onDragEnd={() => {
                      sidebarDragRef.current = undefined;
                      setSidebarDrag(undefined);
                    }}
                  >
                    <div
                      className="session-group-toggle"
                      aria-expanded={!isCollapsed}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (skipGroupClick.current) {
                          skipGroupClick.current = false;
                          return;
                        }
                        void window.grok.toggleGroup(group.key).then(setState);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void window.grok.toggleGroup(group.key).then(setState);
                        }
                      }}
                    >
                      {group.cwd ? (isCollapsed ? <FolderClosed className="project-folder" size={16} /> : <FolderOpen className="project-folder" size={16} />) : <FoldChevron open={!isCollapsed} />}
                      <span className="session-group-copy">
                        <strong>{group.label}</strong>
                      </span>
                      <span className="session-count">{group.sessions.length}</span>
                    </div>
                    {group.cwd && (
                      <button className="btn tiny" type="button" title="在此目录新建会话" draggable={false} onClick={() => void startIn(group.cwd!)}>
                        +
                      </button>
                    )}
                    {group.cwd ? (
                      <button
                        className="kebab"
                        type="button"
                        title="工作区操作"
                        draggable={false}
                        onClick={(event) => placeMenu(event, { kind: "group", id: group.key })}
                      >
                        ⋯
                      </button>
                    ) : null}
                  </header>
                  <Fold collapsed={isCollapsed}>
                    {nested.length > 0
                      ? nested.map((child) => {
                          const childCollapsed = state.collapsedGroups.includes(child.key);
                          return (
                            <div className="session-subgroup" key={child.key}>
                              <header
                                className="session-group-head"
                                onMouseEnter={(event) => showGroupHover(event, child)}
                                onMouseLeave={hideGroupHover}
                                onContextMenu={(event) => placeMenu(event, { kind: "group", id: child.key })}
                              >
                                <button
                                  className="session-group-toggle"
                                  type="button"
                                  aria-expanded={!childCollapsed}
                                  onClick={() => void window.grok.toggleGroup(child.key).then(setState)}
                                >
                                  {childCollapsed ? <FolderClosed className="project-folder" size={16} /> : <FolderOpen className="project-folder" size={16} />}
                                  <span className="session-group-copy">
                                    <strong>{child.label}</strong>
                                  </span>
                                  <span className="session-count">{child.sessions.length}</span>
                                </button>
                                {child.cwd && (
                                  <button
                                    className="btn tiny"
                                    type="button"
                                    title="在此目录新建会话"
                                    onClick={() => void startIn(child.cwd!)}
                                  >
                                    +
                                  </button>
                                )}
                              </header>
                              <Fold collapsed={childCollapsed}>
                                {child.sessions.map((session) => (
                                  <SessionRow
                                    key={session.sessionId}
                                    session={session}
                                    active={!studioTab && session.sessionId === state.sessionId}
                                    busy={sessionLive(session, state)}
                                    runningHint={formatSessionRunning(session)}
                                    menuOpen={menu?.kind === "session" && menu.id === session.sessionId}
                                    renaming={renamingId === session.sessionId}
                                    onOpen={() => void openSession(session)}
                                    onPin={(event) => void pinSession(event, session)}
                                    onMenu={(event) => placeMenu(event, { kind: "session", id: session.sessionId })}
                                    onStartRename={() => setRenamingId(session.sessionId)}
                                    onRename={(title) => void renameSession(session, title)}
                                    onCancelRename={() => setRenamingId(undefined)}
                                    {...sessionDragProps(session, child.key, child.sessions)}
                                  />
                                ))}
                              </Fold>
                            </div>
                          );
                        })
                      : group.sessions.map((session) => (
                          <SessionRow
                            key={session.sessionId}
                            session={session}
                            active={!studioTab && session.sessionId === state.sessionId}
                            busy={sessionLive(session, state)}
                            runningHint={formatSessionRunning(session)}
                            menuOpen={menu?.kind === "session" && menu.id === session.sessionId}
                            renaming={renamingId === session.sessionId}
                            onOpen={() => void openSession(session)}
                            onPin={(event) => void pinSession(event, session)}
                            onMenu={(event) => placeMenu(event, { kind: "session", id: session.sessionId })}
                            onStartRename={() => setRenamingId(session.sessionId)}
                            onRename={(title) => void renameSession(session, title)}
                            onCancelRename={() => setRenamingId(undefined)}
                            {...sessionDragProps(session, group.key, group.sessions)}
                          />
                        ))}
                  </Fold>
                </section>
                </Fragment>
              );
            })}
            {!firstProjectKey ? listToolbar : null}
            {hiddenWorkspaceGroups.length > 0 && (
              <section className="session-group hidden-workspaces">
                <header className="session-group-head">
                  <button
                    className="session-group-toggle"
                    type="button"
                    onClick={() => void window.grok.toggleGroup("__hidden__").then(setState)}
                  >
                    <FoldChevron open={!hiddenCollapsed} />
                    <span className="session-group-copy">
                      <strong>已隐藏</strong>
                    </span>
                    <span className="session-count">{hiddenWorkspaceGroups.length}</span>
                  </button>
                </header>
                <Fold collapsed={hiddenCollapsed}>
                  {hiddenWorkspaceGroups.map((group) => (
                    <div
                      className={`session-group-head hidden-row ${menu?.kind === "group" && menu.id === group.key ? "menu-open" : ""}`}
                      key={group.key}
                    >
                      <button
                        className="session-group-toggle"
                        type="button"
                        title={group.cwd}
                        onClick={() => void window.grok.revealWorkspace(group.key).then(setState)}
                      >
                        <span className="session-group-copy">
                          <strong>{group.label}</strong>
                        </span>
                        <span className="session-count">{group.sessions.length}</span>
                      </button>
                      <button
                        className="kebab"
                        type="button"
                        title="工作区操作"
                        onClick={(event) => placeMenu(event, { kind: "group", id: group.key })}
                      >
                        ⋯
                      </button>
                    </div>
                  ))}
                </Fold>
              </section>
            )}
            {archivedSessions.length > 0 && (
              <section className={`session-group archived ${archiveSelecting ? "selecting" : ""}`}>
                <header
                  className={`session-group-head ${menu?.kind === "group" && menu.id === "__archived__" ? "menu-open" : ""}`}
                  onMouseEnter={(event) => showGroupHover(event, archivedGroup)}
                  onMouseLeave={hideGroupHover}
                  onContextMenu={(event) => placeMenu(event, { kind: "group", id: "__archived__" })}
                >
                  <button
                    className="session-group-toggle"
                    type="button"
                    onClick={() => void window.grok.toggleGroup("__archived__").then(setState)}
                  >
                    <FoldChevron open={!archivedCollapsed} />
                    <span className="session-group-copy">
                      <strong>已归档</strong>
                    </span>
                    <span className="session-count">
                      {archiveSelecting
                        ? `${archiveSelected.size}/${archivedSessions.length}`
                        : archivedSessions.length}
                    </span>
                  </button>
                  {archiveSelecting ? (
                    <button className="text-action" type="button" title="完成选择" onClick={exitArchiveSelect}>
                      完成
                    </button>
                  ) : (
                    <>
                      <button
                        className="text-action"
                        type="button"
                        title="选择会话"
                        onClick={() => void beginArchiveSelect()}
                      >
                        选择
                      </button>
                      <button
                        className="kebab"
                        type="button"
                        title="归档操作"
                        onClick={(event) => placeMenu(event, { kind: "group", id: "__archived__" })}
                      >
                        ⋯
                      </button>
                    </>
                  )}
                </header>
                {archiveSelecting ? (
                  <div className="archive-select-bar">
                    <button
                      className="text-action"
                      type="button"
                      onClick={() =>
                        setArchiveSelected(
                          archiveAllSelected
                            ? new Set()
                            : new Set(archivedSessions.map((session) => session.sessionId)),
                        )
                      }
                    >
                      {archiveAllSelected ? "取消全选" : "全选"}
                    </button>
                    <button
                      className="text-action danger"
                      type="button"
                      disabled={archiveSelected.size === 0}
                      onClick={() => void deleteArchivedSessions([...archiveSelected])}
                    >
                      删除已选
                    </button>
                    <button
                      className="text-action danger"
                      type="button"
                      onClick={() => void deleteArchivedSessions()}
                    >
                      全部删除
                    </button>
                  </div>
                ) : null}
                <Fold collapsed={archivedCollapsed}>
                  {archivedSessions.map((session) => (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      active={!studioTab && session.sessionId === state.sessionId}
                      busy={sessionLive(session, state)}
                      runningHint={formatSessionRunning(session)}
                      menuOpen={menu?.kind === "session" && menu.id === session.sessionId}
                      renaming={renamingId === session.sessionId}
                      selecting={archiveSelecting}
                      selected={archiveSelected.has(session.sessionId)}
                      onOpen={() => void openSession(session)}
                      onPin={(event) => void pinSession(event, session)}
                      onMenu={(event) => placeMenu(event, { kind: "session", id: session.sessionId })}
                      onStartRename={() => setRenamingId(session.sessionId)}
                      onRename={(title) => void renameSession(session, title)}
                      onCancelRename={() => setRenamingId(undefined)}
                      onToggleSelect={() => toggleArchiveSelected(session.sessionId)}
                      {...(archiveSelecting ? {} : sessionDragProps(session, "__archived__", archivedSessions))}
                    />
                  ))}
                </Fold>
              </section>
            )}
          </div>
          <div className="user-dock" ref={accountDockRef}>
            {accountOpen && (
              <div
                className="user-pop"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <h3>{account.email ?? "Grok 账户"}</h3>
                <dl>
                  <dt>状态</dt>
                  <dd>{statusLabel(state.connection)}</dd>
                  <dt>套餐</dt>
                  <dd>{account.plan ?? quota?.plan ?? "—"}</dd>
                  <dt>模型</dt>
                  <dd>{account.modelName ?? state.modelName ?? "—"}</dd>
                  <dt>版本</dt>
                  <dd>{account.agentVersion ?? state.agentVersion ?? "—"}</dd>
                </dl>
                <div className="quota">
                  <div className="user-copy">
                    <span>额度使用</span>
                  </div>
                  {used != null ? (
                    <>
                      <div className="quota-bar">
                        <i style={{ width: `${Math.min(100, Math.max(0, used))}%` }} />
                      </div>
                      <small>
                        已用 {Math.round(used)}%
                        {quota?.period ? ` · ${quota.period}` : ""}
                        {quota?.resetAt ? ` · 重置 ${new Date(quota.resetAt).toLocaleString()}` : ""}
                        {quota?.extraCredits ? ` · 额外 ${quota.extraCredits}` : ""}
                      </small>
                    </>
                  ) : (
                    <small>暂无额度数据，可刷新账户状态。</small>
                  )}
                </div>
                <button
                  className="linkish"
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    setChangelogOpen(true);
                    void window.grok.checkUpdate().then(setState);
                  }}
                >
                  更新日志
                </button>
                <button
                  className="linkish"
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    setUsageOpen(true);
                  }}
                >
                  Token 消耗
                </button>
                <button
                  className="linkish"
                  type="button"
                  onClick={() => {
                    setAccountOpen(false);
                    setSettingsOpen(true);
                  }}
                >
                  打开设置
                </button>
                <button className="linkish" type="button" onClick={() => {
                  setAccountOpen(false);
                  setDesktopOpen(true);
                }}>桌面应用与更新</button>
              </div>
            )}
            <div className="user-dock-bar">
              <button
                aria-expanded={accountOpen}
                aria-label="账户菜单"
                className="user-chip"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setAccountOpen((open) => !open);
                  if (!accountOpen) void window.grok.refreshAccount().then(setState);
                }}
              >
                <span className="avatar">{initial}</span>
                <span className="user-copy">
                  <strong>{account.email ?? "Grok 账号"}</strong>
                  <span>
                    <i className={`status-dot ${state.connection}`} />
                    {statusLabel(state.connection)}
                    {account.plan ? ` · ${account.plan}` : ""}
                  </span>
                </span>
              </button>
              <button
                className="icon-btn"
                type="button"
                title="设置"
                onClick={(event) => {
                  event.stopPropagation();
                  setAccountOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <SettingsIcon size={18} />
              </button>
              {state.update?.updateAvailable ? (
                <button
                  className="update-proto"
                  type="button"
                  title={`Grok Build ${state.update.currentVersion} → ${state.update.latestVersion}`}
                  onClick={() => {
                    setChangelogOpen(true);
                    void window.grok.checkUpdate().then(setState);
                  }}
                >
                  更新
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      )}

      <section className="center pane">
        <div className="topbar">
          <div className="topbar-title" title={studioTab ? undefined : state.sessionTitle || undefined}>
            <strong>
              {studioTab === "image"
                ? "图片生成"
                : studioTab === "video"
                  ? "视频生成"
                  : studioTab === "voice"
                    ? "语音转写"
                    : home
                      ? "新对话"
                      : state.sessionTitle || "未选择对话"}
            </strong>
            {studioTab ? <span className="topbar-cwd">资源库</span> : null}
            {!studioTab && !home && (state.busy || state.backgroundTasks.length) ? (
              <>
                <span
                  className="topbar-spinner"
                  title={state.busy ? "执行中" : formatBackgroundLine(state.backgroundTasks)}
                >
                  <Spinner />
                </span>
                {state.busy ? (
                  <TurnClock startedAt={state.runStats.turnStartedAt} title="本轮已用时间" />
                ) : (
                  <span className="turn-clock" title={state.backgroundTasks.map((task) => task.title).join("\n")}>
                    {formatBackgroundLine(state.backgroundTasks)}
                  </span>
                )}
              </>
            ) : null}
            {!studioTab && (home ? draftWorkspace : state.workspace) ? (
              <span className="topbar-cwd">{folderLabel((home ? draftWorkspace : state.workspace) ?? "")}</span>
            ) : null}
          </div>
          <div className="topbar-actions">
            {!studioTab && currentSession && (
              <button
                className="icon-btn"
                type="button"
                title="会话操作"
                onClick={(event) => placeMenu(event, { kind: "session", id: currentSession.sessionId })}
              >
                <MoreHorizontal size={18} />
              </button>
            )}
            {!studioTab ? (
              <button
                className="icon-btn"
                type="button"
                title={state.inspectorOpen ? "收起右侧" : "打开检查器"}
                onClick={() => void window.grok.setInspectorOpen(!state.inspectorOpen)}
              >
                <PanelRight size={18} />
              </button>
            ) : null}
          </div>
        </div>
        {studioTab ? (
          <MediaStudio
            tab={studioTab}
            busy={state.busy}
            sessionId={state.sessionId}
            voiceCaptureMode={state.settings.voiceCaptureMode}
            voiceLanguage={state.settings.voiceSttLanguage}
            onGenerate={sendComposer}
            onStop={stopTurn}
            onInsertText={(text) => {
              setInjectText(text);
              setStudioTab(undefined);
            }}
            onOpenSession={(sessionId, cwd) => {
              setStudioTab(undefined);
              void window.grok.openSession(sessionId, cwd).then(setState);
            }}
          />
        ) : home ? (
          <div className="home">
            <h1>今天想做什么？</h1>
            <p>从一个想法开始，让 Grok 帮你完成。</p>
            <ComposerPane
              className="home-composer"
              busy={state.busy}
              commands={state.commands}
              models={state.models}
              modelId={state.modelId}
              effort={state.effort}
              placeholder="描述任务，或用 @ 添加上下文"
              rows={4}
              extraToolbar={
                <div className={`chip workspace-chip ${draftWorkspace ? "has-value" : ""}`}>
                  <button
                    className="chip-main"
                    type="button"
                    title={draftWorkspace || "选择工作区"}
                    onClick={() => void pickWorkspace()}
                  >
                    <FolderOpen size={14} />{draftWorkspace ? folderLabel(draftWorkspace) : "选择项目"}
                  </button>
                  {draftWorkspace ? (
                    <button className="chip-clear" type="button" title="移除工作区" onClick={(event) => void clearWorkspace(event)}>
                      ×
                    </button>
                  ) : null}
                </div>
              }
              injectText={injectText}
              onSend={sendComposer}
              onStop={stopTurn}
              onEmptyEnter={sendQueuedNow}
              onModelEffort={setModelEffort}
              onInjectConsumed={consumeInject}
            />
            {(state.error || busyError) && <div className="error-banner">{busyError ?? state.error}</div>}
          </div>
        ) : (
          <>
            <TasksPane tasks={state.backgroundTasks} />
            <div
              className="transcript"
              ref={scroller}
              onWheel={(event) => {
                const node = event.currentTarget;
                if (state.settings.invertScroll) {
                  node.scrollTop -= event.deltaY;
                  event.preventDefault();
                }
                const goingUp = state.settings.invertScroll ? event.deltaY > 0 : event.deltaY < 0;
                if (goingUp) followOutput.current = false;
              }}
            >
              <div className="thread">
                {currentSession?.updateInterrupted ? (
                  <div className="interrupt-banner">
                    <span>这次对话在 Grok Build 更新时被打断，不是手动中断。</span>
                    <button
                      className="btn ghost tiny"
                      type="button"
                      onClick={() => void window.grok.dismissInterrupted(currentSession.sessionId).then(setState)}
                    >
                      知道了
                    </button>
                  </div>
                ) : null}
                <TimelineView
                  items={state.timeline}
                  busy={state.busy}
                  selectedId={selectedToolId}
                  showThoughts={state.settings.showThinkingBlocks}
                  groupTools={state.settings.groupToolVerbs}
                  showTimestamps={state.settings.showTimestamps}
                  onOpenImage={openImage}
                  onSelectTool={selectTool}
                />
                {!state.busy && (state.runStats.durationMs || state.runStats.tokens) ? (
                  <div className="session-stats">
                    本会话
                    {state.runStats.durationMs ? ` ${formatSessionElapsed(state.runStats.durationMs)}` : ""}
                    {state.runStats.tokens ? ` · ${formatTokens(state.runStats.tokens)} tok` : ""}
                  </div>
                ) : null}
                {(state.error || busyError) && (
                  <div className="bubble">
                    <div className="kicker thought">错误</div>
                    <div className="error-banner">{busyError ?? state.error}</div>
                  </div>
                )}
              </div>
            </div>
            <div className="composer-wrap">
              <StillRunningLine tasks={state.backgroundTasks} />
              <PromptQueueBar
                queue={state.promptQueue}
                followUp={state.settings.followUpBehavior}
                holding={Boolean(state.backgroundTasks.length) && !state.busy}
                combine={state.settings.combineQueuedPrompts}
                onSendNow={(id) => void window.grok.sendQueuedNow(id).then(setState)}
                onRemove={(id) => void window.grok.removeQueued(id).then(setState)}
              />
              {state.busy ? (
                <div className="turn-live">
                  进行中 <TurnClock startedAt={state.runStats.turnStartedAt} />
                  {state.runStats.tokens ? ` · ${formatTokens(state.runStats.tokens)} tok` : ""}
                  {state.settings.followUpBehavior === "steer" ? " · 追问将注入空隙" : " · Enter 排队追问"}
                </div>
              ) : null}
              {state.permission && (
                <PermissionBar
                  permission={state.permission}
                  preferred={state.settings.defaultSelectedPermission}
                  rememberApprovals={state.settings.rememberToolApprovals}
                  onChoose={(optionId) => void window.grok.permission(state.permission!.requestId, optionId)}
                />
              )}
              <ComposerPane
                busy={state.busy}
                commands={state.commands}
                models={state.models}
                modelId={state.modelId}
                effort={state.effort}
                placeholder="继续对话，或用 @ 添加上下文"
                rows={3}
                injectText={injectText}
                onSend={sendComposer}
                onStop={stopTurn}
                onEmptyEnter={sendQueuedNow}
                onModelEffort={setModelEffort}
                onInjectConsumed={consumeInject}
              />
            </div>
          </>
        )}
      </section>

      {!studioTab && state.inspectorOpen && (
        <div className="inspector-slot">
          <div
            className="resize-handle"
            onMouseDown={(event) => {
              event.preventDefault();
              resizing.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          />
          <Inspector item={selectedTool} collapsedEdits={state.settings.collapsedEditBlocks} />
        </div>
      )}

      {menu && menu.kind === "session" && menuSession && (
        <PopupMenu x={menu.x} y={menu.y} items={sessionMenuItems} />
      )}
      {menu && menu.kind === "group" && menuGroup && (
        <PopupMenu x={menu.x} y={menu.y} items={groupMenuItems} />
      )}
      {menu && menu.kind === "sort" && <PopupMenu x={menu.x} y={menu.y} items={sortMenuItems} />}
      {!menu && hover && (
        <HoverCard
          x={hover.x}
          y={hover.y}
          title={hover.group.label}
          path={hover.group.cwd}
          lines={groupHoverLines(hover.group)}
        />
      )}

      {searchOpen && <SearchDialog sessions={state.sessions} onOpen={(session) => void openSession(session)} onClose={() => setSearchOpen(false)} />}
      <DesktopPanel open={desktopOpen} onOpen={() => setDesktopOpen(true)} onClose={() => setDesktopOpen(false)} />
      {settingsOpen && (
        <SettingsPanel
          settings={state.settings}
          appearance={appearance}
          onAppearance={setAppearance}
          account={state.account}
          onDesktop={() => { setSettingsOpen(false); setDesktopOpen(true); }}
          onUsage={() => { setSettingsOpen(false); setUsageOpen(true); }}
          onUpdate={() => { setSettingsOpen(false); setChangelogOpen(true); void window.grok.checkUpdate().then(setState); }}
          models={state.models}
          onClose={() => setSettingsOpen(false)}
          onChange={(key, value) => void window.grok.setGrokSetting(key, value).then(setState)}
        />
      )}
      {changelogOpen && (
        <UpdatePanel
          update={state.update}
          onClose={() => setChangelogOpen(false)}
          onApply={() => {
            void window.grok.applyUpdate().then((snap) => {
              setState(snap);
              if (!snap.update?.updateAvailable && !snap.update?.error) setChangelogOpen(false);
            });
          }}
        />
      )}
      {usageOpen && <UsagePanel usage={state.tokenUsage} onClose={() => setUsageOpen(false)} />}
      {lightbox && (
        <Dialog title={lightbox.name || "图片预览"} className="chat-image-panel" onClose={() => setLightbox(undefined)}>
          <img src={lightbox.src} alt={lightbox.name || "对话图片"} onContextMenu={(event) => {
            event.preventDefault();
            if (!/^https?:/i.test(lightbox.path)) void window.grok.imageMenu(lightbox.path);
          }} />
        </Dialog>
      )}
    </div>
  );
}

function statusLabel(state: AppSnapshot["connection"]): string {
  switch (state) {
    case "ready":
      return "已连接";
    case "starting":
      return "启动中";
    case "error":
      return "出错";
    case "stopped":
      return "未连接";
    default:
      return "未连接";
  }
}

function sessionTitle(session: SessionSummary): string {
  return session.title?.trim() || "未命名对话";
}

function sortSessions(
  sessions: SessionSummary[],
  sort: SessionSort,
  pinFirst = false,
  customOrder?: string[],
): SessionSummary[] {
  if (sort === "custom") {
    const rank = new Map((customOrder ?? []).map((id, index) => [id, index]));
    return [...sessions].sort((a, b) => {
      const ia = rank.get(a.sessionId);
      const ib = rank.get(b.sessionId);
      if (ia == null && ib == null) return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
      if (ia == null) return -1;
      if (ib == null) return 1;
      return ia - ib;
    });
  }
  return [...sessions].sort((a, b) => {
    if (pinFirst && sort === "recent") {
      const pinDelta = (b.pinOrder ?? 0) - (a.pinOrder ?? 0);
      if (pinDelta) return pinDelta;
    }
    if (sort === "title-asc") return sessionTitle(a).localeCompare(sessionTitle(b), "zh-CN", { numeric: true });
    if (sort === "title-desc") return sessionTitle(b).localeCompare(sessionTitle(a), "zh-CN", { numeric: true });
    return (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0);
  });
}

function groupLatest(group: SessionGroup): number {
  return Math.max(0, ...group.sessions.map((session) => session.updatedAtMs ?? 0));
}

function sortGroups(groups: SessionGroup[], sort: GroupSort, customOrder?: string[]): SessionGroup[] {
  if (sort === "custom") {
    const rank = new Map((customOrder ?? []).map((key, index) => [key, index]));
    return [...groups].sort((a, b) => {
      const ia = rank.get(a.key);
      const ib = rank.get(b.key);
      if (ia == null && ib == null) return groupLatest(b) - groupLatest(a);
      if (ia == null) return 1;
      if (ib == null) return -1;
      return ia - ib;
    });
  }
  return [...groups].sort((a, b) => {
    if (sort === "name-asc") return a.label.localeCompare(b.label, "zh-CN", { numeric: true });
    if (sort === "name-desc") return b.label.localeCompare(a.label, "zh-CN", { numeric: true });
    if (sort === "count") {
      const countDelta = b.sessions.length - a.sessions.length;
      if (countDelta) return countDelta;
      return a.label.localeCompare(b.label, "zh-CN", { numeric: true });
    }
    return groupLatest(b) - groupLatest(a);
  });
}

function groupsByCwd(
  sessions: SessionSummary[],
  sort: SessionSort,
  groupSort: GroupSort,
  groupOrder: string[] = [],
  sessionOrder: Record<string, string[]> = {},
  keyPrefix = "",
  pinFirst = false,
): SessionGroup[] {
  const map = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const cwd = session.cwd?.trim() || "(unknown)";
    const key = keyPrefix ? `${keyPrefix}${normalizeGroupKey(cwd)}` : normalizeGroupKey(cwd);
    const list = map.get(key) ?? [];
    list.push(session);
    map.set(key, list);
  }
  const rest = [...map.entries()].map(([key, rows]) => ({
    key,
    label: folderLabel(rows[0]?.cwd?.trim() || key),
    cwd: key === "(unknown)" || key.startsWith("__") ? undefined : rows[0]?.cwd?.trim() || key,
    sessions: sortSessions(rows, sort, pinFirst, sessionOrder?.[key]),
  }));
  return sortGroups(rest, groupSort, groupOrder);
}

function buildGroups(
  sessions: SessionSummary[],
  groupSort: GroupSort,
  sessionSort: SessionSort,
  groupOrder: string[] = [],
  sessionOrder: Record<string, string[]> = {},
): SessionGroup[] {
  const pinned = sessions.filter((session) => session.pinned);
  const unpinned = sessions.filter((session) => !session.pinned);
  const groups: SessionGroup[] = [];
  if (pinned.length) {
    groups.push({
      key: "__pinned__",
      label: "置顶",
      sessions: sortSessions(pinned, sessionSort, true, sessionOrder?.__pinned__),
    });
  }
  return [...groups, ...groupsByCwd(unpinned, sessionSort, groupSort, groupOrder, sessionOrder)];
}

function folderLabel(cwd: string): string {
  if (cwd === "(unknown)") return "未知目录";
  const parts = cwd.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function formatSessionCopy(session: SessionSummary): string {
  const lines = [session.title || "未命名对话", `会话 ID: ${session.sessionId}`];
  if (session.cwd) lines.push(`工作目录: ${session.cwd}`);
  const ms = session.updatedAtMs ?? (session.updatedAt ? Date.parse(session.updatedAt) : Number.NaN);
  if (Number.isFinite(ms)) lines.push(`更新时间: ${new Date(ms).toLocaleString()}`);
  return lines.join("\n");
}

function groupHoverLines(group: SessionGroup): string[] {
  const count =
    group.key === "__pinned__" || group.key.startsWith("__pinned__:")
      ? `${group.sessions.length} 个置顶会话`
      : group.key === "__archived__"
        ? `${group.sessions.length} 个已归档会话`
        : `${group.sessions.length} 个会话`;
  const latest = Math.max(0, ...group.sessions.map((session) => session.updatedAtMs ?? 0));
  return latest ? [count, `最近 ${formatAgo(latest)}`] : [count];
}

function formatAgo(value?: string | number): string {
  if (value == null || value === "") return "";
  const ms = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  const delta = Date.now() - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`;
  return new Date(ms).toLocaleDateString();
}

function formatClock(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
