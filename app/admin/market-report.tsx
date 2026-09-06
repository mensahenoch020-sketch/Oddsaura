export type MarketTest = { key: string; matches: number; voids: number; accuracy: number | null; baselineAccuracy: number | null; selected: number; selectedHitRate: number | null };
export type ExpandedPerformance = { markets?: MarketTest[]; baseline?: { label: string; accuracy: number | null }; limitations?: string[]; pricingAudit?: { methodology: string; conclusion: string; probabilityModels: Array<{modelWeight:number;matches:number;brier:number|null;logLoss:number|null}>; favoriteBands: Array<{threshold:number;picks:number;hitRate:number|null;roi:number|null}> }; builderAudit?: {strategyVersion?:string; limitation: string; rows: Array<{target:number;days:number;built:number;noTicket:number;won:number;lost:number}>} };
const labels: Record<string, string> = { BTTS_YES: "Both teams to score", OVER_1_5: "Over 1.5", OVER_2_5: "Over 2.5", UNDER_3_5: "Under 3.5", DC_1X: "Home or draw", DC_X2: "Draw or away", DC_12: "Either team wins", DNB_HOME: "Home draw-no-bet", DNB_AWAY: "Away draw-no-bet", HOME_CLEAN: "Home clean sheet", AWAY_CLEAN: "Away clean sheet", HOME_WIN_NIL: "Home wins to nil", AWAY_WIN_NIL: "Away wins to nil" };
const percent = (n: number | null | undefined) => n == null ? "Not tested" : `${(n * 100).toFixed(1)}%`;

export default function MarketReport({ performance }: { performance: ExpandedPerformance }) {
  return <section id="markets" className="adm-market-report">
    <h2>Market coverage and testing</h2>
    <p>Prediction support, historical testing and bookmaker conversion are separate capabilities. A market listed here is not a guarantee that every bookmaker offers it. Model-estimate prices in Build My Odds are always checked against the selected bookmaker before a generated code is treated as verified.</p>
    <h3>Historical tests by selection</h3>
    <p>Accuracy includes correctly predicting that a selection will lose. Pick hit rate only counts selections assigned at least 50% probability. Neither is accumulator win rate. The baseline uses the most frequent outcome in earlier matches.</p>
    <p>1X2 baseline: {performance.baseline?.label ?? "Not yet loaded"} · {percent(performance.baseline?.accuracy)}</p>
    {performance.markets?.length ? <div className="adm-table-scroll" tabIndex={0} aria-label="Historical market tests"><table><thead><tr><th>Selection</th><th>Matches</th><th>Voids</th><th>Accuracy</th><th>Baseline</th><th>Picked</th><th>Pick hit rate</th></tr></thead><tbody>{performance.markets.map(row => <tr key={row.key}><th>{labels[row.key] ?? row.key.replaceAll("_", " ")}</th><td>{row.matches}</td><td>{row.voids}</td><td>{percent(row.accuracy)}</td><td>{percent(row.baselineAccuracy)}</td><td>{row.selected}</td><td>{percent(row.selectedHitRate)}</td></tr>)}</tbody></table></div> : <p>The expanded test report has not loaded yet.</p>}
    <h3>Predicted, but not covered by this report</h3>
    <p>Other totals and team-goal lines, correct score, goal parity, first-half and combination markets. Early-payout estimates currently reuse match-result probabilities; they are not a separately validated early-payout model.</p>
    <h3>Not modelled</h3><p>Corners, cards and player shots. European handicap import is a converter capability, not a handicap prediction model.</p>
    <h3>Destination conversion rules implemented</h3>
    <p>These describe code mappings—not live-tested availability. Every requested fixture, line and outcome must still match exactly.</p>
    <dl>
      <dt>SportyBet</dt><dd>1X2, double chance, draw-no-bet, totals, team goals, BTTS, early payout, selected first-half and combination markets, clean sheets, win to nil, goal parity, correct score. European three-way handicap requires an exact line and three outcomes; live verification pending.</dd>
      <dt>betPawa</dt><dd>1X2, double chance, draw-no-bet, totals, team goals, BTTS, early payout, selected first-half and result/goal combinations, clean sheets, win to nil, goal parity, correct score.</dd>
      <dt>BetKing</dt><dd>1X2, double chance, totals, team goals, BTTS and early payout.</dd>
      <dt>Betway</dt><dd>1X2, double chance and totals. Handicap import does not mean handicap code creation is supported.</dd>
      <dt>Bet9ja</dt><dd>Mappings exist for 1X2, double chance, draw-no-bet, totals, BTTS, early payout, first-half result and goal parity. Connection remains limited; automatic code creation is not confirmed.</dd>
    </dl>
    <h3>Target builder audit</h3>
    {performance.builderAudit ? <><p>{performance.builderAudit.limitation}</p><div className="adm-table-scroll" tabIndex={0}><table><thead><tr><th>Target</th><th>Days</th><th>Built</th><th>No ticket</th><th>Won</th><th>Lost</th></tr></thead><tbody>{performance.builderAudit.rows.map(row => <tr key={row.target}><th>{row.target}</th><td>{row.days}</td><td>{row.built}</td><td>{row.noTicket}</td><td>{row.won}</td><td>{row.lost}</td></tr>)}</tbody></table></div></> : <p>No target-builder audit is available in this report.</p>}
    <h3>Reverse market audit</h3>
    {performance.pricingAudit ? <><p>{performance.pricingAudit.methodology}</p><div className="adm-table-scroll" tabIndex={0}><table><thead><tr><th>OddsAura model weight</th><th>Matches</th><th>Brier</th><th>Log loss</th></tr></thead><tbody>{performance.pricingAudit.probabilityModels.map(row => <tr key={row.modelWeight}><th>{Math.round(row.modelWeight * 100)}%</th><td>{row.matches}</td><td>{row.brier?.toFixed(3) ?? "—"}</td><td>{row.logLoss?.toFixed(3) ?? "—"}</td></tr>)}</tbody></table></div><h4>Bookmaker favourite reliability</h4><div className="adm-table-scroll" tabIndex={0}><table><thead><tr><th>Minimum market probability</th><th>Historical picks</th><th>Hit rate</th><th>Flat-stake ROI</th></tr></thead><tbody>{performance.pricingAudit.favoriteBands.map(row => <tr key={row.threshold}><th>{percent(row.threshold)}</th><td>{row.picks}</td><td>{percent(row.hitRate)}</td><td>{percent(row.roi)}</td></tr>)}</tbody></table></div><p>{performance.pricingAudit.conclusion}</p></> : <p>The reverse market audit has not loaded yet.</p>}
    <h3>What this test does not prove</h3>{performance.limitations?.map(text => <p key={text}>{text}</p>)}
  </section>;
}
