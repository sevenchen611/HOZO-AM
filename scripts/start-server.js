import { spawnSync } from 'node:child_process';

const shouldBuildUserUi = process.env.HOZO_BUILD_USER_UI_ON_START !== 'false';

if (shouldBuildUserUi) {
  const result = spawnSync(process.execPath, [
    'scripts/build-user-ui-connected-preview.js',
    '--project-root',
    '.',
    '--name',
    'HOZO AM',
    '--output',
    'docs/user-ui-connected-preview.html',
    '--project-data-source-id',
    '6395278e-53e8-4b47-917a-36d88802324e',
    '--skip-line-media',
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      USER_UI_SKIP_LINE_MEDIA: 'true',
    },
  });

  if (result.status !== 0) {
    console.warn(`User UI build failed with status ${result.status}; starting webhook service anyway.`);
  }
}

await import('../src/control-api.js');
await import('../src/server.js');
