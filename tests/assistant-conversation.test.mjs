import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const nluSource = await readFile(new URL("../app/assistant/nlu.ts", import.meta.url), "utf8");
const nluUrl = `data:text/javascript;base64,${Buffer.from(compile(nluSource)).toString("base64")}`;
const conversationSource = (await readFile(new URL("../app/assistant/conversation.ts", import.meta.url), "utf8")).replace('"./nlu"', JSON.stringify(nluUrl));
const { applyConversationReference, resolveAssistantTurn } = await import(`data:text/javascript;base64,${Buffer.from(compile(conversationSource)).toString("base64")}`);

test("a bookmaker-only reply completes a pending code analysis", () => {
  const pending = { kind: "analyze", confidence: 1, code: "4V0XMZ", provider: null };
  const resolved = resolveAssistantTurn(pending, "SportyBet");
  assert.equal(resolved.kind, "analyze");
  assert.equal(resolved.code, "4V0XMZ");
  assert.equal(resolved.provider, "sportybet");
});

test("a complete new request escapes an older pending question", () => {
  const pending = { kind: "analyze", confidence: 1, code: "4V0XMZ", provider: null };
  const resolved = resolveAssistantTurn(pending, "4V0XMZ split this SportyBet code into 3");
  assert.equal(resolved.kind, "split");
  assert.equal(resolved.code, "4V0XMZ");
  assert.equal(resolved.provider, "sportybet");
  assert.equal(resolved.parts, 3);
});

test("short provider replies fill pending split and conversion requests", () => {
  const split = resolveAssistantTurn({ kind: "split", confidence: 1, code: "4V0XMZ", targetOdds: null, parts: 3, provider: null, dateWindow: null }, "SportyBet");
  assert.equal(split.kind, "split");
  assert.equal(split.provider, "sportybet");
  const conversion = resolveAssistantTurn({ kind: "convert", confidence: 1, code: "4V0XMZ", sourceProvider: "sportybet", destinationProvider: null }, "BetKing");
  assert.equal(conversion.kind, "convert");
  assert.equal(conversion.destinationProvider, "betking");
});

test("follow-ups reuse the booking code and bookmaker already in the conversation", () => {
  const reference = { code: "4V0XMZ", provider: "sportybet" };
  const split = applyConversationReference(resolveAssistantTurn(null, "split it into 3"), reference);
  assert.equal(split.kind, "split");
  assert.equal(split.code, "4V0XMZ");
  assert.equal(split.provider, "sportybet");
  const conversion = applyConversationReference(resolveAssistantTurn(null, "convert it to BetKing"), reference);
  assert.equal(conversion.kind, "convert");
  assert.equal(conversion.code, "4V0XMZ");
  assert.equal(conversion.sourceProvider, "sportybet");
  assert.equal(conversion.destinationProvider, "betking");
});
