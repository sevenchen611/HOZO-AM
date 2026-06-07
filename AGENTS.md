# HOZO AM Operating Guide

This repository is the independent HOZO AM project. It must write only to HOZO AM databases unless the user explicitly asks for a migration or comparison.

## System Goal

Build HOZO 好住寓好's control center for collecting LINE OA/group messages, customer messages, meeting records, and tasks into Notion, then producing daily morning and evening reports so the HOZO team can track project progress.

The system answers:

1. What is the current status of each HOZO project?
2. What should happen next, and who needs to be reminded?

## Main Actors

- User / main owner: 陸昱晴, role 總經理.
- Codex: analyzes conversations, extracts tasks and risks, drafts reports, and updates system logic.
- HOZO Jr.: LINE OA that collects LINE conversations and sends reports.
- Render Webhook Server: receives LINE webhook events, writes to Notion, exposes control APIs, and runs scheduled jobs.
- Notion: visible data layer for conversations, tasks, attachments, project status, risks, and decisions.

## Scope

Only include pages and databases under `HOZO 總控中心`.

Do not scan, summarize, or sync unrelated Notion pages, other workspace areas, private pages, or non-HOZO project databases.

Existing LINE CRM databases under the HOZO LINE page are allowed:

- HOZO LINE 對話主檔
- HOZO LINE 訊息紀錄
- HOZO LINE 附件紀錄

The existing HOZO meeting database should not be reused for this automation. Create a new HOZO AM meeting records database for this project.

## Default LINE Identity

When sending a direct LINE message to the main owner, the default target is the owner user target configured in `HOZO_REPORT_TARGET_ID`.

Target type:

```text
user
```

Never print LINE tokens, Notion tokens, or control API keys back to the user.

## Initial Projects

- 招租管理, owner Maggie
- 網頁設計, owner Maggie
- 後臺設計製作, owner Seven

Known LINE group:

- HOZO公司群, project 後臺設計製作

## Notion Data Layers

Use `{專案名稱} + 資料層名稱`; for this project the prefix is `HOZO`.

Required or planned databases:

- HOZO LINE 對話主檔
- HOZO LINE 訊息紀錄
- HOZO LINE 附件紀錄
- HOZO LINE 附件轉檔資料庫
- HOZO Codex 指令佇列
- HOZO 總控專案庫
- HOZO 總控任務庫
- HOZO 會議紀錄
- HOZO 專案進度報表庫
- HOZO 風險與決策庫
- HOZO Automation Run Log
- HOZO 通知候選佇列

Rules:

- Raw LINE records must be stored before interpretation.
- Tasks are official only after confirmation unless high-confidence and low-risk.
- Finance, contracts, legal, tax, HR, or external commitment items require confirmation.
- General LINE messages should not trigger automatic replies.

## Command Triggers

Configured through:

```text
HOZO_CODEX_COMMAND_TRIGGERS=HOZO Junior,HOZ Jr.,HOZO Jr.
```

Render should still store the raw LINE message first. Queue creation failure must not block normal LINE storage.

## Scheduled Reports

Render Cron uses UTC. Taipei time is UTC+8.

| Job | Taipei Time | UTC Cron |
| --- | --- | --- |
| Meeting action sync | 08:00-22:00 hourly | `0 0-14 * * *` |
| Morning brief | 08:00 | `0 0 * * *` |
| Follow-up morning | 10:00 | `0 2 * * *` |
| Follow-up midday | 13:00 | `0 5 * * *` |
| Follow-up afternoon | 17:00 | `0 9 * * *` |
| Daily report | 20:30 | `30 12 * * *` |

## Sensitive Data Rules

- Do not commit `.env`, `env.txt`, LINE tokens, Notion tokens, or control API keys.
- Confirm existence/format only; never echo secret values.
- Render environment variables are the deployment source of truth for secrets.

