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

After Render creates the web service, replace `<hozo-render-service>` in Render environment variables and `render.yaml` with the real Render service host.
