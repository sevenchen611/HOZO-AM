# HOZO AM Operating Guide

This repository is the independent HOZO AM project. It must write only to HOZO AM databases unless the user explicitly asks for a migration or comparison.

**2026-06-12 parity upgrade**: the full SevenAM architecture (AM-IMP-2026.0611.01 and AM-IMP-2026.0612.01–.15) was ported to this project with HOZO naming, HOZO Notion data sources, and the HOZO Render service. The SevenAM repo's AGENTS.md describes the shared architecture in depth; this file records the HOZO-specific values and rules.

## System Goal

Build HOZO 好住寓好's control center for collecting LINE OA/group messages, customer messages, meeting records, and tasks into Notion, then producing daily morning and evening reports so the HOZO team can track project progress.

The system answers:

1. What is the current status of each HOZO project?
2. What should happen next, and who needs to be reminded?

## Business Context（公司與案場結構）

**Company**: 好住寓好股份有限公司 (abbreviation: **HOZO** or 好住寓好). Business: 包租代管 — currently mainly 包租 (master-lease/sublease). Note: the 寓 character is 公寓's 寓, never 遇/御.

There are currently **two cases（案場）** with standard names. Tenants, 工務（repair/engineering）and 房務（housekeeping）work all split across them:

1. **寓好草悟道** （備註：明義街 46 號）— e.g. tenant group 明義街46號2之2; 2F construction: electric meters, network, dryer/shelving.
2. **寓見櫻桃** （備註：櫻桃計畫，櫻桃/櫻花商務會館）— handed over from Debbie 2026-06-01; legacy contacts: Amber for finance, 信翰 for cleaning.

Tenant inquiries and issues will keep arriving for both sites separately. The total-control task database has a **案場 select property** with exactly these options: `寓好草悟道`, `寓見櫻桃`, `公司層級` (company-level / cross-site). When judging conversations and creating tasks, always identify which 案場 the matter belongs to, set the 案場 property, and use the standard site names (not the 備註 aliases) in task titles. The controlled project vocabulary stays functional — 房務管理, 工務維修管理, etc. — the 案場 dimension is carried by this property.

## Main Actors

- User / main owner: 陸昱晴, role 總經理. Maggie is the report keyword target.
- Codex: analyzes conversations, extracts tasks and risks, drafts reports, and updates system logic.
- HOZO Jr.: LINE OA that collects LINE conversations and sends reports.
- Render Webhook Server (`hozo-am-line-oa-webhook`): receives LINE webhook events, writes to Notion, exposes control APIs, serves dynamic report pages and the dashboard, and runs scheduled jobs.
- Notion: visible data layer for conversations, tasks, attachments, project status, risks, and decisions.

## Scope

Only include pages and databases under `HOZO 好住、寓好`.

Do not scan, summarize, or sync unrelated Notion pages, other workspace areas, private pages, or non-HOZO project databases. In particular, never use SevenAM / 7AM data sources, secrets, or LINE targets in this project.

## Default LINE Identity

When sending a direct LINE message to the main owner, the default target is the owner user target configured in `HOZO_REPORT_TARGET_ID`.

The controller-only command gate (calibration replies, 查待辦, report links, command acknowledgements) answers only the personal 1-on-1 chat of `HOZO_CONTROLLER_USER_ID` (falls back to `HOZO_REPORT_TARGET_ID`). Group commands are queued but get no reply.

Never print LINE tokens, Notion tokens, or control API keys back to the user.

## Command Triggers

Hardcoded trigger names after the parity upgrade: `HOZO Junior`, `HOZO Jr.`, `HOZ Jr.`, `HOZ Junior` (plus `HOZO_CODEX_COMMAND_TRIGGERS` env support in legacy paths). Immediate-command prefixes: `HOZO Junior` / `HOZOJunior` / `HOZO Jr.`.

Allowed direct replies: 早報/行程/報告 page links, 查待辦 task lists, 儀表板 dashboard link — controller-only.

## Architecture (2026-06-12 parity)

All features below are identical to SevenAM's implementation; see the SevenAM AGENTS.md for full behavioral rules.

1. **Durable Postgres event queue** (`src/event-queue.js`, Render database `hozoam-queue-db`): webhook events are queued before Notion writes; retry with backoff; dead events alert `HOZO_ALERT_TARGET_ID`. Without `DATABASE_URL` it falls back to synchronous writes. **The Render free Postgres plan expires after 30 days — upgrade to a paid plan for production.**
2. **LLM task extraction** (`scripts/llm-task-extraction.js`, hourly): judges conversation timelines with the shared hierarchy prompt + controlled project vocabulary from `HOZO 總控專案庫`; falls back to the legacy rule engine without `ANTHROPIC_API_KEY`. Prompt hardening, calibration-rule injection, confidence stats, and borderline sampling all active. Borderline review IDs use `HOZO-BL-*`.
3. **Codex command triage** (`scripts/llm-codex-command-triage.js`, every 15 min): answers analysis commands, marks sensitive ones Needs Confirmation.
4. **Calibration feedback loop** (`scripts/sync-extraction-feedback.js`, 22:45): harvests user verdicts into the calibration case database (`HOZO-FB-*`), proposes rules (Needs review — the user must flip Status to Active), injects Active `HOZO_AM` rules into extraction. Eval harness: `npm run eval:extraction`.
5. **Attachment parsing** (`scripts/parse-attachments.js`, every 15 min): images/PDF/Office ≤5MB auto-parse; oversize and private-conversation images need approval in the review page.
6. **Dynamic report pages** (`/reports/daily-control-report`, `/reports/followup-confirmation?slot=10|13|17`): six sections (verdicts, waiting-reply chase with send/schedule/snooze, in-progress notes, unclassified project assignment, attachment approval, project proposals). Approval key storage: `hozo-approval-key`.
7. **Project governance**: controlled vocabulary from `HOZO 總控專案庫`; proposal engine (`scripts/propose-projects.js`, 22:20) creates 狀態=候選 candidates for approval in report section six.
8. **Drill-down dashboard** (`/dashboard`, Basic auth via `HOZO_USER_UI_USERNAME`/`HOZO_USER_UI_PASSWORD`): overview → project → task with inline source conversation and media; move-project, parent/child, full edit panel; LINE command 儀表板.
9. **Planned messages and Next Action scheduling**: six task properties (預定訊息內容/預定發送對象/預定發送對象ID/下次行動時間/下次行動模式/下次行動說明), dashboard panel with recipient search, `POST /control/tasks/send-planned`, report-page scheduled sends, and `scripts/run-scheduled-actions.js` (every 15 min) firing auto-sends or controller reminders (dead-man-switch semantics; one-shot).
10. **Codex-only worker** (`scripts/local-worker.js`) — **HOZO runs in OpenAI-Codex-only mode (2026-06-12 A/B test)**: ALL AI work runs on the 24/7 local machine via the **OpenAI Codex CLI** (`codex exec`, ChatGPT subscription quota, `LLM_BACKEND=codex`). There are NO LLM crons on Render and `ANTHROPIC_API_KEY` is intentionally not set. The worker handles: extraction + command triage every ~90s, Next Action scheduled-actions every 15 min, project proposals nightly ≥22:20, extraction feedback sync nightly ≥22:45 (rule suggestions need an Anthropic key and are skipped; feedback collection still runs). Startup entry: `HOZO-AM-Local-Worker.cmd` in the Windows Startup folder. **No Render fallback exists** — if the worker machine dies, HOZO AI judgment stops until it is restarted. This contrasts with SevenAM (Claude: Anthropic API on Render + Claude Code worker) for an engine quality/cost comparison.
    - The `codex` backend lives in `src/llm-backend.js` (`runCodex`: prompt via stdin, final message via `-o` temp file, `--sandbox read-only --skip-git-repo-check`, OPENAI_API_KEY stripped from the child env to force subscription auth). Auth: `codex login` (ChatGPT account) on the worker machine; worker self-test verifies it at startup. Optional `CODEX_MODEL` env overrides the model. Backend override: `HOZO_WORKER_LLM_BACKEND` (codex | claude-code).
    - Attachment parsing is disabled in this mode (it requires the Anthropic API for vision/document parsing); attachments stay queued as 待轉檔.
11. **Cron failure alerts**: all sync crons run through `scripts/run-cron-with-alert.js` (project prefix `HOZO`).

## System Operating Hours

Taipei 07:00–23:00 work, 23:00–07:00 rest. The 15-minute crons (triage, attachments, scheduled actions) are restricted to UTC `0-14,23`; the local worker (if installed) uses `HOZO_WORKER_ACTIVE_HOUR_START`/`HOZO_WORKER_ACTIVE_HOUR_END` (default 7/23). Overnight-due scheduled actions fire on the first morning scan.

## Scheduled Jobs — ALL on the local worker (no Render crons)

**Render hosts only the web service** (`hozo-am-line-oa-webhook`: webhook intake, report pages, dashboard, control API). Every scheduled job runs inside the local worker (Taipei times, active hours 07:00-23:00):

| Job | Schedule | Notes |
| --- | --- | --- |
| Task extraction + command triage | every ~90s cycle | OpenAI Codex backend |
| Next Action scheduled actions | every 15 min | no LLM |
| Meeting action sync | hourly | no LLM |
| Responsibility candidate sync | hourly | no LLM |
| Morning brief | 08:30 (+30 min grace) | calls `POST /control/reports/send` on Render |
| Follow-up reports | 10:00 / 13:00 / 17:00 (+30 min grace) | same |
| Daily control report | 20:30 (+30 min grace) | same |
| Project proposals | nightly ≥22:20 | Codex backend |
| Extraction feedback sync | nightly ≥22:45 | collection only without API key |

Reports missed beyond their 30-minute grace window (worker down) are skipped, not back-filled. The Postgres event queue is also omitted in test mode (workspace resource cap); the webhook writes Notion synchronously.

## HOZO Notion Data Sources

Configured through `HOZO_*` env vars (values in `.env` locally and Render Environment in production): conversations, messages, attachments, attachment conversions, codex commands, meetings, tasks, projects, progress reports, risk decisions, automation run log, responsibility, LINE group options/members/member index, daily report snapshots, judgment calibration cases, judgment rules.

Rules:

- Raw LINE records must be stored before interpretation.
- Tasks are official only after confirmation unless high-confidence and low-risk.
- Finance, contracts, legal, tax, HR, or external commitment items require confirmation.
- General LINE messages should not trigger automatic replies.
- The progress-report property `需要 Seven 決策` is a legacy shared schema name — do not rename it without migrating the Notion database.

## Sensitive Data Rules

- Do not commit `.env`, `env.txt`, LINE tokens, Notion tokens, or control API keys.
- Confirm existence/format only; never echo secret values.
- Render environment variables are the deployment source of truth for secrets.

## Deployment

- GitHub repo: `sevenchen611/HOZO-AM` (this folder is a git repo — use normal git commit/push).
- Render auto-deploys the web service on push; render.yaml Blueprint changes (new crons, the Postgres database) require a Blueprint sync confirmation in the Render dashboard.
- Required new Render env (set on the web service): `HOZO_USER_UI_USERNAME`, `HOZO_USER_UI_PASSWORD`, `HOZO_ALERT_TARGET_ID` (optional), `HOZO_CONTROLLER_USER_ID` (optional, falls back to `HOZO_REPORT_TARGET_ID`), `DATABASE_URL` (auto-wired from `hozoam-queue-db` by Blueprint). `ANTHROPIC_API_KEY` is intentionally NOT set — Codex-only mode.
