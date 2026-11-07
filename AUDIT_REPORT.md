# CryptoPulseV2 Repository Audit

**Scope:** Read-only inspection of the local `CryptoPulseV2` checkout on branch `codex/initial-audit`. The working tree was clean at inspection time. No files were changed, no tests or deployment commands were run, and no production infrastructure, credentials, or databases were accessed.

**Evidence labels:**

- **Verified:** Directly observed in this repository.
- **Documented, not independently verified:** Stated by repository documentation, but the implementation or external resource is not included in this checkout.
- **Inference:** A technical assessment based on the inspected repository structure and code.

## 1. Architecture

### Verified

- The repository is a static website with a Progressive Web App manifest and icon assets: `index.html`, `manifest.json`, and `assets/`.
- Most application code is in one large file, `index.html` (approximately 220 KB): page markup, inline styles, and inline JavaScript are combined there.
- The page has dashboard, lab, experiments, and history views, with coin and prediction-horizon selection. The navigation and view markup are in `index.html`; its JavaScript handles state, rendering, and API calls.
- There is no frontend package manifest, local build configuration, or backend source in this checkout.
- `.github/workflows/deploy.yml` deploys the repository contents to GitHub Pages on pushes to `main` and on manual dispatch. It has no build or test step.
- The `.ai/` directory contains architecture, data-contract, daily-audit, experiment-protocol, and implementation-plan documents. These include both requirements and planned capabilities, so the documents alone do not prove that a feature is implemented.

### Documented, not independently verified

- `README.md` describes the frontend as a standalone GitHub Pages app and the backend as a separate Cloudflare Worker named `PulseWorkerV2`.
- The README says the V2 Worker shares a Cloudflare D1 database with the original Worker.
- `.ai/ARCHITECTURE.md` describes a target learning system with prediction logging, outcome resolution, daily analysis, catalyst evidence, experiments, and human approval before production promotion. The backend implementation is absent from this repository, so the audit cannot confirm which of those components are operational.

## 2. Frontend and API Dependencies

### Verified

- `index.html` loads external frontend dependencies:
  - Google Fonts: Inter and JetBrains Mono.
  - Material Symbols from Google Fonts.
  - Tailwind CSS from `https://cdn.tailwindcss.com`.
  - Chart.js 4.4.4 and the Chart.js date adapter from jsDelivr.
- The frontend hard-codes the Worker base URL as `https://pulseworker-v2.quiquandon.workers.dev` in `index.html` near line 703.
- The `COIN_CONFIG` object near lines 716–739 maps BTC, LINK, and ETH to coin-specific prediction, calibration, chart, and analysis routes.
- The frontend calls Worker endpoints for predictions, calibration, charts, prediction freshness, backtest history, challenger history and calibration, model selection, learning reports, experiment registry data, and analyst relay. Examples visible in the source include:
  - Prediction and calibration requests around lines 808–900.
  - Chart and freshness requests around lines 1281–1317.
  - Backtest and challenger requests around lines 1592–1736.
  - Learning report requests around lines 2423–2450.
  - Analyst relay requests around lines 2802–2859.
- The analyst relay submit path posts JSON to `/analyst-relay/submit` from the browser; it includes user-pasted response text.
- There is no local dependency manifest or frontend build setup in the repository.

### Inference

- Because the frontend depends on CDNs at runtime, network availability and third-party asset delivery affect page functionality and appearance.
- Tailwind’s CDN URL is not version-pinned in the HTML, so its behavior may change independently of this repository.
- Since the Worker base URL and endpoint paths are embedded in the page, switching between development, staging, and production API environments likely requires editing the application source.

## 3. Data Flow

### Verified

- Browser-side JavaScript calls the Worker using `fetch()` and renders returned JSON into the page.
- Prediction requests use the selected coin and horizon, then display the returned probability, analog information, and model-selection information when available.
- Chart requests provide prices and logged predictions for visualisation. Chart.js renders the chart in the browser.
- Separate API calls load calibration and evidence, freshness information, backtest results, challenger results, learning reports, selection history, and experiment registry information.
- The analyst relay fetches a prompt from the Worker, lets the user paste an analyst response, and submits that response to the Worker.
- The `.ai/ARCHITECTURE.md` dashboard contract says dashboard metrics should be served by the Worker/API rather than independently recomputed in the browser. It also labels part of the described learning API as planned or not yet implemented in that document.

### Documented, not independently verified

- `README.md` says the Worker accesses D1 for prediction and market-history data and that some market-history routes are shared with the original system.
- `.ai/DATA_CONTRACT.md` specifies an intended prediction record with prediction-time features and metadata, plus a separate outcome record. This checkout contains no Worker code or schema to establish whether those requirements are met.
- The data flow beyond the browser-to-Worker boundary cannot be verified from this repository.

## 4. Database Dependencies

### Verified

- There is no database client, D1 binding configuration, schema, migration, or database source code in this checkout.
- The frontend communicates with the backend via HTTP endpoints; it does not connect directly to a database.
- The repository has no local database tests or database setup scripts.

### Documented, not independently verified

- `README.md` states that `PulseWorkerV2` uses the Cloudflare D1 database named `sentiment-history`, shared with the original Worker, and stores V2-related records alongside existing data.
- `.ai/DATA_CONTRACT.md` describes intended prediction, feature-snapshot, neighbor-snapshot, data-quality, and outcome fields. It also lists historical tables that the implementation is expected to preserve.
- No claim about the actual database schema, access controls, migration history, retention, or operational state can be confirmed from this repository alone.

## 5. Existing Tests

### Verified

- No test files or test directories were found in the repository file listing.
- No `package.json`, test-runner configuration, frontend build configuration, or Worker test setup is present.
- `.github/workflows/deploy.yml` checks out the repository and deploys it to GitHub Pages; it does not run tests or a build.

### Documented, not independently verified

- `.ai/IMPLEMENTATION_PLAN.md` specifies tests that should be added for prediction snapshots, outcome resolution, metrics, catalyst timestamps, leakage protection, API output, and experiment lifecycle. Those are plan requirements, not evidence of existing tests.

## 6. Technical Risks

Severity indicates the potential impact if the risk is present; it is not evidence that a production failure has occurred.

| Severity | Risk | Evidence and impact |
|---|---|---|
| **High** | Backend and database behavior are not reviewable in this checkout. | The frontend depends on a remote Worker, but its implementation and D1 schema are absent. Authentication, endpoint authorization, write behavior, CORS, input validation, database migrations, and outcome-resolution integrity therefore remain unverified. |
| **High** | Prediction integrity and leakage protections cannot be established from the frontend repository. | The `.ai/` documents specify timestamped snapshots and leakage checks, but this checkout does not include the model, calibration, selection, or outcome-resolution implementation needed to verify those guarantees. |
| **High** | Analyst relay is a browser-accessible write path whose server-side controls are out of scope here. | `index.html` submits pasted analyst output to `/analyst-relay/submit` around lines 2859–2862. The frontend shows that data is submitted but cannot establish whether the Worker authenticates, validates, rate-limits, or safely stores it. |
| **Medium** | Frontend and backend API contracts can drift. | Endpoint paths and assumed response fields are encoded in a large inline script. There is no shared schema, generated client, or contract test in this repository. A Worker response change could break rendering or show incomplete data. |
| **Medium** | A single large HTML file increases maintenance and review difficulty. | Markup, styles, state management, network calls, and rendering are combined in `index.html`. Changes to one feature can be harder to isolate, test, or review. |
| **Medium** | Runtime dependencies rely on external CDNs. | Tailwind, Chart.js, date-fns adapter, fonts, and icons are fetched remotely. Availability, policy changes, or supply-chain changes can affect the site. Tailwind’s CDN URL is not version-pinned. |
| **Medium** | Deployment has no automated validation gate. | The Pages workflow deploys repository contents without a build or test step. HTML/JavaScript errors or broken API assumptions may reach the published site without being caught by CI. |
| **Low** | API environment configuration is hard-coded. | The Worker URL is declared in `index.html`. This makes alternate environments and local development less convenient and can increase the chance of deploying a frontend pointed at the wrong API. |
| **Low** | Documentation may be mistaken for implemented functionality. | `.ai/` contains target architecture and implementation plans, and some passages explicitly call features planned or unwired. Readers should verify claims against the separate Worker implementation before treating them as operational. |

## 7. Prioritised Recommendations

1. **High priority — Audit the separate `PulseWorkerV2` implementation before relying on backend or database guarantees.** Review route-level authorization, CORS, validation, rate limiting, D1 bindings, schema and migrations, scheduled jobs, prediction logging, resolution, calibration, and model selection. This is a follow-up repository review; no external infrastructure needs to be accessed to inspect source code if that repository is made available locally.
2. **High priority — Verify prediction-time integrity and leakage protections in backend code.** Confirm that prediction records preserve the features and model metadata available at prediction time, outcomes are stored separately, timestamps are ordered correctly, and calibration/selection cannot use future outcomes.
3. **High priority — Review the analyst relay write endpoint.** Confirm server-side input validation, request-size limits, authentication or abuse controls appropriate to its intended use, safe persistence, and output encoding. The frontend alone cannot establish these controls.
4. **Medium priority — Add automated CI validation before Pages deployment.** Add appropriate static checks and tests for the frontend and, where applicable, backend. Make deployment depend on those checks passing.
5. **Medium priority — Define and validate API contracts.** Document request/response schemas for the routes used by the frontend and add contract checks so Worker changes cannot silently break the dashboard.
6. **Medium priority — Break the frontend into maintainable modules.** Separate API access, state management, view rendering, and static markup; introduce a reproducible build only if it improves validation and maintainability.
7. **Medium priority — Reduce unpinned runtime dependencies.** Pin external dependency versions or bundle dependencies locally where practical, including Tailwind, and consider a Content Security Policy compatible with the chosen asset strategy.
8. **Low priority — Move the Worker URL into deployment configuration.** Use an explicit configuration mechanism for environment-specific API roots and verify that the published Pages site targets the intended Worker.
9. **Low priority — Keep documentation status explicit.** Mark each major `.ai/` architecture item as implemented, partial, or planned, and link those claims to the relevant backend routes, schema, and tests when that code is available.

**Audit conclusion:** This checkout verifies a static GitHub Pages frontend with inline application code and a separately hosted Worker dependency. It does not include the Worker or database implementation, so backend security, D1 schema, model behavior, prediction integrity, and the operational status of planned learning features require a separate source-code audit.
