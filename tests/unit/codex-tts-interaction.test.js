// @vitest-environment jsdom
import { expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
globalThis.Uint8Array = Object.getPrototypeOf(new TextEncoder().encode('')).constructor;
const { build } = require('esbuild');
async function loadCard() {
  const result = await build({
    entryPoints: [process.cwd() + '/src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/TtsExampleCard.js'],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.js': 'jsx' }, jsx: 'automatic',
    plugins: [{ name: 'ui-shell', setup(b) {
      b.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: args.path, external: true }));
      b.onResolve({ filter: /^(@\/shared\/|\.\/exampleShared)/ }, args => ({ path: args.path, namespace: 'shell' }));
      b.onLoad({ filter: /.*/, namespace: 'shell' }, args => ({ contents: args.path.includes('useCopy') ? 'exports.useCopyToClipboard = () => ({copied:false,copy:()=>{}})' : 'const React=require("react"); exports.Card=exports.Row=({children})=>React.createElement("div",null,children);' }));
      b.onResolve({ filter: /^@\/mine\// }, args => ({ path: process.cwd() + '/src/' + args.path.slice(2) }));
    }}],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports.TtsExampleCard;
}

it('keeps the form mounted while clearing and retyping the language', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const Card = await loadCard();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(React.createElement(Card)));
    const field = host.querySelector('[aria-label="Pronunciation language"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const value of ['', 't', 'tr', 'en-', 'en-U', 'en-US']) {
      await act(async () => { setter.call(field, value); field.dispatchEvent(new Event('input', {bubbles:true})); });
      expect(host.querySelector('[aria-label="Pronunciation language"]')).toBe(field);
      expect(field.value).toBe(value);
    }
    const speed = host.querySelector('[aria-label="Speech speed"]');
    for (const value of ['', '0', '3', '1']) {
      await act(async () => { setter.call(speed, value); speed.dispatchEvent(new Event('input', {bubbles:true})); });
      expect(host.querySelector('[aria-label="Speech speed"]')).toBe(speed);
      expect(host.querySelector('button').disabled).toBe(value !== '1');
    }
  } finally { await act(async () => root.unmount()); host.remove(); }
});
