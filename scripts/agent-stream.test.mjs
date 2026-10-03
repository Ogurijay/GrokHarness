import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const profile = await mkdtemp(join(tmpdir(), 'grok-stream-test-'));
process.env.GROK_HOME = profile;
const bundle = resolve(`release/qa/agent-stream-test-${process.pid}.mjs`);
await mkdir(resolve('release/qa'), { recursive: true });
await build({
  entryPoints: ['src/main/agent-host.ts'], outfile: bundle,
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{ name: 'headless-electron', setup(builder) {
    builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const app = { getVersion: () => 'test', getPath: () => ${JSON.stringify(profile)} };
      export const BrowserWindow = { getAllWindows: () => [] };
      export class Notification { show() {} }
      export const clipboard = {}; export const nativeImage = {};
    ` }));
  } }],
});
const { AgentHost } = await import(pathToFileURL(bundle).href);
after(async () => { await rm(bundle, { force: true }); await rm(profile, { recursive: true, force: true }); });

function makeHost(sessionId = 'active-session') {
  const host = new AgentHost();
  host.db = new Proxy({}, { get: (_target, key) => key === 'tokenSummary' ? () => ({ days: [], today: 0, total: 0 }) : () => {} });
  host.loadLocalSessions = async () => {};
  host.snapshot = { ...host.getSnapshot(), connection: 'ready', sessionId, workspace: profile };
  host.client = { connected: true, request: async () => ({}) };
  return host;
}
function emit(host, kind, extra = {}, sessionId = host.getSnapshot().sessionId, eventId) {
  host.onNotification('session/update', { sessionId, update: { sessionUpdate: kind, ...extra }, _meta: eventId ? { eventId } : {} });
}

test('selecting the active conversation keeps the turn and subsequent tool output alive', async () => {
  const host = makeHost();
  let finish;
  const calls = [];
  host.client.request = async method => { calls.push(method); if (method === 'session/prompt') return new Promise(r => { finish = r; }); return {}; };
  const sending = host.sendPrompt('stream test');
  await new Promise(r => setImmediate(r));
  emit(host, 'agent_message_chunk', { content: { type: 'text', text: 'Preparing' } });
  await host.openSession('active-session');
  assert.equal(host.getSnapshot().busy, true);
  assert.deepEqual(calls, ['session/prompt']);
  emit(host, 'tool_call', { toolCallId: 'image-test', title: 'image_gen' });
  emit(host, 'tool_call_update', { toolCallId: 'image-test', status: 'completed', content: [{ type: 'text', text: 'IMAGE_OK' }] });
  emit(host, 'agent_message_chunk', { content: { type: 'text', text: 'Final result' } });
  finish({ stopReason: 'end_turn' });
  await sending;
  assert.equal(host.getSnapshot().busy, false);
  assert.match(host.getSnapshot().timeline.find(x => x.toolCallId === 'image-test').outputText, /IMAGE_OK/);
  assert.equal(host.getSnapshot().timeline.at(-1).text, 'Final result');
  assert.equal(host.getSnapshot().timeline.some(x => x.kind === 'interrupt'), false);
});

test('loading history merges durable and in-flight events exactly once', async () => {
  const sid = '11111111-1111-4111-8111-111111111111';
  const dir = join(profile, 'sessions', encodeURIComponent(profile), sid);
  await mkdir(dir, { recursive: true });
  const row = (id, text) => ({ method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }, _meta: { eventId: id } } });
  const first = row('history-1', 'FIRST');
  const second = row('history-2', ' SECOND');
  const file = join(dir, 'updates.jsonl');
  await writeFile(file, JSON.stringify(first) + '\n');
  const host = makeHost('previous-session');
  host.ignoreUpdates = true;
  host.client.request = async method => {
    assert.equal(method, 'session/load');
    host.onNotification(second.method, second.params);
    await writeFile(file, [first, second].map(JSON.stringify).join('\n') + '\n');
    emit(host, 'agent_message_chunk', { content: { type: 'text', text: ' LIVE' } }, sid, 'live-3');
    return { sessionId: sid };
  };
  await host.openSession(sid, profile);
  assert.equal(host.getSnapshot().timeline.filter(x => x.kind === 'assistant').map(x => x.text).join(''), 'FIRST SECOND LIVE');
  assert.equal(host.getSnapshot().busy, true);
  host.onNotification('_x.ai/session/prompt_complete', { sessionId: sid, stopReason: 'end_turn' });
  assert.equal(host.getSnapshot().busy, false);
});

test('another conversation cannot append output or finish the active turn', () => {
  const host = makeHost();
  host.snapshot.busy = true;
  emit(host, 'agent_message_chunk', { content: { type: 'text', text: 'WRONG_SESSION' } }, 'other-session');
  emit(host, 'turn_completed', {}, 'other-session');
  assert.equal(host.getSnapshot().timeline.length, 0);
  assert.equal(host.getSnapshot().busy, true);
});

test('completion signals finish resumed streaming while intermediate response signals do not', () => {
  const host = makeHost();
  emit(host, 'agent_message_chunk', { content: { type: 'text', text: 'Waiting for tool' } });
  host.onNotification('_x.ai/session_notification', { sessionId: 'active-session', update: { sessionUpdate: 'response_completed' } });
  assert.equal(host.getSnapshot().busy, true);
  emit(host, 'turn_completed', { stop_reason: 'end_turn' });
  assert.equal(host.getSnapshot().busy, false);
  assert.equal(host.getSnapshot().timeline[0].streaming, false);
});

test('assistant messages separated by tools keep their chronological positions', () => {
  const host = makeHost();
  emit(host, 'agent_message_chunk', { content: { type: 'text', text: 'Before tool' } });
  emit(host, 'tool_call', { toolCallId: 'read', title: 'read_file' });
  emit(host, 'agent_message_chunk', { content: { type: 'text', text: 'After tool' } });
  assert.deepEqual(host.getSnapshot().timeline.map(x => x.kind), ['assistant', 'tool', 'assistant']);
  assert.equal(host.getSnapshot().timeline[0].text, 'Before tool');
  assert.equal(host.getSnapshot().timeline[0].streaming, false);
});
