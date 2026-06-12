# UPGRADE-2026-06-12-SEVENAM-PARITY

Project: HOZO AM

Versions installed in this bulk sync: `AM-IMP-2026.0611.01`, `AM-IMP-2026.0612.01` – `AM-IMP-2026.0612.15`

## Summary

Full parity upgrade: the complete SevenAM architecture as of 2026-06-12 was ported to HOZO AM with HOZO naming, HOZO Notion data sources, and the HOZO Render service. HOZO AM now has the durable Postgres event queue, LLM task extraction with calibration loop and trustworthiness instruments, command triage, attachment parsing, dynamic report pages, project governance and proposals, the drill-down dashboard with editing surface, planned messages with Next Action scheduling, dual-mode worker support, cron failure alerts, the controller-only command gate, and system operating hours (Taipei 07:00-23:00).

## Method

- Mechanical port via `migrate-from-sevenam.mjs` (kept outside the repo): 45 files copied from SevenAM with ordered replacements — env prefix `SEVEN_`→`HOZO_`, headers `x-seven-`→`x-hozo-`, actor `Seven Jr.`→`HOZO Jr.`, cron prefix `seven-jr-`→`hozo-am-`, Render URL, LINE channel id, queue DB names, all 18 hardcoded Notion data source IDs mapped to HOZO values, command triggers, isolation-guard title regexes, review-ID prefixes (`HOZO-JC/FB/BL-*`).
- 22 targeted fixes afterwards (controller gate falls back to `HOZO_REPORT_TARGET_ID` with no hardcoded LINE id, report URL defaults, AM_PROJECT_ENV_PREFIX resolution `HOZO`, keyword fallbacks `Maggie`, trigger alias lists, approval key storage name).
- Kept HOZO-divergent one-off tools untouched: `rebuild-task-candidates-from-conversations.js`, `build-user-ui-connected-preview.js`, `archive-all-tasks` equivalents, `config/automation-run-log.json`, `config/thread-first-hourly-task-judgement.json`.
- package.json rebuilt with SevenAM scripts + dependencies (@anthropic-ai/sdk, jszip, mammoth, pg, xlsx).
- Notion property name `需要 Seven 決策` retained (legacy shared schema in the HOZO progress DB).

## Data Isolation Check

All data source defaults now point to HOZO IDs; no SevenAM IDs, secrets, URLs, or LINE targets remain in code (verified by residual grep). HOZO `.env` untouched except appended placeholder keys for new features.

## Verification

- `node --check` passed on all 36 ported JS files; config JSON parse OK.
- `run-scheduled-actions.js --dry-run` succeeded against HOZO Notion (new task properties auto-created).
- Local boot test on :3003: `/control/health` lists `send-planned`; `/reports/daily-control-report` renders dynamic sections with schedule options from live HOZO data.
- Render deployment verification pending (see Status).

## Status

Installed locally and pushed to `sevenchen611/HOZO-AM` (2026-06-12). Render deployment pending: Blueprint sync must create `hozoam-queue-db` + 5 new crons and update 15-min cron schedules; `ANTHROPIC_API_KEY`, `HOZO_USER_UI_USERNAME/PASSWORD`, and optional `HOZO_ALERT_TARGET_ID`/`HOZO_CONTROLLER_USER_ID` must be set on the web service.
