import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AccountInfo, QuotaInfo } from "../shared/types";
import { containsGrokCredentials } from "./credential-presence";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findEmail(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  if (typeof value === "string" && value.includes("@") && value.length < 200) return value;
  const rec = asRecord(value);
  if (!rec) return undefined;
  for (const key of ["email", "user_email", "accountEmail"]) {
    const hit = asString(rec[key]);
    if (hit?.includes("@")) return hit;
  }
  for (const nested of Object.values(rec)) {
    const hit = findEmail(nested, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function findToken(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  const rec = asRecord(value);
  if (!rec) return undefined;
  for (const key of ["access_token", "accessToken", "token"]) {
    const hit = asString(rec[key]);
    if (hit && hit.length > 20) return hit;
  }
  for (const nested of Object.values(rec)) {
    const hit = findToken(nested, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function findUserId(value: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  const rec = asRecord(value);
  if (!rec) return undefined;
  for (const key of ["user_id", "userId", "userid", "uid", "sub"]) {
    const hit = asString(rec[key]);
    if (hit && hit.length < 128) return hit;
  }
  for (const nested of Object.values(rec)) {
    const hit = findUserId(nested, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

async function readAuthFile(): Promise<unknown> {
  const home = process.env.GROK_HOME?.trim() || join(homedir(), ".grok");
  const raw = await readFile(join(home, "auth.json"), "utf8");
  return JSON.parse(raw);
}

export async function hasGrokCredentials(): Promise<boolean> {
  if (process.env.XAI_API_KEY?.trim()) return true;
  try {
    return containsGrokCredentials(await readAuthFile());
  } catch {
    return false;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function productUsagePercent(config: Record<string, unknown>): number | undefined {
  const raw = config.productUsage ?? config.product_usage;
  if (!Array.isArray(raw)) return undefined;
  let fallback: number | undefined;
  for (const row of raw) {
    const item = asRecord(row);
    if (!item) continue;
    const pct = asNumber(item.usagePercent) ?? asNumber(item.usage_percent);
    if (pct == null) continue;
    const product = (asString(item.product) ?? "").toUpperCase();
    if (product.includes("GROK_BUILD") || product.includes("BUILD")) return pct;
    fallback ??= pct;
  }
  return fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asCents(value: unknown): number | undefined {
  const direct = asNumber(value);
  if (direct != null) return direct;
  const rec = asRecord(value);
  if (!rec) return undefined;
  return asNumber(rec.val) ?? asNumber(rec.cents) ?? asNumber(rec.amount);
}

function periodLabel(value: unknown): string | undefined {
  const text = asString(value)?.toUpperCase() ?? "";
  if (!text) return undefined;
  if (text.includes("WEEK")) return "本周";
  if (text.includes("MONTH")) return "本月";
  if (text.includes("DAY")) return "今日";
  return undefined;
}

function formatCredits(cents: number | undefined): string | undefined {
  if (cents == null || cents <= 0) return undefined;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse the `/usage` payload (`x.ai/billing` / GET /billing?format=credits). */
export function parseUsagePayload(payload: unknown): QuotaInfo | undefined {
  const rec = asRecord(typeof payload === "string" ? safeJson(payload) : payload);
  if (!rec) return undefined;
  const root = asRecord(rec.data) ?? asRecord(rec.result) ?? rec;
  const config = asRecord(root.config) ?? root;
  const period = asRecord(config.currentPeriod) ?? asRecord(config.current_period);
  const productPercent = productUsagePercent(config) ?? productUsagePercent(root);
  const percent =
    productPercent ??
    asNumber(config.creditUsagePercent) ??
    asNumber(config.credit_usage_percent) ??
    asNumber(config.usedPercent) ??
    asNumber(config.used_percent) ??
    asNumber(config.percent_used);
  const usedCents = asCents(config.used);
  const limitCents = asCents(config.monthlyLimit) ?? asCents(config.monthly_limit);
  const usedPercent =
    percent ??
    (usedCents != null && limitCents && limitCents > 0 ? (usedCents / limitCents) * 100 : undefined);
  const remainingPercent =
    asNumber(config.remainingPercent) ??
    asNumber(config.remaining_percent) ??
    (usedPercent != null ? Math.max(0, 100 - usedPercent) : undefined);
  const resetAt =
    asString(period?.end) ??
    asString(config.billingPeriodEnd) ??
    asString(config.billing_period_end) ??
    asString(config.resetAt) ??
    asString(config.reset_at);
  const extra =
    formatCredits(asCents(config.prepaidBalance) ?? asCents(config.prepaid_balance)) ??
    asString(config.extraCredits) ??
    asString(config.extra_credits);
  const plan =
    asString(root.subscriptionTier) ??
    asString(root.subscription_tier) ??
    asString(config.plan) ??
    asString(config.tier);
  if (usedPercent == null && remainingPercent == null && !plan && !extra && !resetAt) return undefined;
  return {
    usedPercent,
    remainingPercent,
    plan,
    resetAt,
    extraCredits: extra,
    period: periodLabel(period?.type ?? period?.period_type ?? period?.periodType),
    syncedAt: Date.now(),
  };
}

export async function loadAccountSeed(): Promise<Partial<AccountInfo>> {
  try {
    const auth = await readAuthFile();
    return { email: findEmail(auth) };
  } catch {
    return {};
  }
}

export async function fetchQuota(): Promise<QuotaInfo | undefined> {
  try {
    const auth = await readAuthFile();
    const token = findToken(auth);
    if (!token) return undefined;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-XAI-Token-Auth": "xai-grok-cli",
    };
    const userId = findUserId(auth);
    if (userId) headers["x-userid"] = userId;
    const res = await fetch("https://cli-chat-proxy.grok.com/v1/billing?format=credits", { headers });
    if (!res.ok) return undefined;
    return parseUsagePayload(await res.json());
  } catch {
    return undefined;
  }
}
