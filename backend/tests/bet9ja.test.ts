import test from "node:test";
import assert from "node:assert/strict";
import { createBet9jaCode } from "../src/modules/providers/bet9ja.js";

const detail = {
  IDSottoEvento: 825252096, CodPubblicazione: "2939", SottoEvento: "Liverpool - Nottingham Forest", Evento: "Premier League", Sport: "Soccer", DataInizio: "/Date(1788003000000)/",
  ClassiQuotaList: [{ IDClasseQuota: 1, ClasseQuota: "1X2", QuoteList: [
    { IDQuota: 1, TipoQuotaBreve: "1", QuotaValore: 1.54, Giocabilita: 1 },
    { IDQuota: 2, TipoQuotaBreve: "X", QuotaValore: 4.6, Giocabilita: 1 },
  ] }],
};

test("creates and reload-verifies a public Bet9ja booking code", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("GetSearchBoxData")) return Response.json({ d: { SearchResults: [{ ID: 825252096, Type: "SE", Area: "Liverpool - Nottingham Forest", CodPub: "2939", DataInizio: "/Date(1788003000000)/" }] } });
    if (url.endsWith("GetSubEventDetails")) return Response.json({ d: detail });
    if (url.includes("BookABetV2")) return Response.json({ status: 1, data: [{ RIS: "5PGCLX3" }] });
    return Response.json({ d: { O: { "825252096$S_1X2_1": {} } } });
  };
  const result = await createBet9jaCode([{ fixtureId: "one", homeTeam: "Liverpool FC", awayTeam: "Nottingham Forest", kickoff: "2026-08-29T11:30:00Z",
    marketKey: "MATCH_HOME", marketName: "Match result", selection: "Liverpool" }], fakeFetch as typeof fetch);
  assert.equal(result.code, "5PGCLX3");
  assert.equal(result.deepLink, "https://sports.bet9ja.com/?bookABetCode=5PGCLX3");
  const create = calls.find((call) => call.url.includes("BookABetV2"));
  const form = new URLSearchParams(String(create?.init?.body));
  const slip = JSON.parse(String(form.get("BETSLIP")));
  assert.equal(slip.BETS[0].ODDS["825252096$S_1X2_1"], 1.54);
  assert.ok(calls.some((call) => call.url.includes("couponCode=5PGCLX3")));
});
