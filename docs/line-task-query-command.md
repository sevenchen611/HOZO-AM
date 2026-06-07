# HOZO Junior LINE Task Query

When a LINE message mentions one of the configured HOZO Junior triggers and asks for to-do tasks, the webhook replies directly in the original LINE conversation.

Example:

```text
HOZO Junior，請幫我提供我的待辦任務有哪些
```

Behavior:

- Store the original LINE message in `HOZO LINE 訊息紀錄`.
- If the text includes `HOZO Junior`, `HOZ Jr.`, or `HOZO Jr.` and asks about tasks/to-dos, query `HOZO 總控任務庫`.
- Prefer tasks whose `負責人` matches the LINE sender display name.
- If no personal owner match exists, list open HOZO tasks instead and say that no exact owner match was found.
- Reply to the same LINE conversation with up to 10 open tasks.
- Still enqueue the command in `HOZO Codex 指令佇列` when that data source is configured.

This command must only read HOZO AM data sources. Do not query or write 7AM/SevenAM databases.
