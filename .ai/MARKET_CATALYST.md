# CryptoPulseV2 — Market Catalyst Attribution

## Objective

Determine why significant crypto price movements occurred.

This is an analytical layer, not a prediction feature initially.

---

# Core Question

For every significant resolved prediction:

"What happened in the market, and was the cause knowable when the prediction was made?"

---

# Market Classification

Classify events as:

MARKET_WIDE
SECTOR_SPECIFIC
ASSET_SPECIFIC
NO_CLEAR_CATALYST

---

# Catalyst Categories

MACRO
FED_RATES
INFLATION
EMPLOYMENT
USD
ETF_FLOWS
REGULATION
EXCHANGE
STABLECOIN
LIQUIDATION
LEVERAGE
TECHNICAL
ON_CHAIN
GEOPOLITICAL
SECURITY
PROTOCOL
OTHER

---

# Catalyst Record

Store:

- event_id
- event_timestamp
- discovery_timestamp
- asset
- category
- direction
- magnitude
- description
- source
- source_url
- confidence
- available_before_prediction

---

# Timestamp Integrity

This is mandatory.

For prediction:

T0 = prediction timestamp

For catalyst:

T1 = catalyst publication/event timestamp

If:

T1 <= T0

then:

available_before_prediction = true

Otherwise:

available_before_prediction = false

Do not use information published after T0 to explain why the model should have predicted the event.

---

# Market-Wide Detection

Compare the asset move against:

- BTC
- ETH
- major crypto index if available
- relevant sector assets

Example:

BTC -5%
ETH -6%
SOL -8%
LINK -7%

Likely:

MARKET_WIDE

Example:

BTC -5%
ETH +1%
SOL +2%

Potentially:

ASSET_SPECIFIC

---

# Catalyst Confidence

Use:

HIGH
MEDIUM
LOW

Never force a catalyst attribution when evidence is weak.

"NO_CLEAR_CATALYST" is a valid result.

---

# Learning Use

Catalyst attribution must initially be analytical only.

Do not directly feed LLM-generated catalyst labels into the prediction model.

After sufficient historical evidence exists, investigate whether catalyst categories systematically correspond to model errors.

Possible future experiments:

- event-risk regime
- macro-event confidence reduction
- volatility-event detection
- catalyst-aware model selection

These must be experiments, not automatic production changes.

---

# Market Analysis Report

For each major event report:

1. What happened?
2. Which assets moved?
3. How large was the move?
4. What was the likely catalyst?
5. When did the catalyst become public?
6. Was it known before the prediction?
7. Did the model have any observable warning?
8. Did similar historical situations exist?
9. Did the model systematically fail under similar conditions?
10. Should this become a future experiment?
