import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = await mkdtemp(join(tmpdir(), 'grok-management-test-'));
const bundle = resolve(`release/qa/management-test-${process.pid}.mjs`);
await mkdir(resolve('release/qa'), { recursive: true });
await build({
  stdin: { contents: 'export { AgentHost } from "./src/main/agent-host"; export * from "./src/main/session-management"; export * from "./src/shared/session-organization";', resolveDir: process.cwd(), loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'headless-electron', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const app = { getVersion: () => 'test', getPath: () => process.env.GROK_HOME };
      export const BrowserWindow = { getAllWindows: () => [] };
      export class Notification { show() {} }
      export const clipboard = {}; export const nativeImage = {};
    ` }));
  } }],
});
const { AgentHost, retireLocalSessions, collectSessionTree, customGroupKey, normalizeOrganization, removeCustomGroup } = await import(pathToFileURL(bundle).href);
after(async () => { await rm(bundle, { force: true }); await rm(root, { recursive: true, force: true }); });
const one = '11111111-1111-4111-8111-111111111111';
const two = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';
const nested = '44444444-4444-4444-8444-444444444444';
const cwd = 'C:\\fixture\\project';
let serial = 0;
async function fixture() {
  const home = join(root, String(++serial));
  process.env.GROK_HOME = home;
  const dir = id => join(home, 'sessions', encodeURIComponent(cwd), id);
  for (const [id, kind] of [[one, 'headless'], [two, 'headless'], [child, 'subagent'], [nested, 'subagent']]) {
    await mkdir(dir(id), { recursive: true });
    await writeFile(join(dir(id), 'summary.json'), JSON.stringify({ info: { id, cwd }, generated_title: `Title ${id}`, session_kind: kind }));
    await writeFile(join(dir(id), 'updates.jsonl'), `content-${id}\n`);
  }
  for (const [parent, kid] of [[one, child], [child, nested]]) {
    const path = join(dir(parent), 'subagents', kid);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'meta.json'), JSON.stringify({ parent_session_id: parent, child_session_id: kid, child_cwd: cwd, status: 'completed' }));
  }
  await writeFile(join(home, 'active_sessions.json'), '[]');
  const host = new AgentHost();
  await host.db.init();
  await host.loadLocalSessions();
  return { home, host, dir };
}

test('custom groups persist in SQLite and group removal keeps conversation directories and workspace', async () => {
  const { host, dir } = await fixture();
  host.saveSessionGroup(undefined, '  研究  计划 ');
  const id = host.getSnapshot().sessionOrganization.groups[0].id;
  assert.equal(host.getSnapshot().sessionOrganization.groups[0].name, '研究 计划');
  assert.throws(() => host.saveSessionGroup(undefined, '研究 计划'), /同名/);
  await host.manageSessions([one, two], 'move', id);
  host.reorderSessions(customGroupKey(id), [two, one]);
  const reopened = new AgentHost(); await reopened.db.init();
  const persisted = reopened.db.getJson('sessionOrganization', {});
  assert.equal(persisted.assignments[one], id);
  assert.equal(persisted.assignments[two], id);
  assert.deepEqual(reopened.db.getJson('sessionOrder', {})[customGroupKey(id)], [two, one]);
  host.saveSessionGroup(id, '资料');
  assert.equal(host.getSnapshot().sessionOrganization.groups[0].name, '资料');
  host.removeSessionGroup(id);
  assert.deepEqual(host.getSnapshot().sessionOrganization, { groups: [], assignments: {} });
  assert.equal(JSON.parse(await readFile(join(dir(one), 'summary.json'))).info.cwd, cwd);
  assert.equal(host.getSnapshot().sessions.length, 4);
});

test('batch pin/archive use only selected main sessions and can be reversed', async () => {
  const { host } = await fixture();
  let result = await host.manageSessions([one, one, child, 'missing'], 'pin');
  assert.deepEqual(result.processedIds, [one]);
  assert.deepEqual(result.skippedIds, [child, 'missing']);
  assert.equal(result.snapshot.sessions.find(row => row.sessionId === two).pinned, false);
  await host.manageSessions([one, two], 'archive');
  assert.equal(host.getSnapshot().sessions.filter(row => row.archived).length, 2);
  await host.manageSessions([one], 'unpin');
  await host.manageSessions([one, two], 'unarchive');
  assert.equal(host.getSnapshot().sessions.filter(row => row.pinned || row.archived).length, 0);
  await assert.rejects(host.manageSessions([one], 'move', 'missing'), /目标分组/);
  await assert.rejects(host.manageSessions([one], 'invalid'), /未知会话操作/);
});

test('local batch deletion backs up parent and nested children byte-for-byte without ACP/network requests', async () => {
  const { host, dir } = await fixture();
  host.saveSessionGroup(undefined, '待处理');
  const id = host.getSnapshot().sessionOrganization.groups[0].id;
  await host.manageSessions([one], 'move', id);
  host.client = { connected: true, request: async () => { throw new Error('No request expected'); } };
  const before = await readFile(join(dir(one), 'summary.json'));
  const result = await host.manageSessions([one], 'delete');
  assert.deepEqual(result.processedIds, [one]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.snapshot.sessions.map(row => row.sessionId), [two]);
  assert.deepEqual(result.snapshot.sessionOrganization.assignments, {});
  const manifest = JSON.parse(await readFile(join(result.backupPath, 'manifest.json')));
  assert.deepEqual(manifest.sessions.map(row => row.id).sort(), [one, child, nested].sort());
  const moved = manifest.sessions.find(row => row.id === one);
  assert.deepEqual(await readFile(join(moved.destination, 'summary.json')), before);
  assert.equal(await readFile(join(manifest.sessions.find(row => row.id === child).destination, 'updates.jsonl'), 'utf8'), `content-${child}\n`);
  assert.equal(manifest.sessions.every(row => row.moved), true);
  assert.equal(JSON.parse(await readFile(join(dir(two), 'summary.json'))).info.id, two);
});

test('running parent is skipped while an idle selection still deletes and the active turn stays intact', async () => {
  const { host, dir } = await fixture();
  host.snapshot = { ...host.getSnapshot(), sessionId: one, busy: true, timeline: [{ id: 'live', kind: 'assistant', text: 'LIVE', streaming: true }] };
  host.client = { connected: true, request: async () => { throw new Error('Cannot cancel/load live session'); } };
  const result = await host.manageSessions([one, two], 'delete');
  assert.deepEqual(result.processedIds, [two]);
  assert.deepEqual(result.skippedIds, [one]);
  assert.match(result.errors[0], /正在运行/);
  assert.equal(host.getSnapshot().busy, true);
  assert.equal(host.getSnapshot().timeline[0].text, 'LIVE');
  assert.equal(JSON.parse(await readFile(join(dir(one), 'summary.json'))).info.id, one);
});

test('official registry protects an active child before any parent data is moved', async () => {
  const { home, host, dir } = await fixture();
  await writeFile(join(home, 'active_sessions.json'), JSON.stringify([{ session_id: child, pid: process.pid }]));
  const result = await host.manageSessions([one, two], 'delete');
  assert.deepEqual(result.processedIds, [two]);
  assert.deepEqual(result.skippedIds, [one]);
  assert.match(result.errors[0], /正在运行/);
  for (const id of [one, child, nested]) assert.equal(JSON.parse(await readFile(join(dir(id), 'summary.json'))).info.id, id);
  await writeFile(join(home, 'active_sessions.json'), '{broken');
  await assert.rejects(host.manageSessions([one], 'delete'), /无法核对/);
});

test('an idle current conversation closes before moving and is cleared afterwards', async () => {
  const { host, dir } = await fixture();
  host.snapshot = { ...host.getSnapshot(), sessionId: two, timeline: [{ id: 'old', kind: 'assistant', text: 'history' }] };
  const requests = [];
  host.client = { connected: true, request: async (method) => { requests.push(method); assert.equal(JSON.parse(await readFile(join(dir(two), 'summary.json'))).info.id, two); return {}; } };
  await host.manageSessions([two], 'delete');
  assert.deepEqual(requests, ['session/close']);
  assert.equal(host.getSnapshot().sessionId, undefined);
  assert.deepEqual(host.getSnapshot().timeline, []);
});

test('legacy single/workspace/archived deletion shares local backup semantics; empty archive selection removes nothing', async () => {
  const { host, home } = await fixture();
  await host.manageSessions([one, two], 'archive');
  await host.deleteArchivedSessions([]);
  assert.equal(host.getSnapshot().sessions.length, 4);
  await host.deleteSession(two);
  assert.equal(host.getSnapshot().sessions.some(row => row.sessionId === two), false);
  await host.deleteWorkspace(cwd);
  assert.deepEqual(host.getSnapshot().sessions, []);
  assert.equal((await readdir(join(home, 'session-cleanup-backups'))).length, 2);
});

test('invalid IDs and symlinked session directories cannot move data outside the sessions root', async () => {
  const { home, dir } = await fixture();
  assert.equal((await retireLocalSessions([{ sessionId: '../outside', cwd }])).movedIds.length, 0);
  const outside = join(root, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'keep.txt'), 'KEEP');
  const linkId = '55555555-5555-4555-8555-555555555555';
  await symlink(outside, dir(linkId), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(retireLocalSessions([{ sessionId: linkId, cwd }]), /有效存储目录/);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'KEEP');
  assert.equal((await readdir(join(home, 'sessions'))).length, 1);
});

test('ownership closure and normalization drop dangling memberships without treating forks as children', () => {
  assert.deepEqual(collectSessionTree([{ sessionId: one }, { sessionId: child, parentSessionId: one }, { sessionId: nested, parentSessionId: child }, { sessionId: two }], [one]).map(row => row.sessionId), [one, child, nested]);
  const org = normalizeOrganization({ groups: [{ id: one, name: 'Group' }, { id: one, name: 'Duplicate' }], assignments: { [two]: one, [child]: 'missing', bad: one } });
  assert.equal(org.groups.length, 1);
  assert.deepEqual(org.assignments, { [two]: one });
  assert.deepEqual(removeCustomGroup(org, one), { groups: [], assignments: {} });
});
