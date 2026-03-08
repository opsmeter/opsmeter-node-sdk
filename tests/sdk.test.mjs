import test from 'node:test';
import assert from 'node:assert/strict';
import {
  init,
  withContext,
  getCurrentContext,
  captureOpenAIChatCompletion,
  captureOpenAIChatCompletionWithResult,
  resetForTests,
  flush
} from '../src/index.mjs';

test.afterEach(() => {
  resetForTests();
});

test('init is idempotent for same config', () => {
  const first = init({ apiKey: 'key', environment: 'prod', enabled: false });
  const second = init({ apiKey: 'key', environment: 'prod', enabled: false });

  assert.equal(first.didInit, true);
  assert.equal(second.didInit, false);
  assert.equal(second.warning, null);
});

test('withContext sets and restores request context', async () => {
  assert.deepEqual(getCurrentContext(), {});

  await withContext({ userId: 'u1', endpoint: '/api/chat' }, async () => {
    const ctx = getCurrentContext();
    assert.equal(ctx.userId, 'u1');
    assert.equal(ctx.endpoint, '/api/chat');
  });

  assert.deepEqual(getCurrentContext(), {});
});

test('captureOpenAIChatCompletion keeps business response and uses context', async () => {
  init({ apiKey: 'key', enabled: false, environment: 'prod' });

  const result = await withContext(
    {
      userId: 'u_1',
      tenantId: 'tenant_a',
      endpoint: '/api/chat',
      feature: 'assistant',
      promptVersion: 'v12',
      externalRequestId: 'ext_fixed'
    },
    async () => captureOpenAIChatCompletion(
      async () => ({
        id: 'req_1',
        model: 'gpt-4o-mini',
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15
        }
      }),
      {
        request: { model: 'gpt-4o-mini' }
      }
    )
  );

  assert.equal(result.model, 'gpt-4o-mini');
  await flush();
});

test('captureOpenAIChatCompletionWithResult returns telemetry result when awaited', async () => {
  init({ apiKey: 'key', enabled: false, environment: 'prod' });

  const result = await captureOpenAIChatCompletionWithResult(
    async () => ({
      id: 'req_2',
      model: 'gpt-4o-mini',
      usage: {
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10
      }
    }),
    {
      request: { model: 'gpt-4o-mini' },
      awaitTelemetryResponse: true
    }
  );

  assert.equal(result.providerResponse.model, 'gpt-4o-mini');
  assert.equal(result.telemetry.ok, true);
  assert.equal(result.telemetry.status, 204);
  assert.ok(result.externalRequestId.startsWith('ext_'));
});
