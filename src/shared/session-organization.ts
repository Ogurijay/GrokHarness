import type { SessionOrganization, SessionSummary } from "./types";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function customGroupKey(id: string): string { return `__custom__:${id}`; }
export function cleanGroupName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
export function normalizeOrganization(value: unknown): SessionOrganization {
  const raw = value && typeof value === "object" ? value as Partial<SessionOrganization> : {};
  const ids = new Set<string>();
  const groups = (Array.isArray(raw.groups) ? raw.groups : []).flatMap((group) => {
    if (!group || typeof group.id !== "string" || !UUID.test(group.id) || typeof group.name !== "string" || ids.has(group.id)) return [];
    const name = cleanGroupName(group.name);
    if (!name) return [];
    ids.add(group.id);
    return [{ id: group.id, name }];
  });
  const assignments: Record<string, string> = {};
  if (raw.assignments && typeof raw.assignments === "object") {
    for (const [session, group] of Object.entries(raw.assignments)) {
      if (UUID.test(session) && typeof group === "string" && ids.has(group)) assignments[session] = group;
    }
  }
  return { groups, assignments };
}
export function sessionCustomGroup(session: SessionSummary, organization?: SessionOrganization): string | undefined {
  const id = organization?.assignments[session.sessionId];
  return id && organization?.groups.some((group) => group.id === id) ? id : undefined;
}
/** Deleting a group returns its conversations to their original workspace. */
export function removeCustomGroup(organization: SessionOrganization, id: string): SessionOrganization {
  return {
    groups: organization.groups.filter((group) => group.id !== id),
    assignments: Object.fromEntries(Object.entries(organization.assignments).filter(([, group]) => group !== id)),
  };
}
