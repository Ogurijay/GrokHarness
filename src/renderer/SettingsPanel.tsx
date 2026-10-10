import { useMemo, useRef, useState } from "react";
import type { GrokSettings, SettingsField } from "../shared/grok-settings";
import { SETTINGS_SECTIONS } from "../shared/grok-settings";
import type { ModelInfo } from "../shared/types";
import type { AccountInfo } from "../shared/types";
import { ArrowUpRight, ChevronRight, CircleUserRound, Monitor, Search, Settings2, ShieldCheck, BrainCircuit, Palette, ScrollText, Blocks, MessagesSquare, Wrench, Box, GitBranch, Bell, ScanLine, Terminal, type LucideIcon } from "lucide-react";
import { Dialog } from "./ui/Dialog";
import type { Appearance } from "./ui/appearance";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "桌面外观": Monitor, "账户": CircleUserRound, "权限与批准": ShieldCheck, "模型": BrainCircuit,
  "外观": Palette, "滚动": ScrollText, "功能": Blocks, "会话": MessagesSquare,
  "工具": Wrench, "沙箱": Box, "Worktree": GitBranch, "通知": Bell,
  "兼容扫描": ScanLine, "CLI": Terminal,
};

const MODEL_KEYS = new Set<keyof GrokSettings>([
  "defaultModel",
  "webSearchModel",
  "sessionSummaryModel",
  "imageDescriptionModel",
  "forkSecondaryModel",
]);

function FieldControl({
  field,
  value,
  models,
  onChange,
}: {
  field: SettingsField;
  value: GrokSettings[keyof GrokSettings];
  models: ModelInfo[];
  onChange: (value: unknown) => void;
}) {
  if (MODEL_KEYS.has(field.key) && models.length > 0) {
    const current = String(value ?? "");
    const known = models.some((model) => model.modelId === current);
    const allowEmpty = field.key !== "defaultModel";
    return (
      <select className="chip settings-input" value={current} onChange={(event) => onChange(event.target.value)}>
        {allowEmpty ? <option value="">跟随默认</option> : null}
        {!known && current ? <option value={current}>{current}</option> : null}
        {models.map((model) => (
          <option key={model.modelId} value={model.modelId}>
            {model.name}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "toggle") {
    return (
      <input className="settings-switch" role="switch" type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
    );
  }
  if (field.kind === "select") {
    return (
      <select className="chip settings-input" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.kind === "number") {
    const empty = value === null || value === undefined || Number.isNaN(Number(value));
    return (
      <input
        className="settings-input"
        type="number"
        min={field.min}
        max={field.max}
        placeholder={field.optional ? "默认" : undefined}
        value={empty ? "" : Number(value)}
        onChange={(event) => {
          const text = event.target.value;
          if (text === "") onChange(field.optional ? null : field.min ?? 0);
          else onChange(Number(text));
        }}
      />
    );
  }
  return (
    <input
      className="settings-input"
      type="text"
      placeholder={field.kind === "list" ? "逗号分隔" : undefined}
      value={String(value ?? "")}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function SettingsPanel({
  settings,
  models,
  onClose,
  onChange,
  appearance,
  onAppearance,
  account,
  onDesktop,
  onUsage,
  onUpdate,
}: {
  settings: GrokSettings;
  models: ModelInfo[];
  onClose: () => void;
  onChange: (key: keyof GrokSettings, value: unknown) => void;
  appearance: Appearance;
  onAppearance: (value: Appearance) => void;
  account: AccountInfo;
  onDesktop: () => void;
  onUsage: () => void;
  onUpdate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("桌面外观");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const connectionLabel = account.connection === "ready" ? "已连接" : account.connection === "starting" ? "连接中" : "未连接";
  const usedPercent = account.quota?.usedPercent;
  const usage = usedPercent != null && Number.isFinite(usedPercent) ? Math.min(100, Math.max(0, Math.round(usedPercent))) : undefined;
  const needle = query.trim().toLowerCase();
  const sections = useMemo(() => {
    return SETTINGS_SECTIONS.map((section) => ({
      ...section,
      fields: needle
        ? section.fields.filter((field) =>
            `${section.title} ${field.label} ${field.hint} ${field.key}`.toLowerCase().includes(needle),
          )
        : section.fields,
    })).filter((section) => section.fields.length > 0);
  }, [needle]);

  return (
    <Dialog title="设置" className="preferences-panel" onClose={onClose}>
      <div className="preferences-layout">
        <nav className="preferences-nav" aria-label="设置分类">
          {["桌面外观", "账户", ...SETTINGS_SECTIONS.map((section) => section.title)].map((title) => {
            const Icon = CATEGORY_ICONS[title] ?? Settings2;
            return <button type="button" key={title} className={`preferences-nav-row ${category === title && !needle ? "on" : ""}`} aria-current={category === title && !needle ? "page" : undefined} onClick={() => { setCategory(title); setQuery(""); if (content.current) content.current.scrollTop = 0; }}>
              <Icon size={16} /><span>{title}</span>
            </button>
          })}
          <div className="preferences-nav-links">
            <button onClick={onDesktop}>应用与更新<ArrowUpRight size={14} /></button>
            <button onClick={onUsage}>用量<ArrowUpRight size={14} /></button>
            <button onClick={onUpdate}>Grok Build 更新<ArrowUpRight size={14} /></button>
          </div>
        </nav>
        <div className="preferences-content" ref={content}>
          <div className="preferences-search"><Search size={16} /><input type="search" value={query} placeholder="搜索所有设置" aria-label="搜索所有设置" onChange={(event) => setQuery(event.target.value)} /></div>
          {!needle && category === "桌面外观" ? <>
            <h3 className="preferences-title">桌面外观</h3><p className="preferences-description">调整 Grok Harness 的显示方式。</p>
            <section className="settings-section">
              <div className="settings-row"><span><strong>主题</strong><em>选择浅色、深色或跟随系统。</em></span><div className="theme-options">{([['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={appearance.theme === value} className={appearance.theme === value ? "on" : ""} onClick={() => onAppearance({ ...appearance, theme: value })}>{label}</button>)}</div></div>
              <label className="settings-row"><span><strong>对话字号</strong><em>用于消息正文和输入框。</em></span><select className="settings-input" value={appearance.textSize} onChange={(event) => onAppearance({ ...appearance, textSize: Number(event.target.value) })}>{[13, 14, 15, 16].map((size) => <option key={size} value={size}>{size} px</option>)}</select></label>
              <label className="settings-row"><span><strong>侧栏宽度</strong><em>也可以拖动侧栏右边缘调整。</em></span><input className="settings-input" type="number" min={280} max={520} step={10} value={appearance.sidebarWidth} onChange={(event) => { const width = Number(event.target.value); if (width >= 280 && width <= 520) onAppearance({ ...appearance, sidebarWidth: width }); }} /></label>
              <label className="settings-row"><span><strong>紧凑模式</strong><em>缩小对话中的垂直间距。</em></span><input role="switch" className="settings-switch" type="checkbox" checked={settings.compactMode} onChange={(event) => onChange("compactMode", event.target.checked)} /></label>
            </section>
            <div className="appearance-preview"><span className="preview-user">帮我整理这个项目</span><p>可以。我会先查看项目结构和当前工作区。</p><div><span className="status-dot ready" />Grok · 已就绪</div></div>
          </> : null}
          {!needle && category === "账户" ? <>
            <h3 className="preferences-title">账户</h3><p className="preferences-description">Grok Build 提供的本机账户状态。</p>
            <section className="settings-section account-settings" aria-label="账户信息">
              <div className="account-profile"><span className="avatar">{account.email?.[0]?.toUpperCase() || "G"}</span><span className="account-profile-copy"><strong>{account.email || "Grok 账户"}</strong><small>{account.plan || account.quota?.plan || "暂无套餐信息"}</small></span><span className={`account-connection ${account.connection}`}><i />{connectionLabel}</span></div>
              <div className="settings-row"><span><strong>当前模型</strong></span><span className="account-value">{account.modelName || "—"}</span></div>
              <div className="settings-row"><span><strong>Grok Build 版本</strong></span><span className="account-value">{account.agentVersion || "—"}</span></div>
              <div className="settings-row"><span><strong>额度使用</strong></span><span className="account-value account-usage">{usage == null ? "暂无数据" : <><span>{usage}%</span><span className="account-usage-track" role="progressbar" aria-label="额度使用" aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage}><i style={{ width: `${usage}%` }} /></span></>}</span></div>
              <button type="button" className="settings-action-row" onClick={onDesktop}><span>管理登录与应用更新</span><ChevronRight size={16} /></button>
              <button type="button" className="settings-action-row" onClick={onUsage}><span>查看本机用量</span><ChevronRight size={16} /></button>
            </section>
          </> : null}
          {(needle ? sections : sections.filter((section) => section.title === category)).map((section) => (
          <section className="preferences-group" key={section.title}>
            <h3>{section.title}</h3>
            <div className="settings-section">
            {section.fields.map((field) => (
              <label className="settings-row" key={field.key}>
                <span>
                  <strong>{field.label}</strong>
                  {showAdvanced ? <em>{field.hint}</em> : null}
                </span>
                <FieldControl
                  field={field}
                  value={settings[field.key]}
                  models={models}
                  onChange={(value) => onChange(field.key, value)}
                />
              </label>
            ))}
            </div>
          </section>
        ))}
          {needle && !sections.length ? <div className="panel-empty">没有匹配的设置<span>试试功能或配置项名称。</span></div> : null}
          {(needle || (category !== "桌面外观" && category !== "账户")) ? <label className="advanced-toggle"><input type="checkbox" checked={showAdvanced} onChange={(event) => setShowAdvanced(event.target.checked)} />显示配置项说明</label> : null}
        </div>
      </div>
    </Dialog>
  );
}
