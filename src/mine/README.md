# Mine Extensions

Fork-specific features live here to keep upstream 9Router changes small and easier to merge.

## Remember Me

Password login can issue a persistent dashboard session when **Remember me** is selected:

- Access token lifetime: 24 hours
- Refresh token lifetime: 7 days
- Both cookies are HTTP-only and use the dashboard cookie security policy
- Authenticated activity rotates both tokens and moves the refresh expiry seven days forward
- Login without **Remember me** keeps the existing non-persistent access cookie and clears any refresh cookie
- Logout clears both access and refresh cookies

Refresh tokens are accepted only for session renewal. They cannot directly authorize protected routes.

Implementation: `src/mine/auth/rememberMe.js` and `src/mine/auth/RememberMeCheckbox.js`.

## Voice calls (/v1/live)

Browser-to-OpenAI voice calls over WebRTC, backed by Codex OAuth accounts. The app server calls 9router with a 9router API key; audio then flows between the client and the upstream.

- Unofficial upstream: it may change or restrict accounts at any time.
- Not compatible with the OpenAI Realtime API. Codex CLI `/voice` is not supported.
- Off by default: enable **Voice calls (/v1/live)** on the Endpoint dashboard (`voiceEnabled`). When off, the routes return 403.
- Dashboard: **Media Providers > Live > OpenAI Codex** has the same toggle, usage docs for the three request styles, and a "Start call" test page. The browser example needs your own backend; `/v1/live` sends no CORS headers.
- The API key stays on the app server. Never ship it to the browser.
- Auth is always required (`Authorization: Bearer <key>` or `x-api-key`), even when "Require API key" is off and for loopback requests.
- No CORS: no `Access-Control-Allow-*` headers and no OPTIONS handler.
- Errors use `{error:{message,type}}` with `Cache-Control: no-store`.

### POST /v1/live

- `content-type: application/json`, body max 256 KB.
- Fields (unknown fields are rejected with 400):
  - `sdp` (required): SDP offer, starts with `v=0`.
  - `model` (optional): `cx/voice` or `codex/voice`.
  - `voice` (optional): `^[a-z]{2,32}$`, default `cove`.
  - `instructions` (optional): string, max 16000 chars.
  - `context` (optional): max 50 items `{role: "user"|"assistant", text}`, max 16000 chars total.
- 201: `{ "id", "sdp" (answer), "expires_at" }` plus `Location: /v1/live/{id}`. `expires_at` is the 9router hard limit (unix seconds).
- 429 when 2 calls are already in flight (creations count).

### DELETE /v1/live/{id}

- Works even after `voiceEnabled` is switched off.
- Only the API key that created the call may close it (the key is stored as a hash). Unknown id or another key: 404.
- 200 `{id, status:"closed"}` and frees the slot. If the upstream hangup fails: 502 and the entry is kept for retry.

### Limits

- Max 300 s per call. A server timer hangs the call up (with a few retries), then drops it.
- Max 2 concurrent calls in total.
- Both constants live in one place in `src/mine/voice/`.
- The call registry is in memory. A restart forgets all calls: 9router can no longer hang them up or enforce their limit, and the slots are freed.

### Client flow

1. Browser: create `RTCPeerConnection`, add the mic track, and create a data channel named `oai-events`.
2. Browser: create an offer SDP and send it to your app server.
3. App server: `POST /v1/live` with the offer SDP and its 9router key. Return the answer SDP and `id` to the browser.
4. Browser: `setRemoteDescription({type:"answer", sdp})`.

Events on the data channel: `session.started`, `input_transcript.added`, `output_transcript.added`, `turn.created`, `turn.delta`, `turn.done`, `delegation.created` (`item.id`, `item.content[].text`), `session.context.appended`, `delegation.context.appended`, `session.closed`, `error`.

Transcripts: `turn.done` carries `turn.role` (`user` or `assistant`) and the finished `turn.transcript`; `input_transcript.added` and `output_transcript.added` carry partial text in `item.text`.

Client to data channel:

- `{"type":"session.context.append","content":[{"type":"input_text","text":"..."}]}`
- `{"type":"delegation.context.append","delegation_item_id":"...","content":[...]}`

Codex splits long text into chunks of max 500 bytes. Instructions cannot change mid-call; use context append instead.

End of call: the app server calls `DELETE /v1/live/{id}`. Otherwise the slot stays taken until the 300 s limit. Treat `session.closed` as the end and close the `RTCPeerConnection` yourself; its connection state can stay `connected` for a while.

### Account eligibility

- Only Codex OAuth accounts are used. A failed create (401, 403, 429) cools the account down for voice only and tries the next one.
- Accounts behind a relay proxy (Vercel, Cloudflare, Deno) are skipped: the hangup WebSocket cannot go through a relay, so the time limit could not be enforced.
- An account with a model allow-list that does not include `voice` is not selected.

Implementation: `src/mine/voice/`, `src/app/api/v1/live/`.
