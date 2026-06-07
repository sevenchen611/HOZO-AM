# Project Improvement Manifest

Project: HOZO AM

This file records which shared improvement versions are installed in this project.

Do not copy production values from another project. Each project must use its own LINE, Notion, Render, and environment configuration.

| Version | Improvement | Status | Applied Date | Commit / Reference | Verification |
| --- | --- | --- | --- | --- | --- |
| `AM-IMP-2026.0608.01` | Project data isolation guard | Installed | 2026-06-07 | `398afb0` | Local health check passed; Notion write guard added. Render deploy still needs confirmation after sync. |
| `AM-IMP-2026.0608.02` | Scheduled report multi-recipient rule | Installed | 2026-06-07 | `c931893` | Local health check passed; Render deploy still needs confirmation after sync. |
| `AM-IMP-2026.0608.03` | LINE task-query reply command | Installed | 2026-06-07 | `38f4373` | Local health check passed; Render deploy still needs confirmation after sync. |
| `AM-IMP-2026.0608.04` | Cron report deployment verification | Proposed |  |  |  |
| `AM-IMP-2026.0608.05` | Improvement manifest and upgrade records | Installed | 2026-06-08 | Planning docs | This manifest exists. |

## Project-Specific Values

Keep these values project-local:

| Area | HOZO AM Value Source |
| --- | --- |
| LINE channel | HOZO AM LINE Developers channel |
| Notion data sources | HOZO AM Notion databases only |
| Render service | HOZO AM Render service only |
| Report recipients | HOZO AM LINE conversation records |
| Secrets | `.env` locally and Render Environment in production |

