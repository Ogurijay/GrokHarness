import { Dialog } from "./ui/Dialog";
import { useMemo } from "react";
import type { TokenUsageSummary } from "../shared/types";
import { formatTokens } from "../shared/step-stats";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function addDays(day: Date, count: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + count);
  return next;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function levelFor(tokens: number, max: number): number {
  if (tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function rangeSum(days: Map<string, number>, from: Date, to: Date): number {
  let total = 0;
  for (let cursor = new Date(from); cursor <= to; cursor = addDays(cursor, 1)) {
    total += days.get(dayKey(cursor)) ?? 0;
  }
  return total;
}

export function UsagePanel({
  usage,
  onClose,
}: {
  usage: TokenUsageSummary;
  onClose: () => void;
}) {
  const today = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
  }, []);
  const grid = useMemo(() => {
    const map = new Map(usage.days.map((row) => [row.day, row.tokens]));
    const end = today;
    const start = addDays(end, -end.getDay() - 52 * 7);
    const weeks: { day: string; tokens: number; date: Date }[][] = [];
    let week: { day: string; tokens: number; date: Date }[] = [];
    for (let i = 0; i < 53 * 7; i += 1) {
      const date = addDays(start, i);
      const key = dayKey(date);
      week.push({ day: key, tokens: map.get(key) ?? 0, date });
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    const max = Math.max(0, ...[...map.values()]);
    const weekAgo = addDays(today, -6);
    const monthAgo = addDays(today, -29);
    return {
      weeks,
      max,
      weekTokens: rangeSum(map, weekAgo, today),
      monthTokens: rangeSum(map, monthAgo, today),
    };
  }, [usage.days, today]);

  const monthLabels = useMemo(() => {
    const labels: { index: number; label: string }[] = [];
    let last = -1;
    grid.weeks.forEach((week, index) => {
      const month = week[0]?.date.getMonth() ?? -1;
      if (month !== last) {
        labels.push({ index, label: `${month + 1}月` });
        last = month;
      }
    });
    return labels;
  }, [grid.weeks]);

  return (
    <Dialog title="用量" className="usage-panel" onClose={onClose}>
        <p className="settings-lead">按天统计本机 Grok-Harness 对话里记录到的 token。颜色越深，当天用量越高。</p>
        <div className="usage-kpis">
          <div>
            <strong>{formatTokens(usage.today) || "0"}</strong>
            <span>今天</span>
          </div>
          <div>
            <strong>{formatTokens(grid.weekTokens) || "0"}</strong>
            <span>近 7 天</span>
          </div>
          <div>
            <strong>{formatTokens(grid.monthTokens) || "0"}</strong>
            <span>近 30 天</span>
          </div>
          <div>
            <strong>{formatTokens(usage.total) || "0"}</strong>
            <span>累计</span>
          </div>
        </div>
        <div className="usage-heat">
          <div className="usage-months">
            {monthLabels.map((item) => (
              <span key={`${item.label}-${item.index}`} style={{ gridColumn: item.index + 1 }}>
                {item.label}
              </span>
            ))}
          </div>
          <div className="usage-body">
            <div className="usage-dows">
              {WEEKDAYS.map((label, index) => (
                <span key={label} className={index % 2 ? "" : "on"}>
                  {index % 2 ? label : ""}
                </span>
              ))}
            </div>
            <div className="usage-weeks">
              {grid.weeks.map((week) => (
                <div className="usage-week" key={week[0]?.day}>
                  {week.map((cell) => (
                    <i
                      key={cell.day}
                      className={`usage-cell lv${levelFor(cell.tokens, grid.max)}`}
                      title={`${cell.day} · ${cell.tokens.toLocaleString()} tok`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="usage-legend">
            <span>少</span>
            <i className="usage-cell lv0" />
            <i className="usage-cell lv1" />
            <i className="usage-cell lv2" />
            <i className="usage-cell lv3" />
            <i className="usage-cell lv4" />
            <span>多</span>
          </div>
        </div>
    </Dialog>
  );
}
