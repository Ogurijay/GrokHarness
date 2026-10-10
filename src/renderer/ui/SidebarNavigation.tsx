import { FolderPlus, Image, ListChecks, MessageSquarePlus, Mic, Search, Video, type LucideIcon } from "lucide-react";
import type { StudioTab } from "../MediaStudio";

export function SidebarNavigation({ studioTab, onNew, onSearch, onWorkspace, onStudio, onManage }: {
  studioTab?: StudioTab; onNew: () => void; onSearch: () => void;
  onWorkspace: () => void; onStudio: (tab: StudioTab) => void;
  onManage?: () => void;
}) {
  const tools: { id: StudioTab; label: string; icon: LucideIcon }[] = [
    { id: "image", label: "图片生成", icon: Image }, { id: "video", label: "视频生成", icon: Video }, { id: "voice", label: "语音转写", icon: Mic },
  ];
  return <nav className="sidebar-navigation" aria-label="主要导航">
    <button className="nav-row" onClick={onNew}><MessageSquarePlus size={16} /><span>新对话</span><kbd>Ctrl N</kbd></button>
    <button className="nav-row" onClick={onSearch}><Search size={16} /><span>搜索对话</span><kbd>Ctrl K</kbd></button>
    {onManage && <button className="nav-row" onClick={onManage}><ListChecks size={16} /><span>管理会话</span></button>}
    <div className="nav-section-label">工具</div>
    {tools.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-row ${studioTab === id ? "on" : ""}`} aria-current={studioTab === id ? "page" : undefined} onClick={() => onStudio(id)}><Icon size={16} /><span>{label}</span></button>)}
    <button className="nav-row add-project" onClick={onWorkspace}><FolderPlus size={16} /><span>添加项目</span></button>
  </nav>;
}
