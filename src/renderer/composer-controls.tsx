export function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.2v9.6M3.75 7.45 8 3.2l4.25 4.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4.15" y="4.15" width="7.7" height="7.7" rx="1.7" fill="currentColor" />
    </svg>
  );
}

export function AttachIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9.4 4.6 5.15 8.85a2.2 2.2 0 1 0 3.1 3.1l5.05-5.05a3.3 3.3 0 0 0-4.67-4.67L3.4 7.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ComposerSubmit({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`send-btn ${busy ? "stop" : ""}`}
      type="button"
      title={busy ? "停止" : "发送"}
      aria-label={busy ? "停止" : "发送"}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <StopIcon /> : <SendIcon />}
    </button>
  );
}
