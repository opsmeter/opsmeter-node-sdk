# @opsmeter.io/node (Official opsmeter.io SDK)

[![npm version](https://img.shields.io/npm/v/%40opsmeter.io%2Fnode)](https://www.npmjs.com/package/@opsmeter.io/node)
[![license](https://img.shields.io/github/license/opsmeter-io/opsmeter.io-node-sdk)](https://github.com/opsmeter-io/opsmeter.io-node-sdk/blob/main/LICENSE)

Node SDK preview for Opsmeter auto-instrumentation.
npm package: [@opsmeter.io/node](https://www.npmjs.com/package/@opsmeter.io/node)
Integration examples: [opsmeter-integration-examples](https://github.com/opsmeter-io/opsmeter.io-integration-examples)
Opsmeter site: [https://opsmeter.io](https://opsmeter.io)
Official publisher identity: **opsmeter.io**.

Use this SDK for **LLM cost tracking**, **OpenAI usage monitoring**, **Anthropic usage telemetry**, and **no-proxy AI observability** in Node.js.

Provider/model names should come from: [https://opsmeter.io/docs/catalog](https://opsmeter.io/docs/catalog)
Current SDK provider support: **OpenAI** and **Anthropic** only.

## Quick links

- Product: [https://opsmeter.io](https://opsmeter.io)
- Docs: [https://opsmeter.io/docs](https://opsmeter.io/docs)
- Model catalog: [https://opsmeter.io/docs/catalog](https://opsmeter.io/docs/catalog)
- Integration examples: [https://github.com/opsmeter-io/opsmeter.io-integration-examples](https://github.com/opsmeter-io/opsmeter.io-integration-examples)

## Model catalog (required)

Always use provider/model pairs from the official catalog:
[https://opsmeter.io/docs/catalog](https://opsmeter.io/docs/catalog)

Examples:
- OpenAI: `provider=openai`, `model=gpt-4o-mini`
- Anthropic: `provider=anthropic`, `model=claude-3-5-sonnet-20241022`

## Install

```bash
npm install @opsmeter.io/node openai
# optional:
# npm install @anthropic-ai/sdk
```

## Core model

- `init(...)` once at process startup (idempotent)
- request-level attribution via `withContext(...)`
- provider call stays direct (no proxy)
- telemetry emit is async and non-blocking by default

## Telemetry usage (no options)

```ts
import * as opsmeter from "@opsmeter.io/node";
import OpenAI from "openai";

opsmeter.init({
  apiKey: process.env.OPSMETER_API_KEY,
  environment: "prod"
});

const client = new OpenAI();

await opsmeter.captureOpenAIChatCompletion(
  () => client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "hello" }]
  })
);
```

## Telemetry usage (with options/context)

```ts
import * as opsmeter from "@opsmeter.io/node";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

opsmeter.init({
  apiKey: process.env.OPSMETER_API_KEY,
  workspaceId: "ws_123",
  environment: "prod"
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const openaiCaptured = await opsmeter.withContext(
  {
    userId: "u_1",
    tenantId: "tenant_a",
    endpoint: "/api/chat",
    feature: "assistant",
    promptVersion: "v12",
    dataMode: "real"
  },
  async () => opsmeter.captureOpenAIChatCompletionWithResult(
    () => openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }]
    }),
    { request: { model: "gpt-4o-mini" }, awaitTelemetryResponse: true }
  )
);

const anthropicCaptured = await opsmeter.withContext(
  {
    userId: "u_1",
    tenantId: "tenant_a",
    endpoint: "/api/support",
    feature: "support",
    promptVersion: "v8"
  },
  async () => opsmeter.captureAnthropicMessageWithResult(
    // Provider/model names: https://opsmeter.io/docs/catalog
    () => anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 128,
      messages: [{ role: "user", content: "Summarize this support ticket." }]
    }),
    { request: { model: "claude-3-5-sonnet-20241022" }, awaitTelemetryResponse: true }
  )
);

console.log(openaiCaptured.telemetry.status);
console.log(anthropicCaptured.telemetry.status);
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
