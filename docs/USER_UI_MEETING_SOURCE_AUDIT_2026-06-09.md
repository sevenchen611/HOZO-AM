# HOZO AM User UI Meeting Source Audit - 2026-06-09

Audit rule:

Meeting-derived task pages must show meeting records as their evidence source.
They must not fall back to generic LINE conversation wording.

Required meeting-derived task page behavior:

1. Show `資料來源：會議記錄`.
2. Link `關聯頁面` to the source meeting record.
3. Show `會議記錄內文` when meeting body content is available.
4. Preserve `來源標記` and `同步識別碼`.
5. Do not show `來源對話群組：LINE 對話群組` for meeting-derived tasks.

Audit result:

| Item | Result |
| --- | --- |
| Total task pages checked | 51 |
| Meeting-derived task pages | 40 |
| Meeting-derived pages passed | 40 |
| Meeting-derived pages failed | 0 |
| Non-meeting pages with generic LINE fallback | 8 |

The 8 generic LINE fallback pages have no meeting source signal, no
`meeting-checkbox`, no `meeting-action`, and no `同步識別碼：meeting:` value. They
are outside this meeting-source rule and should be reviewed under a separate
LINE/manual-source evidence rule if needed.

Generated pages were regenerated after the generator passed the AM Core
`AM-IMP-2026.0609.10` verifier.

Verification commands:

```text
node D:\Codex_project\AMCore\versions\AM-IMP-2026.0609.10\scripts\verify-meeting-source-task-page.js D:\Codex_project\HOZO_AM\line-oa-webhook
node scripts\build-user-ui-connected-preview.js --name "HOZO AM" --prefix HOZO --output docs\user-ui-connected-preview.html
```

Passed meeting-derived task pages:

```text
user-ui-task-1.html
user-ui-task-2.html
user-ui-task-3.html
user-ui-task-4.html
user-ui-task-5.html
user-ui-task-6.html
user-ui-task-7.html
user-ui-task-8.html
user-ui-task-9.html
user-ui-task-10.html
user-ui-task-11.html
user-ui-task-12.html
user-ui-task-13.html
user-ui-task-14.html
user-ui-task-15.html
user-ui-task-16.html
user-ui-task-17.html
user-ui-task-18.html
user-ui-task-19.html
user-ui-task-20.html
user-ui-task-21.html
user-ui-task-22.html
user-ui-task-23.html
user-ui-task-24.html
user-ui-task-25.html
user-ui-task-26.html
user-ui-task-27.html
user-ui-task-28.html
user-ui-task-29.html
user-ui-task-31.html
user-ui-task-32.html
user-ui-task-33.html
user-ui-task-34.html
user-ui-task-35.html
user-ui-task-36.html
user-ui-task-38.html
user-ui-task-39.html
user-ui-task-40.html
user-ui-task-41.html
user-ui-task-42.html
```
