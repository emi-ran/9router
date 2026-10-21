"use client";

import { useState, useSyncExternalStore } from "react";
import { Card } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { buildTranscriptionRequest, buildTranscriptionCurl, readTranscriptionResponse } from "@/mine/stt/example.js";
import { Row } from "./exampleShared";

const subscribeOrigin = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

// Codex intentionally exposes only file/model/response_format, unlike upstream STT providers.
export function SttExampleCard() {
  const [audioFile, setAudioFile] = useState(null);
  const [responseFormat, setResponseFormat] = useState("json");
  const [apiKey, setApiKey] = useState("");
  const endpoint = useSyncExternalStore(subscribeOrigin, getOrigin, getServerOrigin);
  const [result, setResult] = useState(null);
  const [latency, setLatency] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedResult, copy: copyResult } = useCopyToClipboard();

  const curl = buildTranscriptionCurl(endpoint, audioFile?.name || "audio.mp3", responseFormat);
  const resultText = result === null ? (responseFormat === "text" ? "Hello world..." : '{\n  "text": "Hello world..."\n}')
    : typeof result === "string" ? result : JSON.stringify(result, null, 2);

  const handleRun = async () => {
    if (!audioFile || running) return;
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const response = await fetch("/api/v1/audio/transcriptions", buildTranscriptionRequest(audioFile, responseFormat, apiKey));
      setResult(await readTranscriptionResponse(response));
      setLatency(Date.now() - start);
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">Example</h2>
      <div className="flex flex-col gap-2.5">
        <Row label="Model"><code>cx/transcribe</code></Row>
        <Row label="Endpoint"><code className="text-xs break-all">{endpoint}/v1/audio/transcriptions</code></Row>
        <Row label="Audio File">
          <input type="file" aria-label="Audio file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.flac,.webm,.opus" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} className="w-full text-xs" />
        </Row>
        <Row label="API Key">
          <input type="password" aria-label="Gateway API key" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Gateway API key (if required)" className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background" />
        </Row>
        <p className="text-xs text-text-muted">Use a 9Router gateway key, not your Codex OAuth token. Replace YOUR_KEY in the curl example.</p>
        <Row label="Response Format">
          <select aria-label="Response format" value={responseFormat} onChange={(e) => setResponseFormat(e.target.value)} className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background">
            <option value="json">json</option>
            <option value="text">text</option>
          </select>
        </Row>
        <div className="flex flex-wrap justify-between gap-2 mt-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Request</span>
          <div className="flex gap-3">
            <button onClick={() => copyCurl(curl)} className="text-xs text-primary">{copiedCurl ? "Copied" : "Copy curl"}</button>
            <button onClick={handleRun} disabled={running || !audioFile} className="px-3 py-1 rounded-lg bg-primary text-white text-xs disabled:opacity-50">{running ? "Transcribing..." : "Run"}</button>
          </div>
        </div>
        <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre-wrap break-all">{curl}</pre>
        {error && <p role="alert" className="text-xs text-red-500 break-words">{error}</p>}
        <div className="flex justify-between gap-2 mt-2">
          <span className="text-xs font-semibold text-text-muted uppercase">Response {result !== null && latency !== null ? `· ${latency}ms` : "(example)"}</span>
          {result !== null && <button onClick={() => copyResult(resultText)} className="text-xs text-primary">{copiedResult ? "Copied" : "Copy response"}</button>}
        </div>
        <pre className="bg-sidebar rounded-lg px-3 py-2.5 text-xs overflow-x-auto whitespace-pre-wrap break-all">{resultText}</pre>
      </div>
    </Card>
  );
}
