// 095: protocol fixture, no network or model calls.
import { createInterface } from 'node:readline';
const send = (x) => process.stdout.write(JSON.stringify(x) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const r = JSON.parse(line);
  if (r.method === 'initialize') send({ id: r.id, result: {} });
  else if (r.method === 'account/read')
    send({
      id: r.id,
      result: { account: { type: process.env.SF_TEST_CODEX_AUTH ?? 'chatgpt', planType: 'plus' } },
    });
  else if (r.method === 'model/list')
    send({
      id: r.id,
      result: {
        data: [
          { model: 'test-model', isDefault: true, hidden: false },
          { model: 'critic-model', isDefault: false, hidden: false },
        ],
      },
    });
  else if (r.method === 'thread/start') {
    send({
      id: r.id,
      result: { thread: { id: 'thread-test' }, model: r.params.model ?? 'test-model' },
    });
  } else if (r.method === 'turn/start') {
    send({ id: r.id, result: { turn: { id: 'turn-test' } } });
    if (process.env.SF_TEST_CODEX_BEHAVIOR === 'exit') {
      process.exit(2);
    }
    if (process.env.SF_TEST_CODEX_BEHAVIOR === 'limit') {
      send({
        method: 'turn/completed',
        params: {
          threadId: 'thread-test',
          turn: {
            id: 'turn-test',
            status: 'failed',
            error: { message: 'Limit reached', codexErrorInfo: 'usageLimitExceeded' },
          },
        },
      });
      return;
    }
    send({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-test', delta: 'hello' },
    });
    if (process.env.SF_TEST_CODEX_BEHAVIOR === 'wait') return;
    send({
      id: 'call-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-test',
        turnId: 'turn-test',
        callId: 'call-1',
        tool: 'artifact_read',
        arguments: { path: 'SCRIPT.md' },
      },
    });
  } else if (r.method === 'turn/interrupt') send({ id: r.id, result: {} });
  else if (r.id === 'call-1' && r.result) {
    send({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-test',
        tokenUsage: { last: { inputTokens: 12, outputTokens: 3 } },
      },
    });
    send({
      method: 'turn/completed',
      params: {
        threadId: 'thread-test',
        turn: { id: 'turn-test', status: 'completed', error: null },
      },
    });
  }
});
