import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const failureSource = await readFile(new URL("../app/assistant/failures.ts", import.meta.url), "utf8");
const failureUrl = `data:text/javascript;base64,${Buffer.from(compile(failureSource)).toString("base64")}`;
const { assistantFailureMessage } = await import(failureUrl);
const clientSource = await readFile(new URL("../app/assistant/assistant-client.tsx", import.meta.url), "utf8");
const executeStart = clientSource.indexOf("async function execute(intent:");
const executeEnd = clientSource.indexOf("\n  async function importPredictionImage", executeStart);
const executeSource = clientSource.slice(executeStart, executeEnd);

test("assistant explains timeouts and keeps the conversation", () => {
  assert.match(assistantFailureMessage(new Error("request timed out")), /timed out/i);
  assert.match(assistantFailureMessage(new Error("AbortError")), /timed out/i);
  assert.match(assistantFailureMessage(new Error("request timed out")), /conversation is still here/i);
});

test("assistant gives a retry hint when a data or bookmaker service is unavailable", () => {
  assert.match(assistantFailureMessage(new Error("fetch failed")), /temporarily unavailable/i);
  assert.match(assistantFailureMessage(new Error("HTTP 503")), /try again shortly/i);
});

test("assistant uses safe fallback text for unexpected errors", () => {
  const message = assistantFailureMessage(new Error("private diagnostic token"));
  assert.match(message, /unexpected problem/i);
  assert.doesNotMatch(message, /private diagnostic token/i);
});

test("request dispatcher reports failures and always clears its busy state", () => {
  assert.match(executeSource, /catch \(error\)\s*\{\s*addMessage\("assistant", assistantFailureMessage\(error\)\);/);
  assert.match(executeSource, /finally\s*\{\s*setBusy\(false\);/);
});
