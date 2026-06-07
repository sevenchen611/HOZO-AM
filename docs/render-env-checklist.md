# HOZO AM Render Environment Checklist

Fill these values in Render. Sensitive values are intentionally not stored in this repository.

## Secrets

| Env var | Status |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Fill from LINE Developers |
| `LINE_CHANNEL_SECRET` | Fill from LINE Developers |
| `NOTION_TOKEN` | Fill from Notion integration |
| `HOZO_CONTROL_API_KEY` | Generate a long random string |
| `HOZO_REPORT_APPROVAL_KEY` | Optional, generate a long random string |
| `HOZO_REPORT_TARGET_ID` | Fill owner LINE user target |

## Known Non-secret Values

| Env var | Value |
| --- | --- |
| `LINE_CHANNEL_ID` | `2009385650` |
| `NOTION_VERSION` | `2025-09-03` |
| `HOZO_OUTGOING_ACTOR_NAME` | `HOZO Jr.` |
| `HOZO_CODEX_COMMAND_TRIGGERS` | `HOZO Junior,HOZ Jr.,HOZO Jr.` |
| `HOZO_CONVERSATIONS_DATA_SOURCE_ID` | `37451c68-6dac-8163-b4fa-000b17271536` |
| `HOZO_MESSAGES_DATA_SOURCE_ID` | `37451c68-6dac-8187-a6bc-000bbd69c364` |
| `HOZO_ATTACHMENTS_DATA_SOURCE_ID` | `37551c68-6dac-81bb-97de-000bebacea77` |
| `HOZO_REPORT_TARGET_TYPE` | `user` |
| `HOZO_REPORT_TARGET_NAME_KEYWORD` | `Maggie` |
| `HOZO_CRON_ALERTS_ENABLED` | `true` |

## Values To Add After New Notion Databases Are Created

| Env var | Database |
| --- | --- |
| `HOZO_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID` | HOZO LINE 附件轉檔資料庫 |
| `HOZO_CODEX_COMMANDS_DATA_SOURCE_ID` | HOZO Codex 指令佇列 |
| `HOZO_MEETINGS_DATA_SOURCE_ID` | HOZO 會議紀錄 |
| `HOZO_TASKS_DATA_SOURCE_ID` | HOZO 總控任務庫 |
| `HOZO_PROGRESS_REPORTS_DATA_SOURCE_ID` | HOZO 專案進度報表庫 |
| `HOZO_RISK_DECISIONS_DATA_SOURCE_ID` | HOZO 風險與決策庫 |
| `HOZO_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` | HOZO Automation Run Log |

## Render Service URLs

Use the current HOZO AM Render host:

```text
HOZO_PUBLIC_BASE_URL=https://hozo-am-line-oa-webhook.onrender.com
CONTROL_API_URL=https://hozo-am-line-oa-webhook.onrender.com/control/reports/send
CONTROL_LINE_PUSH_URL=https://hozo-am-line-oa-webhook.onrender.com/control/line/push
```

