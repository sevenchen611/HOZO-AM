# Move HOZO AM To A New Machine

This package contains the HOZO AM LINE OA webhook service.

## Files to copy

- `src/`
- `scripts/`
- `reports/`
- `config/`
- `README.md`
- `AGENTS.md`
- `render.yaml`
- `package.json`
- `package-lock.json`
- `.env.example`

Do not copy committed secrets. Keep `.env` private and recreate it from `.env.example`.

## Required setup

1. Install Node.js.
2. Run `npm install`.
3. Create `.env` from `.env.example`.
4. Fill LINE, Notion, and Render control secrets.
5. Run `npm start`.

## Deployment note

The current Render service host is `https://hozo-am-line-oa-webhook.onrender.com`. If a future deployment uses a different host, update `HOZO_PUBLIC_BASE_URL`, `CONTROL_API_URL`, and `CONTROL_LINE_PUSH_URL`.
