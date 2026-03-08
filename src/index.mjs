import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const VALID_ENVIRONMENTS = new Set(['prod', 'staging', 'dev']);
const VALID_DATA_MODES = new Set(['real', 'test', 'demo']);

const DEFAULTS = Object.freeze({
  telemetryBaseUrl: 'https://api.opsmeter.io',
  environment: 'prod',
  enabled: true,
  flushIntervalMs: 1000,
  maxBatchSize: 50,
  requestTimeoutMs: 600,
  dedupeWindowMs: 300_000,
  maxRetries: 2,
  debug: false
});

const storage = new AsyncLocalStorage();
const state = {
  initialized: false,
  config: null,
  queue: [],
  timer: null,
  flushing: false,
  dedupe: new Map()
};

function safeNow() {
  return Date.now();
}

function logDebug(...args) {
  if (state.config?.debug) {
    console.debug('[opsmeter-sdk]', ...args);
  }
}

function readNumber(config, key, fallback, { min = 0 } = {}) {
  const raw = config[key];
  const value = raw === undefined || raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`Invalid ${key}: ${raw}`);
  }

  return value;
}

function normalizeEnvironment(value) {
  const normalized = String(value ?? DEFAULTS.environment).trim().toLowerCase();
  if (!VALID_ENVIRONMENTS.has(normalized)) {
    throw new Error(`Invalid environment: ${value}. Allowed: prod|staging|dev`);
  }

  return normalized;
}

function normalizeDataMode(value) {
  const normalized = String(value ?? 'real').trim().toLowerCase();
  if (!VALID_DATA_MODES.has(normalized)) {
    throw new Error(`Invalid dataMode: ${value}. Allowed: real|test|demo`);
  }

  return normalized;
}

function normalizeInit(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('init config is required.');
  }

  const apiKey = String(config.apiKey ?? '').trim();
  const enabled = config.enabled !== false;
  if (!apiKey && enabled) {
    throw new Error('apiKey is required when SDK is enabled.');
  }

  const forbidden = ['userId', 'tenantId', 'endpoint', 'feature', 'promptVersion', 'externalRequestId'];
  const forbiddenPresent = forbidden.filter((field) => Object.prototype.hasOwnProperty.call(config, field));
  if (forbiddenPresent.length > 0) {
    throw new Error(`Request-level fields are not allowed in init(): ${forbiddenPresent.join(', ')}`);
  }

  const onTelemetryResult = typeof config.onTelemetryResult === 'function' ? config.onTelemetryResult : null;

  return {
    apiKey,
    workspaceId: config.workspaceId ? String(config.workspaceId) : null,
    telemetryBaseUrl: String(config.telemetryBaseUrl ?? DEFAULTS.telemetryBaseUrl).replace(/\/$/, ''),
    environment: normalizeEnvironment(config.environment),
    enabled,
    flushIntervalMs: readNumber(config, 'flushIntervalMs', DEFAULTS.flushIntervalMs, { min: 1 }),
    maxBatchSize: readNumber(config, 'maxBatchSize', DEFAULTS.maxBatchSize, { min: 1 }),
    requestTimeoutMs: readNumber(config, 'requestTimeoutMs', DEFAULTS.requestTimeoutMs, { min: 1 }),
    dedupeWindowMs: readNumber(config, 'dedupeWindowMs', DEFAULTS.dedupeWindowMs, { min: 1 }),
    maxRetries: readNumber(config, 'maxRetries', DEFAULTS.maxRetries, { min: 0 }),
    debug: Boolean(config.debug),
    onTelemetryResult
  };
}

function shallowEqualConfig(a, b) {
  if (!a || !b) {
    return false;
  }

  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function ensureTimer() {
  if (state.timer || !state.initialized || !state.config?.enabled) {
    return;
  }

  state.timer = setInterval(() => {
    void flush();
  }, state.config.flushIntervalMs);

  state.timer.unref?.();
}

export function init(config) {
  const normalized = normalizeInit(config);

  if (!state.initialized) {
    state.config = normalized;
    state.initialized = true;
    ensureTimer();
    return { didInit: true, initialized: true, warning: null };
  }

  if (shallowEqualConfig(state.config, normalized)) {
    return { didInit: false, initialized: true, warning: null };
  }

  return {
    didInit: false,
    initialized: true,
    warning: 'SDK already initialized with a different config. First init config is kept.'
  };
}

function normalizeContext(context) {
  if (!context) {
    return {};
  }

  const metadata = context.metadata && typeof context.metadata === 'object'
    ? Object.fromEntries(
      Object.entries(context.metadata)
        .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    )
    : undefined;

  return {
    userId: context.userId ? String(context.userId) : undefined,
    tenantId: context.tenantId ? String(context.tenantId) : undefined,
    endpoint: context.endpoint ? String(context.endpoint) : undefined,
    feature: context.feature ? String(context.feature) : undefined,
    promptVersion: context.promptVersion ? String(context.promptVersion) : undefined,
    externalRequestId: context.externalRequestId ? String(context.externalRequestId) : undefined,
    dataMode: context.dataMode ? normalizeDataMode(context.dataMode) : undefined,
    metadata
  };
}

export async function withContext(context, fn) {
  if (typeof fn !== 'function') {
    throw new Error('withContext requires a function callback.');
  }

  const parent = storage.getStore() || {};
  const merged = {
    ...parent,
    ...normalizeContext(context)
  };

  return storage.run(merged, fn);
}

export function getCurrentContext() {
  return storage.getStore() || {};
}

function extractUsage(response) {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? (inputTokens + outputTokens)) || (inputTokens + outputTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

function generateExternalRequestId(seed) {
  const base = String(seed || `${safeNow()}:${Math.random()}`).trim().toLowerCase();
  const digest = crypto.createHash('sha256').update(base).digest('hex').slice(0, 24);
  return `ext_${digest}`;
}

function buildPayloadFromCapture({
  operation,
  request,
  response,
  error,
  latencyMs,
  context,
  externalRequestId
}) {
  const usage = extractUsage(response);
  const status = error ? 'error' : 'success';

  return {
    externalRequestId,
    provider: 'openai',
    model: String(response?.model || request?.model || 'unknown'),
    promptVersion: context.promptVersion || 'unknown',
    endpointTag: context.feature || context.endpoint || 'sdk.unknown',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    latencyMs,
    status,
    errorCode: error ? (error.code || error.name || 'provider_error') : null,
    userId: context.userId || null,
    dataMode: normalizeDataMode(context.dataMode || 'real'),
    environment: state.config?.environment || DEFAULTS.environment,
    metadata: {
      operation,
      tenantId: context.tenantId || null,
      endpoint: context.endpoint || null,
      feature: context.feature || null,
      providerRequestId: response?.id || null,
      sdkLanguage: 'node'
    }
  };
}

function dedupeKey(payload) {
  return `${payload.externalRequestId}:${payload.provider}:${payload.metadata?.operation || 'unknown'}`;
}

function sweepDedupe(nowTs) {
  const cutoff = nowTs - (state.config?.dedupeWindowMs || DEFAULTS.dedupeWindowMs);
  for (const [key, ts] of state.dedupe.entries()) {
    if (ts < cutoff) {
      state.dedupe.delete(key);
    }
  }
}

function enqueue(payload) {
  if (!state.initialized || !state.config?.enabled) {
    return false;
  }

  const nowTs = safeNow();
  sweepDedupe(nowTs);

  const key = dedupeKey(payload);
  if (state.dedupe.has(key)) {
    logDebug('dedupe dropped', key);
    return false;
  }

  state.dedupe.set(key, nowTs);
  state.queue.push({ payload, attempt: 0 });

  if (state.queue.length >= state.config.maxBatchSize) {
    void flush();
  }

  return true;
}

async function postTelemetry(payload) {
  if (!state.config?.enabled) {
    return { ok: true, status: 204, skipped: 'disabled' };
  }

  const url = `${state.config.telemetryBaseUrl}/v1/ingest/llm-request`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), state.config.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': state.config.apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function emitResult(result, payload) {
  if (!state.config?.onTelemetryResult) {
    return;
  }

  try {
    state.config.onTelemetryResult(result, payload);
  } catch {
    // callback failures must not break app flow
  }
}

async function sendOne(item) {
  const result = await postTelemetry(item.payload);
  emitResult(result, item.payload);

  if (result.ok) {
    return;
  }

  if (item.attempt >= (state.config?.maxRetries || DEFAULTS.maxRetries)) {
    logDebug('drop after retries', result.error || result.status);
    return;
  }

  const nextAttempt = item.attempt + 1;
  const backoffMs = 200 * (2 ** nextAttempt);
  setTimeout(() => {
    state.queue.push({ payload: item.payload, attempt: nextAttempt });
  }, backoffMs).unref?.();
}

export async function flush() {
  if (!state.initialized || state.flushing) {
    return;
  }

  state.flushing = true;
  try {
    while (state.queue.length > 0) {
      const batch = state.queue.splice(0, state.config.maxBatchSize);
      await Promise.all(batch.map((item) => sendOne(item)));
    }
  } finally {
    state.flushing = false;
  }
}

async function emitTelemetry(payload, { awaitTelemetryResponse = false } = {}) {
  if (awaitTelemetryResponse) {
    const result = await postTelemetry(payload);
    emitResult(result, payload);
    return result;
  }

  const queued = enqueue(payload);
  return { ok: true, status: queued ? 202 : 204, queued };
}

async function captureInternal(fn, options = {}, { detailed = false } = {}) {
  if (typeof fn !== 'function') {
    throw new Error('captureOpenAIChatCompletion requires a function callback.');
  }

  const start = safeNow();
  const context = getCurrentContext();
  const operation = options.operation || 'chat.completions.create';
  const request = options.request || null;
  const externalRequestId =
    options.externalRequestId ||
    context.externalRequestId ||
    generateExternalRequestId(`${operation}:${request?.model || 'unknown'}:${start}`);

  try {
    const response = await fn();
    const payload = buildPayloadFromCapture({
      operation,
      request,
      response,
      error: null,
      latencyMs: safeNow() - start,
      context,
      externalRequestId
    });

    const telemetry = await emitTelemetry(payload, {
      awaitTelemetryResponse: Boolean(options.awaitTelemetryResponse && detailed)
    });

    if (detailed) {
      return { providerResponse: response, telemetry, externalRequestId, payload };
    }

    return response;
  } catch (error) {
    const payload = buildPayloadFromCapture({
      operation,
      request,
      response: null,
      error,
      latencyMs: safeNow() - start,
      context,
      externalRequestId
    });

    await emitTelemetry(payload, {
      awaitTelemetryResponse: Boolean(options.awaitTelemetryResponse && detailed)
    });

    throw error;
  }
}

export async function captureOpenAIChatCompletion(fn, options = {}) {
  return captureInternal(fn, options, { detailed: false });
}

export async function captureOpenAIChatCompletionWithResult(fn, options = {}) {
  return captureInternal(fn, options, { detailed: true });
}

export function patchOpenAIClient(client, options = {}) {
  const create = client?.chat?.completions?.create;
  if (typeof create !== 'function') {
    throw new Error('OpenAI client chat.completions.create function not found.');
  }

  if (create.__opsmeterPatched) {
    return { patched: false, reason: 'already_patched' };
  }

  const original = create;
  client.chat.completions.create = async function patched(request, ...args) {
    return captureOpenAIChatCompletion(
      () => original.call(this, request, ...args),
      {
        operation: options.operation || 'chat.completions.create',
        request
      }
    );
  };

  client.chat.completions.create.__opsmeterPatched = true;
  return { patched: true };
}

export function resetForTests() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }

  state.initialized = false;
  state.config = null;
  state.queue = [];
  state.flushing = false;
  state.dedupe.clear();
}
