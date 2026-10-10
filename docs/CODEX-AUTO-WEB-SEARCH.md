# Codex automatic hosted web search

Codex requests to `/v1/chat/completions`, `/api/v1/chat/completions`,
`/v1/responses`, and `/api/v1/responses` automatically make the hosted
`web_search` tool available. This enables the model to search; it does not force
search on every turn. Other providers and endpoints are unchanged.

Existing function tools are preserved. An existing `web_search` definition is
not duplicated or replaced. `tool_choice: "none"` suppresses automatic insertion;
explicitly supplied search tools remain present, with the choice preserved.

## Disable automatic insertion

Use the existing authenticated settings API:

```http
PATCH /api/settings
Content-Type: application/json

{"codexAutoWebSearch":false}
```

Set `codexAutoWebSearch` to `true` to restore automatic insertion. The default is
`true`, including installations whose stored settings omit this key. This setting
applies to both Chat Completions and Responses; it does not remove tools explicitly
supplied by the client. There is no new dashboard control.

Hosted search needs regular Responses transport, so automatic search switches
Codex Lite models to that transport. Disabling it retains Lite transport when no
explicit hosted search tool is present.

Chat Completions translates the resulting assistant text normally, both for JSON
and SSE clients. Server-side search events are not emitted as client function
calls. Offline regression tests exercise the real handler, executor, and response
translation with an upstream SSE fixture; they do not prove live account/backend
availability. Citation fidelity is not expanded by this feature.
