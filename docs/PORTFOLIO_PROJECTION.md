# Portfolio projection with Sentiment V1 and V2 (OD-15)

Version `pj-0.1`, 2026-11-21. Frontend only (`index.html`, Portfolio › Projection). Research stage: a model with stated
assumptions, not a forecast and not advice.

## 1. Owner decisions (OD-15)
1. Projections run on a **second portfolio that is a copy** of the accounting ledger. The accounting portfolio still never touches sentiment.
2. Holdings stay in the browser. Only public history and prices are read.
3. Binding rules hold: V1 is read-only, no paid services, no Gemini, bounded reads.
4. Four lines: **Neutral**, **Sentiment V1**, **Sentiment V2** (production `sentiment_score`) and **Sentiment V2 research** (`forecast_research.enhanced_score`).

## 2. Data (all read-only, all free)
| Input | Source |
|---|---|
| Projection copy | `localStorage['cpv2_portfolio_projection_v1']` = `{version:1, kind:'projection_copy', copied_at, source_rows, accounts, txs, fxRates}`. Written only by the owner's "Create / Refresh copy" click. It is the only time the ledger (`cpv2_portfolio_v1`) is read. Savings interest, snapshots and import runs are not copied. |
| Current prices, EUR/USD | Same as the Portfolio (Hyperliquid `allMids`, ECB via Frankfurter) |
| Daily closes | Hyperliquid `candleSnapshot` 1d, last 400 days, BTC plus every held asset. Today's open candle is dropped. |
| V1 and V2 history | PulseWorkerV2 `GET /api/sentiment-v2/comparison?period=all`: V1 readings archived by V2 (from 2026-08-27) and V2 production scores (from 2026-11-14). The endpoint returns at most 500 points (downsampled). |
| V2 research | `GET /api/sentiment-v2/forecast-research?limit=96`: rows with `research.enhanced_score` (from 2026-11-21) |

Requests send only an asset symbol and dates (Hyperliquid) or nothing (GETs). No holdings leave the browser.

## 3. Model
Horizons: **1 day and 7 days**. Longer horizons are not conditioned: there is too little sentiment history (≈ 12 independent 7-day windows of V1 today).

- **Market:** BTC daily log-return volatility σ over the last 180 closes (at least 30). For every other asset, β to BTC and residual volatility σε over the same days. With no history an asset is held at today's price and listed as such. Cash stays constant.
- **Neutral:** BTC log return over H days ~ N(0, σ²H). Each asset's log return = β·R_BTC + ε, with ε ~ N(0, σε²H).
- **Sentiment line s:**
  - **Bands:** the current reading is placed in its signal's low / middle / high third. The cuts are the 1/3 and 2/3 quantiles of the signal's resolved history. Cuts are inclusive when they differ, so tied integer scores still split.
  - **Drift:** BTC drift becomes `shift = w · (mean forward return after readings in that third − mean after all readings)`.
  - **Shrinkage:** `w = n / (n + k)`, with k = 10 (PROPOSED, the same prior strength as the V2 forecast family). n counts independent windows in that third (distinct ⌊day / H⌋).
  - **Fallback:** fewer than 3 resolved pairs in the third, fewer than 9 overall, or a reading older than 36 h → shift 0, so the line equals Neutral.
- **Point-in-time:**
  - **Reading:** the last reading of each UTC day is paired with that day's close (the reading precedes the close) and the close H days later.
  - **Live as-of:** the live projection uses only pairs resolved by yesterday's close.
- **Simulation:** 4,000 draws with a fixed seed. Every line uses the same draws (common random numbers), so lines differ only by their drift. Each line reports P10, median and P90 of the total value.
- **Disagreement:** a flag when V1 and V2 sit in opposite thirds (low vs high).

## 4. Walk-forward test (on BTC)
For every past day with a resolved outcome:
1. Recompute the shift using only pairs resolved by that day, and σ from closes up to that day.
2. Score the line's P10/P50/P90 with the pinball loss.
3. Score Neutral on the same days the same way.

Reported per line and horizon:
- days scored
- independent windows
- days moved off Neutral
- P10–P90 coverage (line / Neutral)
- skill = 1 − loss(line) / loss(Neutral)

The test is pseudo-prospective. Its inputs are immutable time-stamped records and the method was fixed before the first result. It is not a substitute for a logged prospective record.

## 5. Pre-declared reading (fixed before the first result)
- **BETTER:** at least **30 independent windows** and **skill ≥ +2%**.
- **NO GAIN:** at least 30 independent windows, skill below +2%, and the line moved off Neutral at least once.
- **NOT YET:** fewer than 30 independent windows, or no history.
- No statement that sentiment improves the projection is made outside BETTER.

## 6. First result (2026-11-21, live data, illustrative portfolio)
| Line | Horizon | Days scored | Independent | Skill | Reading |
|---|---|---|---|---|---|
| V1 | 1 d | 85 | 85 | −1.4% | NO GAIN |
| V1 | 7 d | 79 | 12 | +0.5% | NOT YET (12 of 30) |
| V2 | 1 d | 6 | 6 | 0 | NOT YET |
| V2 / V2 research | 7 d | 0 | 0 | — | NOT YET |

Today V1 reads 28 (low third). Its 7-day line shifts the BTC drift by about −1.5%. V2 and V2 research have too little history, so they currently equal Neutral.

## 7. Limits
- **Short history:** V1 history in V2 starts 2026-08-27, V2 on 2026-11-14 and V2 research on 2026-11-21.
- **Downsampled V1 history:** the comparison endpoint caps at 500 points, so some days use a downsampled reading.
- **Simple market model:** constant volatility and one factor (BTC). No fat tails or regime change in the market model.
- **Assets without history:** an asset with no Hyperliquid history is held at today's price.
- **Not scored on the portfolio:** the walk-forward test scores BTC only. Portfolio results depend on holdings and are not scored.

## 8. Rollback
Revert the PR. The copy remains in the browser under its own key and can be deleted with site data. No backend change.
