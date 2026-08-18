# CryptoPulseV2 — Claude / ChatGPT Collaboration Protocol

## Purpose

Define how Claude and ChatGPT collaborate during continuous development.

---

# Claude's Role

Claude is responsible for implementation.

Claude receives experiment specifications from ChatGPT and:

1. Understands the hypothesis.
2. Inspects the existing implementation.
3. Implements the smallest appropriate change.
4. Adds tests.
5. Runs regression tests.
6. Runs backtests.
7. Runs out-of-sample validation.
8. Reports quantitative results.
9. Creates a GitHub branch.
10. Creates a Pull Request.
11. Documents the result.

Claude must not assume that an experiment should improve Production.

Experiments are allowed to fail.

---

# ChatGPT's Role

ChatGPT independently reviews:

- historical predictions
- realized outcomes
- model performance
- calibration
- model variants
- market context
- market catalysts
- model failures
- statistical validity

ChatGPT creates experiment proposals only when evidence justifies them.

---

# Required Experiment Flow

ChatGPT:

OBSERVATION
    |
    v
HYPOTHESIS
    |
    v
EXPERIMENT SPECIFICATION
    |
    v
Claude implementation
    |
    v
Tests
    |
    v
Backtest
    |
    v
Out-of-sample validation
    |
    v
Claude result
    |
    v
ChatGPT independent review
    |
    +---- FAIL --> document rejection
    |
    +---- PASS --> human review
                       |
                       v
                   promotion

---

# Experiment Communication

Every experiment must have a unique ID.

Example:

EXP-001
EXP-002
EXP-003

Experiment specifications must be stored in:

/learning/experiments/

Implementation tasks for Claude must be stored in:

/learning/claude_tasks/

Results must be stored in:

/learning/results/

---

# ChatGPT Output Contract

ChatGPT experiment proposals should contain:

## Observation

What happened?

## Evidence

What data supports the observation?

## Hypothesis

What might explain it?

## Proposed Experiment

What should Claude change?

## Control

What is the current Production baseline?

## Metrics

What should be measured?

## Acceptance Criteria

What constitutes success?

## Failure Criteria

What constitutes rejection?

## Leakage Requirements

What must be verified?

---

# Claude Result Contract

Claude must report:

- experiment ID
- commit SHA
- files changed
- tests added
- tests passed
- backtest period
- validation period
- sample sizes
- Production metrics
- Challenger metrics
- out-of-sample metrics
- known limitations
- leakage assessment
- final recommendation

Claude must never report an experiment as successful solely because accuracy improved.

---

# Promotion Rule

A model change may only be considered for Production after:

1. Tests pass.
2. No known data leakage exists.
3. Sample size is sufficient.
4. Out-of-sample performance is evaluated.
5. Relevant metrics improve or remain acceptable.
6. No severe regression exists.
7. The experiment is reviewed.
8. Human owner approves promotion.
