# HOZO Scheduled Report Recipients

Daily scheduled reports that would normally be sent to Maggie must also be sent to Seven Chen.

This applies to all five scheduled report slots:

- 08:30 morning brief
- 10:00 morning follow-up
- 13:00 midday follow-up
- 17:00 afternoon follow-up
- 20:30 daily report

Configuration:

```text
HOZO_REPORT_TARGET_NAME_KEYWORD=Maggie
HOZO_REPORT_CC_TARGET_IDS=U77e5ebe92da94e8803e0786d8684f69a
HOZO_REPORT_CC_TARGET_TYPE=user
HOZO_REPORT_CC_NAME_KEYWORDS=Seven陳聖文,Seven 陳聖文
```

`HOZO_REPORT_CC_TARGET_IDS` is the required fixed fallback. `HOZO_REPORT_CC_NAME_KEYWORDS` remains as a Notion lookup backup.

Do not mix HOZO AM recipients with 7AM/SevenAM data or services. The report recipient lookup must use the HOZO LINE conversation database only.
