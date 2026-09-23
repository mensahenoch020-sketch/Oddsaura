import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/assistant/nlu.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { interpretAssistantRequest } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const matrix = [
  ["Hello OddsAura", "help"],
  ["What can you do?", "help"],
  ["Give me guaranteed winning odds", "limits"],
  ["Add corners and player bets", "limits"],
  ["Give me 5 safe odds for today on SportyBet", "build"],
  ["Build 15 odds for tomorrow on Bet9ja", "build"],
  ["I need 20 odds for BetKing, nothing too risky", "build"],
  ["Give me around 10 odds on sporty", "build"],
  ["Give me the best value picks for BetKing", "best"],
  ["I need something safe tonight", "best"],
  ["Best pawa picks this weekend", "best"],
  ["Give me Premier League and La Liga predictions only", "best"],
  ["Show today's picks", "daily"],
  ["What matches are available tomorrow?", "fixtures"],
  ["Show yesterday's results", "results"],
  ["Did our last tickets win?", "results"],
  ["4V0XMZ split this SportyBet code into 3", "split"],
  ["Break my 50 odds into two Bet9ja slips", "split"],
  ["Convert SportyBet code 4V0XMZ to BetKing", "convert"],
  ["Move 5SJF5FN from Bet9ja to SportyBet", "convert"],
  ["What do you think about SportyBet code 4V0XMZ?", "analyze"],
  ["Analyse 5SJF5FN on Bet9ja", "analyze"],
  ["Why did you choose this option?", "explain"],
  ["Explain this pick in simple English", "explain"],
  ["Nah, make it safer", "revise"],
  ["Remove that match", "revise"],
  ["Replace the weakest selection", "revise"],
  ["Which pick is the riskiest?", "revise"],
  ["What do you think about Arsenal vs Chelsea?", "match"],
  ["Who will win Arsenal vs Chelsea?", "match"],
  ["4V0XMZ", "analyze"],
  ["Abeg arrange 10 odds for sporty tomorrow", "build"],
  ["I wan 5 odds bet9ja today", "build"],
  ["What could make this pick lose?", "explain"],
  ["How can this selection fail?", "explain"],
  ["Which leg should I remove?", "revise"],
  ["Give me Bundesliga picks this weekend", "best"],
  ["Show the strongest DNB options on BetKing", "best"],
  ["Build 8 odds using BTTS No on BetPawa", "build"],
  ["Carry Sporty code 4V0XMZ go Bet9ja", "convert"],
  ["What is your prediction for Arsenal against Chelsea?", "match"],
  ["Arsenal v Chelsea best pick", "match"],
  ["Can this slip lose?", "explain"],
  ["Give me low risk picks for Betway", "best"],
  ["Show DNB options on SportyBet", "best"],
];

test("routes a broad matrix of realistic user questions", () => {
  for (const [prompt, expected] of matrix) assert.equal(interpretAssistantRequest(prompt).kind, expected, prompt);
});

test("understands negative and combined market instructions", () => {
  const noTotals = interpretAssistantRequest("Give me 10 odds for SportyBet without over-under markets");
  assert.equal(noTotals.kind, "build");
  assert.ok(noTotals.marketKeys.includes("DC_1X"));
  assert.ok(!noTotals.marketKeys.some((key) => /OVER|UNDER/.test(key)));
  const combined = interpretAssistantRequest("Use DNB, BTTS No and positive handicaps for BetKing");
  assert.ok(combined.marketKeys, JSON.stringify(combined));
  assert.ok(combined.marketKeys.includes("DNB_HOME"));
  assert.ok(combined.marketKeys.includes("BTTS_NO"));
  assert.ok(combined.marketKeys.includes("ASIAN_HOME_P0_5"));
});
