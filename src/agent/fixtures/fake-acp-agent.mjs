import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

const SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';
const stream = acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
);

const app = acp.agent({ name: 'NexusFlow ACP test harness' })
  .onRequest(acp.methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: SESSION_ID }))
  .onRequest(acp.methods.agent.session.load, () => ({}))
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'real ACP response' },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .onNotification(acp.methods.agent.session.cancel, () => {});

const connection = app.connect(stream);
await connection.closed;
