import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TimelineItem, ToolDiff } from "../shared/types";
import { normalizeUserText } from "../shared/message-text";
import { readEventStats, touchStats, type StatsCursor } from "../shared/step-stats";
import { resolveSessionDir } from "./session-store";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  const rec = asRecord(content);
  if (!rec) return "";
  if (typeof rec.text === "string") return rec.text;
  if (Array.isArray(rec.content)) return rec.content.map(collectText).filter(Boolean).join("");
  return "";
}

function collectDiffs(content: unknown): ToolDiff[] {
  if (!Array.isArray(content)) return [];
  const diffs: ToolDiff[] = [];
  for (const entry of content) {
    const rec = asRecord(entry);
    if (!rec || asString(rec.type) !== "diff") continue;
    diffs.push({
      path: asString(rec.path) ?? "file",
      oldText: asString(rec.oldText),
      newText: asString(rec.newText),
    });
  }
  return diffs;
}

function collectOutput(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const entry of content) {
    const rec = asRecord(entry);
    if (!rec) continue;
    if (asString(rec.type) === "content" || asString(rec.type) === "text") {
      const text = collectText(rec.content ?? rec);
      if (text) parts.push(text);
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

function unixMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

function appendText(
  items: TimelineItem[],
  kind: "user" | "thought" | "assistant",
  text: string,
  at: number | undefined,
  totalTokens: number | undefined,
  cursor: StatsCursor,
): void {
  if (!text) return;
  const last = items[items.length - 1];
  if (last && last.kind === kind && "text" in last) {
    last.text += text;
    if (kind !== "user") touchStats(last, at, totalTokens, cursor);
    return;
  }
  const item: TimelineItem = { id: randomUUID(), kind, text, at };
  if (kind !== "user") touchStats(item, at, totalTokens, cursor);
  items.push(item);
}

function applyUpdate(
  items: TimelineItem[],
  update: Record<string, unknown>,
  at: number | undefined,
  totalTokens: number | undefined,
  cursor: StatsCursor,
): void {
  const kind = asString(update.sessionUpdate);
  if (kind === "user_message_chunk") {
    const text = normalizeUserText(collectText(update.content ?? update));
    if (text) appendText(items, "user", text, at, totalTokens, cursor);
    return;
  }
  if (kind === "agent_thought_chunk" || kind === "agent_thought") {
    appendText(items, "thought", collectText(update.content ?? update), at, totalTokens, cursor);
    return;
  }
  if (kind === "agent_message_chunk" || kind === "agent_message") {
    appendText(items, "assistant", collectText(update.content ?? update), at, totalTokens, cursor);
    return;
  }
  if (kind === "tool_call") {
    const toolCallId = asString(update.toolCallId) ?? randomUUID();
    const existing = items.find(
      (item): item is Extract<TimelineItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolCallId === toolCallId,
    );
    const diffs = collectDiffs(update.content);
    const outputText = collectOutput(update.content);
    if (existing) {
      existing.title = asString(update.title) ?? existing.title;
      existing.status = asString(update.status) ?? existing.status;
      existing.toolKind = asString(update.kind) ?? existing.toolKind;
      existing.rawInput = update.rawInput ?? existing.rawInput;
      if (diffs.length) existing.diffs = diffs;
      if (outputText) existing.outputText = outputText;
      touchStats(existing, at, totalTokens, cursor);
    } else {
      const item: Extract<TimelineItem, { kind: "tool" }> = {
        id: randomUUID(),
        kind: "tool",
        toolCallId,
        title: asString(update.title) ?? asString(update.toolName) ?? "tool",
        status: asString(update.status) ?? "pending",
        toolKind: asString(update.kind) ?? asString(update.toolName),
        rawInput: update.rawInput,
        diffs,
        outputText,
        at,
      };
      touchStats(item, at, totalTokens, cursor);
      items.push(item);
    }
    return;
  }
  if (kind === "tool_call_update") {
    const toolCallId = asString(update.toolCallId);
    if (!toolCallId) return;
    const existing = items.find(
      (item): item is Extract<TimelineItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolCallId === toolCallId,
    );
    if (!existing) return;
    existing.status = asString(update.status) ?? existing.status;
    existing.title = asString(update.title) ?? existing.title;
    const diffs = collectDiffs(update.content);
    const outputText = collectOutput(update.content);
    if (diffs.length) existing.diffs = diffs;
    if (outputText) existing.outputText = outputText;
    if (update.rawInput != null) existing.rawInput = update.rawInput;
    touchStats(existing, at, totalTokens, cursor);
  }
}

/** Rebuild a conversation timeline from grok's on-disk ACP update stream. */
export async function loadSessionTranscript(
  sessionId: string,
  cwd?: string,
  eventIds?: Set<string>,
): Promise<TimelineItem[]> {
  const dir = await resolveSessionDir(sessionId, cwd);
  if (!dir) return [];
  const items: TimelineItem[] = [];
  const cursor: StatsCursor = {};
  const input = createReadStream(join(dir, "updates.jsonl"), { encoding: "utf8" });
  const rl = createInterface({
    input,
    crlfDelay: Infinity,
  });
  // A newly spawned child may have a summary before its first update file exists.
  input.on("error", () => rl.close());
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      const rec = asRecord(row);
      if (!rec) continue;
      const params = asRecord(rec.params) ?? rec;
      const eventId = asString(asRecord(params._meta)?.eventId);
      if (eventId) eventIds?.add(eventId);
      const update = asRecord(params.update) ?? params;
      if (!asString(update.sessionUpdate)) continue;
      const stats = readEventStats(update, asRecord(params._meta) ?? asRecord(rec._meta), unixMs(rec.timestamp));
      applyUpdate(items, update, stats.at, stats.totalTokens, cursor);
    }
  } catch {
    /* Keep the readable prefix of a log currently being written. */
  } finally {
    input.destroy();
  }
  // Polling read-only child views must retain fold state and scroll anchors.
  items.forEach((item, index) => { item.id = `${sessionId}:${item.kind === "tool" ? item.toolCallId : index}`; });
  return items;
}
