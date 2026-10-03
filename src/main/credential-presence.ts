export function containsGrokCredentials(value: unknown, depth = 0): boolean {
  if (depth > 5 || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const hasToken = (key: string) => typeof record[key] === "string" && (record[key] as string).trim().length > 20;
  if (["access_token", "accessToken", "token"].some(hasToken)) return true;
  // Official Grok Build OAuth entries store the credential as key plus auth_mode.
  if (typeof record.auth_mode === "string" && hasToken("key")) return true;
  return Object.values(record).some((nested) => containsGrokCredentials(nested, depth + 1));
}
