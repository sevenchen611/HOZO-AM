# HOZO AM LINE OA Webhook

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sevenchen611/HOZO-AM)

HOZO AM 是 HOZO 好住寓好專用的 Assistant Manager 控制中心。這個專案只服務 HOZO 總控流程，負責接收 HOZO LINE OA 訊息、寫入 HOZO Notion 總控中心，並透過 Render Cron 發送早報、跟催確認與每日總控報告。

## 專案範圍

- 公司 / 單位：HOZO 好住寓好
- 部門：總部
- 助理名稱：HOZO Jr.
- 主負責人：陸昱晴
- 預設通知對象：主負責人的 LINE user target
- Notion 總控中心：HOZO 總控中心
- LINE OA：HOZO 好住寓好

本專案只納入 HOZO 總控中心頁面往下的資料。其他 Notion 頁面、其他部門資料庫、私人資料或非本專案資料不納入同步。

## Webhook

LINE Developers Console 的 Webhook URL 會在 Render 部署後取得：

```text
https://hozo-am-line-oa-webhook.onrender.com/webhook/line
```

健康檢查：

```text
https://hozo-am-line-oa-webhook.onrender.com/health
https://hozo-am-line-oa-webhook.onrender.com/control/health
```

## 必要環境變數

請參考 `.env.example`。敏感值請填在 Render Environment 或本機 `.env`，不要提交到 GitHub。

目前已知且可直接使用的 Notion data source：

- HOZO LINE 對話主檔：`HOZO_CONVERSATIONS_DATA_SOURCE_ID`
- HOZO LINE 訊息紀錄：`HOZO_MESSAGES_DATA_SOURCE_ID`
- HOZO LINE 附件紀錄：`HOZO_ATTACHMENTS_DATA_SOURCE_ID`

仍需建立後補上的資料庫：

- HOZO Codex 指令佇列
- HOZO 總控專案庫
- HOZO 總控任務庫
- HOZO 會議紀錄
- HOZO 專案進度報表庫
- HOZO 風險與決策庫
- HOZO Automation Run Log
- HOZO 通知候選佇列

## LINE 指令

一般訊息只會收集到 Notion，不自動回覆。報告頁仍支援：

- `早報`、`#早報`、`今日早報`、`#今日早報`、`行程`、`#行程`
- `報告`、`#報告`、`每日報告`、`#每日報告`

Codex 指令觸發名稱預設由環境變數設定：

```text
HOZO_CODEX_COMMAND_TRIGGERS=HOZO Junior,HOZ Jr.,HOZO Jr.
```

## Render Cron Jobs

Render Cron 使用 UTC。台北時間 UTC+8。

| Render Cron Job | 台北時間 | UTC cron | 指令 |
| --- | --- | --- | --- |
| `hozo-am-meeting-action-sync` | 08:00-22:00 每小時 | `0 0-14 * * *` | `npm run meetings:sync -- --limit 50` |
| `hozo-am-morning-brief` | 08:00 | `0 0 * * *` | `npm run cron:report -- morning` |
| `hozo-am-followup-morning` | 10:00 | `0 2 * * *` | `npm run cron:report -- followup-morning` |
| `hozo-am-followup-midday` | 13:00 | `0 5 * * *` | `npm run cron:report -- followup-midday` |
| `hozo-am-followup-afternoon` | 17:00 | `0 9 * * *` | `npm run cron:report -- followup-afternoon` |
| `hozo-am-daily-report` | 20:30 | `30 12 * * *` | `npm run cron:report -- daily` |

## 本機啟動

```powershell
npm install
npm start
```

本機測試前請先建立 `.env`。不要把 `.env` 提交到 GitHub。

## 下一步

1. 建立 HOZO 專用缺少的 Notion data sources。
2. 將新 data source ID 補進 Render Environment。
3. 部署 Render web service。
4. 把 Render webhook URL 填入 LINE Developers Console。
5. 測試 `/control/health`、LINE webhook 收訊、預設對象推送與報告發送。

