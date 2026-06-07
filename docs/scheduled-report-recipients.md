# HOZO Scheduled Report Recipients

Daily scheduled reports that would normally be sent to Maggie must also be sent to Seven Chen.

This applies to all five scheduled report slots:

- 08:00 morning brief
- 10:00 morning follow-up
- 13:00 midday follow-up
- 17:00 afternoon follow-up
- 20:30 daily report

Configuration:

```text
HOZO_REPORT_TARGET_NAME_KEYWORD=Maggie
HOZO_REPORT_CC_NAME_KEYWORDS=Seven陳聖文,Seven 陳聖文
```

Do not mix HOZO AM recipients with 7AM/SevenAM data or services. The report recipient lookup must use the HOZO LINE conversation database only.
