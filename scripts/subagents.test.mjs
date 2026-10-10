import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const profile = await mkdtemp(join(tmpdir(), 'grok-subagent-test-'));
process.env.GROK_HOME = profile;
const bundle = resolve(`release/qa/subagent-test-${process.pid}.mjs`);
await mkdir(resolve('release/qa'), { recursive: true });
await build({ stdin: { contents: 'export * from "./src/main/subagents"; export * from "./src/main/session-store"; export * from "./src/main/session-transcript"; export { isMainSession } from "./src/shared/types";', resolveDir: process.cwd(), loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { listLocalSessions, listSessionSubagents, readSubagentView, resolveSessionDir, isMainSession } = await import(pathToFileURL(bundle).href);
after(async () => { await rm(bundle, { force: true }); await rm(profile, { recursive: true, force: true }); });
const parent = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';
const nested = '33333333-3333-4333-8333-333333333333';
const fork = '44444444-4444-4444-8444-444444444444';
const orphan = '55555555-5555-4555-8555-555555555555';
const cwd = 'C:\\fixture\\parent';
const childCwd = 'C:\\fixture\\worktree';
const dir = (id, workspace = cwd) => join(profile, 'sessions', encodeURIComponent(workspace), id);
async function session(id, kind, workspace = cwd, extra = {}) {
  await mkdir(dir(id, workspace), { recursive: true });
  await writeFile(join(dir(id, workspace), 'summary.json'), JSON.stringify({ info: { id, cwd: workspace }, generated_title: id, session_kind: kind, ...extra }));
}
async function meta(owner, id, workspace = cwd, extra = {}) {
  const root = join(dir(owner, workspace), 'subagents', id);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'meta.json'), JSON.stringify({ parent_session_id: owner, child_session_id: id, subagent_type: 'explore', description: 'Inspect project', status: 'running', child_cwd: childCwd, ...extra }));
}
await session(parent, 'headless');
await session(child, undefined, childCwd); // Older child summaries lack session_kind.
await session(nested, 'subagent', childCwd);
await session(fork, 'headless', cwd, { parent_session_id: parent });
await session(orphan, 'subagent');
await meta(parent, child);
await meta(child, nested, childCwd);
const row = (kind, text) => ({ params: { update: { sessionUpdate: kind, content: { type: 'text', text } } } });
const log = join(dir(child, childCwd), 'updates.jsonl');
await writeFile(log, JSON.stringify(row('agent_thought_chunk', 'Inspecting')) + '\n');

test('only owned children and official subagent sessions leave the main list; forks remain', async () => {
  const rows = await listLocalSessions();
  assert.deepEqual(rows.filter(isMainSession).map(x => x.sessionId).sort(), [parent, fork].sort());
  assert.equal(rows.find(x => x.sessionId === child).parentSessionId, parent);
  assert.equal(rows.find(x => x.sessionId === nested).parentSessionId, child);
});
test('child details read a worktree transcript and expose nested children without ACP', async () => {
  const view = await readSubagentView(parent, child);
  assert.equal(view.timeline[0].text, 'Inspecting');
  assert.equal(view.timeline[0].streaming, true);
  assert.equal(view.subagents[0].sessionId, nested);
  assert.equal(view.agent.status, 'running');
});
test('a newly created child with no update file returns an empty view', async () => {
  const view = await readSubagentView(child, nested);
  assert.deepEqual(view.timeline, []);
});
test('fresh metadata and transcript polling retain IDs and append content', async () => {
  const before = await readSubagentView(parent, child);
  await meta(parent, child, cwd, { status: 'completed', tool_calls: 3 });
  await writeFile(log, [row('agent_thought_chunk', 'Inspecting'), row('agent_thought_chunk', ' more'), row('agent_message_chunk', 'Done')].map(JSON.stringify).join('\n') + '\n');
  const afterView = await readSubagentView(parent, child);
  assert.equal(afterView.agent.status, 'completed');
  assert.equal(afterView.agent.toolCalls, 3);
  assert.equal(afterView.timeline[0].id, before.timeline[0].id);
  assert.equal(afterView.timeline[0].text, 'Inspecting more');
});
test('unowned child IDs and path traversal cannot open an arbitrary transcript', async () => {
  await assert.rejects(readSubagentView(fork, child), /找不到/);
  assert.equal(await resolveSessionDir('../outside', cwd), undefined);
  assert.deepEqual(await listSessionSubagents('../outside'), []);
});
test('malformed and mismatched parent metadata are ignored without hiding valid sessions', async () => {
  const invalid = join(dir(parent), 'subagents', fork);
  await mkdir(invalid, { recursive: true });
  await writeFile(join(invalid, 'meta.json'), '{');
  await meta(parent, orphan, cwd, { parent_session_id: fork });
  const rows = await listSessionSubagents(parent);
  assert.deepEqual(rows.map(x => x.sessionId), [child]);
});
