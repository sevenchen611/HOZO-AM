# HOZO AM Onboarding Summary

This document summarizes the onboarding JSON used to create this independent HOZO AM project. Sensitive token values are intentionally omitted.

## Basic Info

| Field | Value |
| --- | --- |
| Company / unit | HOZO 好住寓好 |
| Department | 總部 |
| Project code | HOZO_AM |
| Assistant name | HOZO Jr. |
| Timezone | Asia/Taipei |
| Language | 繁體中文 |
| Target go-live date | 2026-06-07 |

## Purpose

彙整群組訊息、客人訊息、會議記錄及待辦事項，產生每天的早報與晚報，以掌握所有專案的進度。

## Scope

Only include data under the HOZO project Notion page. Other Notion data should not be included.

## Owner

| Field | Value |
| --- | --- |
| Name | 陸昱晴 |
| Role | 總經理 |
| LINE display name | 昱晴 Maggie |
| Report target type | user |

## Existing Notion Data Sources

| Layer | Data Source ID |
| --- | --- |
| HOZO LINE 對話主檔 | configured |
| HOZO LINE 訊息紀錄 | configured |
| HOZO LINE 附件紀錄 | configured |

## Planned Data Sources

- HOZO Codex 指令佇列
- HOZO 總控專案庫
- HOZO 總控任務庫
- HOZO-AM 會議記錄
- HOZO 專案進度報表庫
- HOZO 風險與決策庫
- HOZO Automation Run Log
- HOZO 通知候選佇列

## Initial Projects

| Project | Owner |
| --- | --- |
| 招租管理 | Maggie |
| 網頁設計 | Maggie |
| 後臺設計製作 | Seven |

## Known LINE Groups

| Name | Type | Project |
| --- | --- | --- |
| HOZO公司群 | group | 後臺設計製作 |

## Notes

- Existing HOZO LINE CRM databases should be reused.
- Existing HOZO meeting database should not be reused. Create a fresh HOZO AM meeting database.
- Sensitive, external commitment, legal, tax, finance, contract, and HR items require confirmation.
