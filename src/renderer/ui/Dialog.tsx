import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** Shared modal surface. Focus stays inside and returns to its trigger on close. */
export function Dialog({ title, onClose, className = "", closeLabel, initialFocusSelector, children }: {
  title: string; onClose: () => void; className?: string; closeLabel?: string; initialFocusSelector?: string; children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = previousFocus.current;
    const element = panel.current;
    const initialFocus = initialFocusSelector ? element?.querySelector<HTMLElement>(initialFocusSelector) : null;
    if (initialFocus) initialFocus.focus();
    else if (element && !element.contains(document.activeElement)) element.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== "Tab" || !element) return;
      const targets = [...element.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']")].filter((node) => node.getClientRects().length > 0);
      const first = targets[0]; const last = targets[targets.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
    };
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && element && !element.contains(event.target)) element.focus();
    };
    document.addEventListener("keydown", keys, true);
    document.addEventListener("focusin", keepFocus);
    return () => { document.removeEventListener("keydown", keys, true); document.removeEventListener("focusin", keepFocus); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(
    <div className="settings-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`settings-panel ${className}`} ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="settings-head"><h2 id={id}>{title}</h2><button className="icon-btn" type="button" aria-label={closeLabel || `关闭${title}`} title="关闭" onClick={onClose}><X size={18} /></button></header>
        {children}
      </div>
    </div>, document.body,
  );
}
