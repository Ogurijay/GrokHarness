import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ComposerSubmitPayload, MentionHit, ModelInfo, PromptAttachment, SessionRef, SlashCommand } from "../shared/types";
import { ModelEffortPicker } from "./ModelEffortPicker";
import { useImeEnterGuard } from "./ime";
import { AttachIcon, ComposerSubmit } from "./composer-controls";

function MentionMenu({
  hits,
  activeIndex,
  onPick,
}: {
  hits: MentionHit[];
  activeIndex: number;
  onPick: (hit: MentionHit) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const item = activeRef.current;
    const menu = item?.closest(".slash-menu");
    if (!item || !(menu instanceof HTMLElement)) return;
    const itemRect = item.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (itemRect.top < menuRect.top) menu.scrollTop -= menuRect.top - itemRect.top;
    else if (itemRect.bottom > menuRect.bottom) menu.scrollTop += itemRect.bottom - menuRect.bottom;
  }, [activeIndex, hits]);
  return (
    <div className="slash-menu mention-menu" role="listbox">
      {hits.map((hit, index) => (
        <button
          key={hit.id}
          ref={index === activeIndex ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`slash-item ${index === activeIndex ? "active" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(hit);
          }}
        >
          <code>{hit.kind === "session" ? "对话" : "文件"}</code>
          <span>{hit.label}</span>
          {hit.detail ? <em>{hit.detail}</em> : null}
        </button>
      ))}
    </div>
  );
}

function ComposerChips({
  attachments,
  sessionRefs,
  onRemoveAttachment,
  onRemoveSession,
}: {
  attachments: PromptAttachment[];
  sessionRefs: SessionRef[];
  onRemoveAttachment: (id: string) => void;
  onRemoveSession: (sessionId: string) => void;
}) {
  if (!attachments.length && !sessionRefs.length) return null;
  return (
    <div className="composer-chips">
      {attachments.map((item) => (
        <div className={`attach-chip ${item.kind}`} key={item.id} title={item.path}>
          {item.kind === "image" && item.preview ? (
            <img src={item.preview} alt="" />
          ) : (
            <span className="attach-kind">{item.kind === "image" ? "图" : "文件"}</span>
          )}
          <span className="attach-name">{item.name}</span>
          <button type="button" className="chip-clear" title="移除" onClick={() => onRemoveAttachment(item.id)}>
            ×
          </button>
        </div>
      ))}
      {sessionRefs.map((item) => (
        <div className="attach-chip session" key={item.sessionId} title={item.cwd || item.sessionId}>
          <span className="attach-kind">对话</span>
          <span className="attach-name">{item.title}</span>
          <button type="button" className="chip-clear" title="移除" onClick={() => onRemoveSession(item.sessionId)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function SlashMenu({
  commands,
  activeIndex,
  onPick,
}: {
  commands: SlashCommand[];
  activeIndex: number;
  onPick: (name: string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const item = activeRef.current;
    const menu = item?.closest(".slash-menu");
    if (!item || !(menu instanceof HTMLElement)) return;
    const itemRect = item.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    if (itemRect.top < menuRect.top) menu.scrollTop -= menuRect.top - itemRect.top;
    else if (itemRect.bottom > menuRect.bottom) menu.scrollTop += itemRect.bottom - menuRect.bottom;
  }, [activeIndex, commands]);
  return (
    <div className="slash-menu" role="listbox">
      {commands.map((command, index) => (
        <button
          key={command.name}
          ref={index === activeIndex ? activeRef : undefined}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`slash-item ${index === activeIndex ? "active" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(command.name);
          }}
        >
          <code>/{command.name}</code>
          <span>{command.description}</span>
          {command.hint ? <em>{command.hint}</em> : null}
        </button>
      ))}
    </div>
  );
}

export const ComposerPane = memo(function ComposerPane({
  className,
  busy,
  commands,
  models,
  modelId,
  effort,
  placeholder,
  rows,
  extraToolbar,
  injectText,
  onSend,
  onStop,
  onEmptyEnter,
  onModelEffort,
  onInjectConsumed,
}: {
  className?: string;
  busy: boolean;
  commands: SlashCommand[];
  models: ModelInfo[];
  modelId?: string;
  effort?: string;
  placeholder: string;
  rows: number;
  extraToolbar?: ReactNode;
  injectText?: string;
  onSend: (payload: ComposerSubmitPayload) => Promise<void>;
  onStop: () => Promise<void>;
  onEmptyEnter?: () => Promise<void>;
  onModelEffort: (modelId: string, effort?: string) => void;
  onInjectConsumed?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [sessionRefs, setSessionRefs] = useState<SessionRef[]>([]);
  const [mentionHits, setMentionHits] = useState<MentionHit[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dropping, setDropping] = useState(false);
  const { shouldHoldEnter, onCompositionEnd } = useImeEnterGuard();

  const slashQuery = useMemo(() => {
    const match = draft.match(/^\/([^\s]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [draft]);
  const slashHits = useMemo(() => {
    if (slashQuery == null) return [];
    return commands.filter((command) => command.name.toLowerCase().includes(slashQuery)).slice(0, 14);
  }, [slashQuery, commands]);
  const mentionQuery = useMemo(() => {
    if (slashQuery != null) return null;
    const match = draft.match(/(^|\s)@([^\s]*)$/);
    return match ? match[2] : null;
  }, [draft, slashQuery]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!injectText) return;
    setDraft((value) => {
      const pad = !value || /\s$/.test(value) ? "" : " ";
      return `${value}${pad}${injectText}`;
    });
    onInjectConsumed?.();
  }, [injectText, onInjectConsumed]);

  useEffect(() => {
    setMentionIndex(0);
    if (mentionQuery == null) {
      setMentionHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.grok.searchMentions(mentionQuery).then((hits) => {
        if (!cancelled) setMentionHits(hits);
      });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionQuery]);

  function mergeAttachments(rows: PromptAttachment[]) {
    setAttachments((prev) => {
      const seen = new Set(prev.map((item) => item.path));
      const next = [...prev];
      for (const row of rows) {
        if (seen.has(row.path) || next.length >= 20) continue;
        seen.add(row.path);
        next.push(row);
      }
      return next;
    });
  }

  async function addPaths(paths: string[]) {
    if (!paths.length) return;
    const rows = await window.grok.inspectPaths(paths);
    if (rows.length) mergeAttachments(rows);
  }

  async function pickAttachments() {
    const rows = await window.grok.pickFiles();
    if (rows.length) mergeAttachments(rows);
  }

  async function pickMention(hit: MentionHit) {
    setMentionHits([]);
    setDraft((value) => value.replace(/(^|\s)@[^\s]*$/, "$1"));
    if (hit.kind === "file" && hit.path) {
      await addPaths([hit.path]);
      return;
    }
    if (hit.kind === "session" && hit.sessionId) {
      const ref: SessionRef = { sessionId: hit.sessionId, title: hit.label, cwd: hit.cwd };
      setSessionRefs((prev) => (prev.some((item) => item.sessionId === ref.sessionId) ? prev : [...prev, ref].slice(0, 5)));
    }
  }

  async function onComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const fileList = event.clipboardData?.files;
    const paths: string[] = [];
    if (fileList?.length) {
      for (const file of fileList) {
        const path = (file as File & { path?: string }).path;
        if (path) paths.push(path);
      }
    }
    if (paths.length) {
      event.preventDefault();
      await addPaths(paths);
      return;
    }
    const items = event.clipboardData?.items;
    const hasImage = items ? [...items].some((item) => item.type.startsWith("image/")) : false;
    if (!hasImage) return;
    event.preventDefault();
    const shot = await window.grok.saveClipboardImage();
    if (shot) mergeAttachments([shot]);
  }

  function onComposerDragOver(event: DragEvent<HTMLDivElement>) {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropping(true);
  }

  async function onComposerDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropping(false);
    const paths = [...event.dataTransfer.files]
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    await addPaths(paths);
  }

  function completeSlash(name: string) {
    const command = commands.find((item) => item.name === name);
    setDraft(command?.hint ? `/${name} ` : `/${name}`);
  }

  function insertComposerNewline(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = `${draft.slice(0, start)}\n${draft.slice(end)}`;
    setDraft(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 1;
    });
  }

  const emptyComposer = !draft.trim() && !attachments.length && !sessionRefs.length;

  async function submit(now = false) {
    if (busy && !now && emptyComposer) {
      await onEmptyEnter?.();
      return;
    }
    if (emptyComposer) return;
    const pendingFiles = attachments;
    const pendingRefs = sessionRefs;
    const text = draft.trim();
    setDraft("");
    setAttachments([]);
    setSessionRefs([]);
    setMentionHits([]);
    try {
      await onSend({ text, attachments: pendingFiles, sessionRefs: pendingRefs, now });
    } catch {
      setDraft(text);
      setAttachments(pendingFiles);
      setSessionRefs(pendingRefs);
    }
  }

  async function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldHoldEnter(event)) return;
    const newline = event.key === "Enter" && (event.ctrlKey || event.metaKey);
    const plainEnter = event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    if (newline) {
      insertComposerNewline(event);
      return;
    }
    if (mentionHits.length > 0 && mentionQuery != null) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % mentionHits.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => (index - 1 + mentionHits.length) % mentionHits.length);
        return;
      }
      if (event.key === "Tab" || plainEnter) {
        event.preventDefault();
        const hit = mentionHits[mentionIndex] ?? mentionHits[0];
        if (hit) await pickMention(hit);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionHits([]);
        return;
      }
    }
    if (slashHits.length > 0 && slashQuery != null) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((index) => (index + 1) % slashHits.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex((index) => (index - 1 + slashHits.length) % slashHits.length);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        completeSlash(slashHits[slashIndex]?.name ?? slashHits[0].name);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDraft("");
        return;
      }
      if (plainEnter) {
        event.preventDefault();
        const hit = slashHits[slashIndex] ?? slashHits[0];
        const typed = draft.slice(1);
        if (typed === hit.name || typed.startsWith(`${hit.name} `)) {
          await submit();
          return;
        }
        completeSlash(hit.name);
        return;
      }
    }
    if (plainEnter) {
      event.preventDefault();
      await submit();
    }
  }

  return (
    <div
      className={`composer ${className ?? ""} ${dropping ? "dropping" : ""}`}
      onDragOver={onComposerDragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => void onComposerDrop(event)}
    >
      {slashHits.length > 0 && (
        <SlashMenu commands={slashHits} activeIndex={slashIndex} onPick={completeSlash} />
      )}
      {mentionHits.length > 0 && (
        <MentionMenu hits={mentionHits} activeIndex={mentionIndex} onPick={(hit) => void pickMention(hit)} />
      )}
      <ComposerChips
        attachments={attachments}
        sessionRefs={sessionRefs}
        onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
        onRemoveSession={(sessionId) => setSessionRefs((prev) => prev.filter((item) => item.sessionId !== sessionId))}
      />
      <textarea
        aria-label="对话输入框"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => void onComposerKey(event)}
        onCompositionEnd={onCompositionEnd}
        onPaste={(event) => void onComposerPaste(event)}
        rows={rows}
      />
      <div className="composer-toolbar">
        <button className="icon-btn attach-btn" type="button" title="添加文件或图片" onClick={() => void pickAttachments()}>
          <AttachIcon />
        </button>
        {extraToolbar}
        <ModelEffortPicker
          models={models}
          modelId={modelId}
          effort={effort}
          disabled={busy}
          onChange={onModelEffort}
        />
        <ComposerSubmit
          busy={busy && emptyComposer}
          disabled={emptyComposer && !busy}
          onClick={() => void (busy && emptyComposer ? onStop() : submit())}
        />
      </div>
      <div className="composer-shortcuts"><span>@ 引用 · / 命令</span><span>Enter 发送 · Ctrl Enter 换行</span></div>
    </div>
  );
});

