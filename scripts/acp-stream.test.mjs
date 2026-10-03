import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { AcpClient } from '../src/shared/acp-client.ts';

async function withServer(run) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(r => server.once('listening', r));
  const connected = new Promise(r => server.once('connection', r));
  const client = new AcpClient();
  await client.connect(`ws://127.0.0.1:${server.address().port}`);
  const socket = await connected;
  try { await run(client, socket); }
  finally { client.close(); for (const peer of server.clients) peer.terminate(); await new Promise(r => server.close(r)); }
}
const update = (socket, sessionId, kind, promptId) => socket.send(JSON.stringify({ method: 'session/update', params: { sessionId, update: { sessionUpdate: kind }, _meta: { promptId } } }));

test('a partial stream followed by timeout is an error, including after an earlier completed turn', async () => {
  await withServer(async (client, socket) => {
    socket.once('message', data => { const req=JSON.parse(String(data)); update(socket, 's', 'agent_message_chunk', 'old'); socket.send(JSON.stringify({id:req.id,result:{stopReason:'end_turn'}})); });
    await client.request('session/prompt', {sessionId:'s'}, 500);
    socket.once('message', () => update(socket, 's', 'agent_message_chunk', 'new'));
    await assert.rejects(client.request('session/prompt', {sessionId:'s'}, 40), /timed out/);
  });
});

test('matching terminal settles a dropped RPC response; other prompts and intermediate responses do not', async () => {
  await withServer(async (client, socket) => {
    socket.once('message', () => {
      update(socket, 's', 'agent_message_chunk', 'current');
      socket.send(JSON.stringify({method:'_x.ai/session/prompt_complete',params:{sessionId:'other',promptId:'current',stopReason:'end_turn'}}));
      socket.send(JSON.stringify({method:'_x.ai/session/prompt_complete',params:{sessionId:'s',promptId:'old',stopReason:'end_turn'}}));
      update(socket, 's', 'response_completed', 'current');
    });
    let settled = false;
    const request = client.request('session/prompt', {sessionId:'s'}, 500).then(value => {settled=true; return value});
    await new Promise(r => setTimeout(r, 20));
    assert.equal(settled, false);
    socket.send(JSON.stringify({method:'_x.ai/session/prompt_complete',params:{sessionId:'s',promptId:'current',stopReason:'end_turn'}}));
    assert.deepEqual(await request, {stopReason:'end_turn'});
  });
});

test('connection loss rejects an in-flight prompt rather than declaring success', async () => {
  await withServer(async (client, socket) => {
    socket.once('message', () => {update(socket,'s','agent_message_chunk','p');socket.close(1011,'test failure')});
    await assert.rejects(client.request('session/prompt',{sessionId:'s'},500), /WebSocket closed/);
  });
});
