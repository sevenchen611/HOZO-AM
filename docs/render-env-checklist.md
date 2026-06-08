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
| `HOZO_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID` | `4ce26dc1-0b90-49ad-8e96-73f3a8f23a1f` |
| `HOZO_CODEX_COMMANDS_DATA_SOURCE_ID` | `6a500d4c-43ae-4523-bd76-c19a80697bb3` |
| `HOZO_MEETINGS_DATA_SOURCE_ID` | `fd351c68-6dac-8298-8f0e-87ab1eb6027c` |
| `HOZO_TASKS_DATA_SOURCE_ID` | `9c9e34ff-45af-4543-a3ae-11c5cd432b36` |
| `HOZO_PROGRESS_REPORTS_DATA_SOURCE_ID` | `add70895-645c-4268-9763-3e4bcb2b5b95` |
| `HOZO_RISK_DECISIONS_DATA_SOURCE_ID` | `1f6ef6e0-3f5f-49fb-8b80-add787898d7d` |
| `HOZO_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` | `5f7a870d-5a34-44a2-b1c8-a17171b6353a` |
| `HOZO_REPORT_TARGET_TYPE` | `user` |
| `HOZO_REPORT_TARGET_NAME_KEYWORD` | `Maggie` |
| `HOZO_CRON_ALERTS_ENABLED` | `true` |

## Values Still Filled Manually

| Env var | Database |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers secret |
| `LINE_CHANNEL_SECRET` | LINE Developers secret |
| `NOTION_TOKEN` | Notion integration secret |
| `HOZO_CONTROL_API_KEY` | Control API secret |
| `HOZO_REPORT_TARGET_ID` | Owner LINE user target |

## Render Service URLs

Use the current HOZO AM Render host:

```text
HOZO_PUBLIC_BASE_URL=https://hozo-am-line-oa-webhook.onrender.com
CONTROL_API_URL=https://hozo-am-line-oa-webhook.onrender.com/control/reports/send
CONTROL_LINE_PUSH_URL=https://hozo-am-line-oa-webhook.onrender.com/control/line/push
```

