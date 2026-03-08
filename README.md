# @opsmeter/node (Preview)

Node SDK preview for Opsmeter auto-instrumentation.

## Install

```bash
npm install @opsmeter/node
```

## Core model

- `init(...)` once at process startup (idempotent)
- request-level attribution via `withContext(...)`
- provider call stays direct (no proxy)
- telemetry emit is async and non-blocking by default

## Quickstart

```ts
import * as opsmeter from "@opsmeter/node";
import OpenAI from "openai";

opsmeter.init({
  apiKey: process.env.OPSMETER_API_KEY,
  workspaceId: "ws_123",
  environment: "prod"
});

const client = new OpenAI();

const response = await opsmeter.withContext(
  {
    userId: "u_1",
    tenantId: "tenant_a",
    endpoint: "/api/chat",
    feature: "assistant",
    promptVersion: "v12"
  },
  async () => opsmeter.captureOpenAIChatCompletion(
    () => client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] }),
    { request: { model: "gpt-4o-mini" } }
  )
);
```

## Show Opsmeter ingest result

If you want to surface Opsmeter response (for operator UI/debug):

```ts
const captured = await opsmeter.captureOpenAIChatCompletionWithResult(
  () => client.chat.completions.create(request),
  { request, awaitTelemetryResponse: true }
);

console.log(captured.telemetry); // { ok, status, body? }
```

## API

- `init(config)`
- `withContext(context, fn)`
- `getCurrentContext()`
- `captureOpenAIChatCompletion(fn, options)`
- `captureOpenAIChatCompletionWithResult(fn, options)`
- `patchOpenAIClient(client)`
- `flush()`

## Tests

```bash
npm run lint
npm run test
```
