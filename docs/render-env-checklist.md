# HOZO AM Render Environment Checklist

Fill these values in Render. Sensitive values are intentionally not stored in this repository.

## Secrets

| Env var | Status |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Fill from LINE Developers |
| `LINE_CHANNEL_SECRET` | Fill from LINE Developers |
| `NOTION_TOKEN` | Fill from Notion integration |
| `SEVEN_CONTROL_API_KEY` | Generate a long random string |
| `SEVEN_REPORT_APPROVAL_KEY` | Optional, generate a long random string |
| `SEVEN_REPORT_TARGET_ID` | Fill owner LINE user target |

## Known Non-secret Values

| Env var | Value |
| --- | --- |
| `LINE_CHANNEL_ID` | `2009385650` |
| `NOTION_VERSION` | `2025-09-03` |
| `SEVEN_OUTGOING_ACTOR_NAME` | `HOZO Jr.` |
| `SEVEN_CODEX_COMMAND_TRIGGERS` | `HOZO Junior,HOZ Jr.,HOZO Jr.` |
| `SEVEN_CONVERSATIONS_DATA_SOURCE_ID` | `37451c686dac810c99b8f42b2fcb7cc0` |
| `SEVEN_MESSAGES_DATA_SOURCE_ID` | `37451c68-6dac-81d7-a555-db554602e76d` |
| `SEVEN_ATTACHMENTS_DATA_SOURCE_ID` | `37551c68-6dac-81b1-abb2-ca881b8791ed` |
| `SEVEN_REPORT_TARGET_TYPE` | `user` |
| `SEVEN_REPORT_TARGET_NAME_KEYWORD` | `Maggie` |
| `SEVEN_CRON_ALERTS_ENABLED` | `true` |

## Values To Add After New Notion Databases Are Created

| Env var | Database |
| --- | --- |
| `SEVEN_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID` | HOZO LINE 附件轉檔資料庫 |
| `SEVEN_CODEX_COMMANDS_DATA_SOURCE_ID` | HOZO Codex 指令佇列 |
| `SEVEN_MEETINGS_DATA_SOURCE_ID` | HOZO 會議紀錄 |
| `SEVEN_TASKS_DATA_SOURCE_ID` | HOZO 總控任務庫 |
| `SEVEN_PROGRESS_REPORTS_DATA_SOURCE_ID` | HOZO 專案進度報表庫 |
| `SEVEN_RISK_DECISIONS_DATA_SOURCE_ID` | HOZO 風險與決策庫 |
| `SEVEN_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` | HOZO Automation Run Log |

## Values To Replace After Render Service Is Created

Replace `<hozo-render-service>` with the real Render host:

```text
SEVEN_PUBLIC_BASE_URL=https://<hozo-render-service>.onrender.com
CONTROL_API_URL=https://<hozo-render-service>.onrender.com/control/reports/send
CONTROL_LINE_PUSH_URL=https://<hozo-render-service>.onrender.com/control/line/push
```
