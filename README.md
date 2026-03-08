# @opsmeter/node (Preview)

Node SDK preview for Opsmeter auto-instrumentation.

Provider/model names should come from: [https://opsmeter.io/docs/catalog](https://opsmeter.io/docs/catalog)
Current SDK provider support: **OpenAI** and **Anthropic** only.

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
import Anthropic from "@anthropic-ai/sdk";

opsmeter.init({
  apiKey: process.env.OPSMETER_API_KEY,
  workspaceId: "ws_123",
  environment: "prod"
});

const client = new OpenAI();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const response = await opsmeter.withContext(
  {
    userId: "u_1",
    tenantId: "tenant_a",
    endpoint: "/api/chat",
    feature: "assistant",
    promptVersion: "v12"
  },
  async () => opsmeter.captureOpenAIChatCompletion(
    // Provider/model names: https://opsmeter.io/docs/catalog
    () => client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hello" }] }),
    { request: { model: "gpt-4o-mini" } }
  )
);

const anthropicResponse = await opsmeter.withContext(
  {
    userId: "u_1",
    tenantId: "tenant_a",
    endpoint: "/api/support",
    feature: "support",
    promptVersion: "v8"
  },
  async () => opsmeter.captureAnthropicMessage(
    // Provider/model names: https://opsmeter.io/docs/catalog
    () => anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 128,
      messages: [{ role: "user", content: "Summarize this support ticket." }]
    }),
    { request: { model: "claude-3-5-sonnet-20241022" } }
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
- `captureAnthropicMessage(fn, options)`
- `captureAnthropicMessageWithResult(fn, options)`
- `patchOpenAIClient(client)`
- `patchAnthropicClient(client)`
- `flush()`

## Tests

```bash
npm run lint
npm run test
```
