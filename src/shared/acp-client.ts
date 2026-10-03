import WebSocket from "ws";
import type { JsonValue } from "./types";

type JsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: JsonValue;
  result?: JsonValue;
  error?: { code: number; message: string; data?: JsonValue };
};

export const ABSORBED_BY_STREAM = Symbol("absorbed-by-stream");

export type AcpClientHandlers = {
  onNotification?: (method: string, params: JsonValue | undefined) => void;
  onRequest?: (
    id: number | string,
    method: string,
    params: JsonValue | undefined,
  ) => Promise<JsonValue> | JsonValue;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
};

function formatAcpError(err: {
  code: number;
  message: string;
  data?: JsonValue;
}): Error {
  if (err.data == null) return new Error(`ACP ${err.code}: ${err.message}`);
  const extra = typeof err.data === "string" ? err.data : JSON.stringify(err.data);
  if (!extra || extra === err.message) return new Error(`ACP ${err.code}: ${err.message}`);
  return new Error(`ACP ${err.code}: ${err.message} — ${extra}`);
}

function extractSessionId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const v = (params as Record<string, JsonValue>).sessionId;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** JSON-RPC 2.0 over WebSocket text frames, as used by `grok agent serve`. */
export class AcpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number | string,
    {
      method: string;
      sessionId?: string;
      promptId?: string;
      resolve: (value: JsonValue | typeof ABSORBED_BY_STREAM) => void;
      reject: (err: Error) => void;
    }
  >();
  private handlers: AcpClientHandlers;

  constructor(handlers: AcpClientHandlers = {}) {
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url: string): Promise<void> {
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      ws.on("open", () => {
        settled = true;
        resolve();
      });
      ws.on("message", (data) => {
        if (this.ws !== ws) return;
        const text = typeof data === "string" ? data : data.toString("utf8");
        this.handleMessage(text);
      });
      ws.on("error", (err) => {
        if (this.ws !== ws) return;
        const error = err instanceof Error ? err : new Error(String(err));
        this.handlers.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      ws.on("close", (code, reasonBuf) => {
        if (this.ws !== ws) return;
        const reason = reasonBuf?.toString("utf8") ?? "";
        for (const [, p] of this.pending) {
          p.reject(new Error(`WebSocket closed (${code}): ${reason}`));
        }
        this.pending.clear();
        this.handlers.onClose?.(code, reason);
      });
    });
  }

  close(): void {
    if (!this.ws) return;
    for (const pending of this.pending.values()) pending.reject(new Error("ACP client closed"));
    this.pending.clear();
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  async request(
    method: string,
    params?: JsonValue,
    timeoutMs = 120_000,
  ): Promise<JsonValue | typeof ABSORBED_BY_STREAM> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ACP client is not connected");
    }
    const id = this.nextId++;
    const sessionId = extractSessionId(params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        sessionId,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws!.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }),
      );
    });
  }

  respond(id: number | string, result: JsonValue): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  respondError(id: number | string, code: number, message: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    );
  }

  private handleMessage(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || trimmed === "ping") return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      this.handlers.onError?.(new Error(`Invalid JSON from agent: ${trimmed.slice(0, 180)}`));
      return;
    }

    if (msg.id !== undefined && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(formatAcpError(msg.error));
      else pending.resolve(msg.result ?? null);
      return;
    }

    if (msg.method && msg.id !== undefined) {
      const { id, method, params } = msg;
      void (async () => {
        try {
          if (!this.handlers.onRequest) {
            this.respondError(id, -32601, `Unhandled reverse request: ${method}`);
            return;
          }
          const result = await this.handlers.onRequest(id, method, params);
          this.respond(id, result);
        } catch (err) {
          this.respondError(id, -32000, err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }

    if (msg.method) {
      this.trackPromptCompletion(msg);
      this.handlers.onNotification?.(msg.method, msg.params);
    }
  }

  private trackPromptCompletion(msg: JsonRpcMessage): void {
    const params = msg.params && typeof msg.params === "object" && !Array.isArray(msg.params) ? msg.params : undefined;
    if (!params) return;
    const meta = params._meta && typeof params._meta === "object" && !Array.isArray(params._meta) ? params._meta : undefined;
    const update = params.update && typeof params.update === "object" && !Array.isArray(params.update) ? params.update : undefined;
    const sessionId = extractSessionId(msg.params);
    const promptId = meta?.promptId ?? params.promptId ?? update?.prompt_id;
    const terminal = /^(?:_x\.ai|x\.ai)\/session\/prompt_complete$/.test(msg.method ?? "") ||
      (/^(?:session|_x\.ai\/session|x\.ai\/session)\/update$/.test(msg.method ?? "") && update?.sessionUpdate === "turn_completed");
    for (const [id, pending] of this.pending) {
      if (pending.method !== "session/prompt" || pending.sessionId !== sessionId) continue;
      if (!terminal && typeof promptId === "string" && !pending.promptId) pending.promptId = promptId;
      if (!terminal || typeof promptId !== "string" || pending.promptId !== promptId) continue;
      this.pending.delete(id);
      const reason = params.stopReason ?? update?.stop_reason;
      if (reason === "error") {
        const message = params.agentResult ?? update?.agent_result;
        pending.reject(new Error(typeof message === "string" ? message : "Grok prompt failed"));
      } else {
        pending.resolve({ stopReason: typeof reason === "string" ? reason : "end_turn" });
      }
    }
  }
}
