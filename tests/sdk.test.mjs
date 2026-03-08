import test from 'node:test';
import assert from 'node:assert/strict';
import {
  init,
  withContext,
  getCurrentContext,
  captureOpenAIChatCompletion,
  captureOpenAIChatCompletionWithResult,
  captureAnthropicMessageWithResult,
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

test('captureOpenAIChatCompletionWithResult works without options', async () => {
  init({ apiKey: 'key', enabled: false, environment: 'prod' });

  const result = await captureOpenAIChatCompletionWithResult(
    async () => ({
      id: 'req_3',
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
    })
  );

  assert.equal(result.payload.provider, 'openai');
  assert.equal(result.payload.model, 'gpt-4o-mini');
  assert.equal(result.telemetry.status, 204);
});

test('captureOpenAIChatCompletionWithResult honors explicit options', async () => {
  init({ apiKey: 'key', enabled: false, environment: 'prod' });

  const result = await captureOpenAIChatCompletionWithResult(
    async () => ({
      id: 'req_4',
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
    }),
    {
      externalRequestId: 'ext_manual',
      request: { model: 'gpt-4o-mini' },
      awaitTelemetryResponse: true
    }
  );

  assert.equal(result.externalRequestId, 'ext_manual');
  assert.equal(result.payload.totalTokens, 6);
  assert.equal(result.telemetry.status, 204);
});

test('captureAnthropicMessageWithResult marks provider as anthropic', async () => {
  init({ apiKey: 'key', enabled: false, environment: 'prod' });

  const result = await captureAnthropicMessageWithResult(
    async () => ({
      id: 'msg_1',
      model: 'claude-3-5-sonnet-20241022',
      usage: {
        input_tokens: 11,
        output_tokens: 6
      }
    }),
    {
      request: { model: 'claude-3-5-sonnet-20241022' },
      awaitTelemetryResponse: true
    }
  );

  assert.equal(result.payload.provider, 'anthropic');
  assert.equal(result.payload.totalTokens, 17);
  assert.equal(result.telemetry.ok, true);
});
