# Project Improvement Manifest

Project: HOZO AM

This file records which shared improvement versions are installed in this project.

Do not copy production values from another project. Each project must use its own LINE, Notion, Render, and environment configuration.

| Version | Improvement | Status | Applied Date | Commit / Reference | Verification |
| --- | --- | --- | --- | --- | --- |
| `AM-IMP-2026.0608.01` | Project data isolation guard | Installed | 2026-06-07 | `398afb0` | Local health check passed; Notion write guard added. Render deploy still needs confirmation after sync. |
| `AM-IMP-2026.0608.02` | Scheduled report multi-recipient rule | Installed | 2026-06-07 | `c931893` | Local health check passed; Render deploy still needs confirmation after sync. |
| `AM-IMP-2026.0608.03` | LINE task-query reply command | Installed | 2026-06-07 | `38f4373` | Local health check passed; Render deploy still needs confirmation after sync. |
| `AM-IMP-2026.0608.04` | Cron report deployment verification | Installed | 2026-06-08 | AM_Core package + HOZO snapshot data source + `src/control-api.js` | HOZO daily report snapshot data source created; local env configured; syntax checks passed. Render env/deploy verification still pending. |
| `AM-IMP-2026.0608.05` | Improvement manifest and upgrade records | Installed | 2026-06-08 | Planning docs | This manifest exists. |
| `AM-IMP-2026.0608.06` | Event-conclusion daily report and follow-up task synthesis | Installed | 2026-06-08 | Local files + preview endpoint | `node --check` passed; local preview generated a HOZO AM daily event-conclusion report with `wouldSend: false`; Render deploy still pending. |
| `AM-IMP-2026.0608.07` | Five-slot goal recognition and confirmation workflow | Installed | 2026-06-08 | Local files + Notion schema update | `node --check` passed; HOZO AM Notion task fetch verified goal-recognition fields; Render deploy still pending. |
| `AM-IMP-2026.0608.08` | Hierarchical responsibility owner narrowing workflow | Installed | 2026-06-08 | Local files + Notion schema update | Created 3 HOZO AM data sources, seeded 5 group options / 10 known members / 7 responsibility rows; dry run and write sync passed; daily report preview includes responsibility reminders; Render deploy still pending. |
| `AM-IMP-2026.0608.09` | Immediate LINE command conversation mode | Installed | 2026-06-08 | AM_Core package + local `src/server.js` | Added immediate command parsing, recent task-list memory, ordinal task detail lookup, and high-risk command acknowledgement; Render deploy still pending. |
| `AM-IMP-2026.0608.10` | Notion database view layout registry | Installed | 2026-06-08 | AM_Core package + Notion view update | HOZO LINE group options Default view shows `總控專案`, `群組顯示名稱`, `LINE對話名稱`, `候選來源權責項目` in order; missing relation property was added project-locally. |
| `AM-IMP-2026.0608.11` | Report intervention action standard | Installed | 2026-06-08 | AM_Core package + `config/report-intervention-actions.json` + report confirmation UI | Canonical action registry copied; HOZO confirmation payload now preserves action keys in decision records; syntax and JSON checks passed. Render deploy still pending. |
| `AM-IMP-2026.0608.12` | Cron report reliability upgrade | Installed | 2026-06-08 | AM_Core package + local `scripts/render-cron-report.js` + `render.yaml` | Local syntax checks passed; Render Blueprint sync/deploy and next scheduled cron verification still pending. |
| `AM-IMP-2026.0608.13` | Judgment calibration knowledge base | Installed | 2026-06-08 | AM_Core package + HOZO local calibration data sources + `src/server.js` | Created HOZO-local calibration cases/rules data sources; review target lookup passed; LINE command mode added; syntax checks passed. Render deploy and live LINE command verification still pending. |
| `AM-IMP-2026.0608.14` | Meeting checkbox task standard | Installed | 2026-06-08 | AM_Core package + `scripts/sync-meeting-actions.js` | Meeting checkbox items now bypass action-keyword filtering and write confirmed task evidence; syntax checks passed. Render cron deploy verification still pending. |
| `AM-IMP-2026.0608.15` | Total-control task title hygiene | Installed | 2026-06-08 | AM_Core package + local `scripts/sync-line-message-judgements.js` + cleanup script | Existing task cleanup found 0 HOZO AM task titles containing Notion/LINE technical IDs; final cleanup scan matched 0. |
| `AM-IMP-2026.0608.16` | Project dossier and task relation architecture | Installed | 2026-06-08 | AM_Core package + HOZO AM Notion schema update | Added `總控專案` relation on HOZO AM task database and reciprocal `關聯任務` on project database; historical relation backfill remains project-local follow-up. |
| `AM-IMP-2026.0608.17` | Task dossier and subtask hierarchy architecture | Installed | 2026-06-08 | AM_Core package + HOZO AM Notion schema update | Added `母任務` / `子任務` self-relations on HOZO AM task database; historical parent-child task backfill remains project-local follow-up. |
| `AM-IMP-2026.0608.18` | Hourly LINE task reconciliation | Installed | 2026-06-08 | AM_Core package + `config/hourly-line-task-reconciliation.json` + `AGENTS.md` + `render.yaml` | HOZO hourly LINE judgement contract installed and cron defined for 08:10-22:10 Asia/Taipei; syntax and JSON checks passed. Render Blueprint sync/deploy still pending. |
| `AM-IMP-2026.0608.19` | Total-control task table source text hide rule | Installed | 2026-06-08 | AM_Core package + Notion view update | HOZO AM total-control task Default view does not display `來源原文`; the property remains available for audit fallback and existing values were not erased. |
| `AM-IMP-2026.0608.20` | SevenAM 08:00 Google Calendar agenda section | Blocked | 2026-06-08 | AM_Core package excluded target | This package is SevenAM-only and explicitly says HOZO AM should not install it. HOZO remains blocked/not applicable by package boundary. |
| `HOTFIX-2026.0610.01` | HOZO-AM morning brief data-source isolation | Installed | 2026-06-10 | `src/control-api.js` + `reports/morning-brief-prototype.html` | `/reports/morning-brief` now renders from HOZO task data only; local HTTP check returned 200 and no stale sample markers. |

## Project-Specific Values

Keep these values project-local:

| Area | HOZO AM Value Source |
| --- | --- |
| LINE channel | HOZO AM LINE Developers channel |
| Notion data sources | HOZO AM Notion databases only |
| Render service | HOZO AM Render service only |
| Report recipients | HOZO AM LINE conversation records |
| Secrets | `.env` locally and Render Environment in production |
