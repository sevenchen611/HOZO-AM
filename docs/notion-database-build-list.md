# HOZO AM Notion Database Build List

Create the following databases under `HOZO 總控中心`. Existing LINE CRM databases can be reused where already configured.

## Reuse Existing

| Database | Status | Render env |
| --- | --- | --- |
| HOZO LINE 對話主檔 | Existing | `SEVEN_CONVERSATIONS_DATA_SOURCE_ID` |
| HOZO LINE 訊息紀錄 | Existing | `SEVEN_MESSAGES_DATA_SOURCE_ID` |
| HOZO LINE 附件紀錄 | Existing | `SEVEN_ATTACHMENTS_DATA_SOURCE_ID` |

## Create New

| Database | Purpose | Render env |
| --- | --- | --- |
| HOZO LINE 附件轉檔資料庫 | OCR / parsing queue for confirmed attachments | `SEVEN_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID` |
| HOZO Codex 指令佇列 | LINE-triggered Codex command queue | `SEVEN_CODEX_COMMANDS_DATA_SOURCE_ID` |
| HOZO 總控專案庫 | Project / category master list | currently Notion-side only |
| HOZO 總控任務庫 | Cross-project task database | `SEVEN_TASKS_DATA_SOURCE_ID` |
| HOZO 會議紀錄 | HOZO AM meeting intake layer | `SEVEN_MEETINGS_DATA_SOURCE_ID` |
| HOZO 專案進度報表庫 | Project-level progress summaries | `SEVEN_PROGRESS_REPORTS_DATA_SOURCE_ID` |
| HOZO 風險與決策庫 | Report approval and decisions | `SEVEN_RISK_DECISIONS_DATA_SOURCE_ID` |
| HOZO Automation Run Log | Scheduled automation audit logs | `SEVEN_AUTOMATION_RUN_LOG_DATA_SOURCE_ID` |
| HOZO 通知候選佇列 | Future notification approvals | future env var |

## Minimum Task Database Fields

| Property | Suggested type |
| --- | --- |
| 任務名稱 / Name | Title |
| 專案 | Select or relation |
| 狀態 | Select |
| 確認狀態 | Select |
| 優先級 | Select |
| 負責人 | Rich text or people |
| 到期日 | Date |
| 來源 | Select |
| 來源原文 | Rich text |
| Codex 判斷摘要 | Rich text |
| 信心程度 | Select |
| 相關 Notion 頁面 | URL |

Suggested statuses:

- 待確認
- 未開始
- 進行中
- 等待回覆
- 待確認完成
- 已完成
- 封存

## Minimum Meeting Database Fields

| Property | Suggested type |
| --- | --- |
| 會議名稱 / Name | Title |
| 日期 | Date |
| 摘要 | Rich text |
| 會議記錄 | Rich text |
| 選擇專案 | Select or relation |
| 部門 | Select |
| 類別 | Select |
| 影片 | URL |

## Important Rule

Do not reuse the existing HOZO meeting database mentioned in onboarding notes. Create a separate HOZO AM meeting records database for this automation.
