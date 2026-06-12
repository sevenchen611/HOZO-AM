import { existsSync, readFileSync } from 'node:fs';

loadEnvFile('.env');
loadEnvFile('../env.txt');

const notionToken = process.env.NOTION_TOKEN;
const notionVersion = process.env.NOTION_VERSION || '2025-09-03';
const parentPageId = normalizeId(process.env.HOZO_DATA_SOURCE_PARENT_BLOCK_ID || process.env.HOZO_DATA_SOURCE_PARENT_PAGE_ID || '');
const conversationsDataSourceId = process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID || '';
const groupOptionsDataSourceId = process.env.HOZO_LINE_GROUP_OPTIONS_DATA_SOURCE_ID || '';

const args = parseArgs(process.argv.slice(2));
let resolvedParentPageId = normalizeId(args.parent || parentPageId);

if (!notionToken) fail('NOTION_TOKEN is not set.');
if (!resolvedParentPageId) fail('HOZO_DATA_SOURCE_PARENT_BLOCK_ID is not set.');
if (!conversationsDataSourceId) fail('HOZO_CONVERSATIONS_DATA_SOURCE_ID is not set.');
if (!groupOptionsDataSourceId) fail('HOZO_LINE_GROUP_OPTIONS_DATA_SOURCE_ID is not set.');

const database = await createDatabase({
  title: 'HOZO LINE 群組成員索引庫',
  dataSourceTitle: 'HOZO LINE 群組成員索引',
  properties: memberIndexProperties(conversationsDataSourceId, groupOptionsDataSourceId),
});

const dataSourceId = dataSourceIdFromDatabase(database);
if (!dataSourceId) fail('Unable to read member index data source id.');

console.log(JSON.stringify({
  ok: true,
  databaseId: database.id,
  dataSourceId,
  url: database.url,
  renderEnvVar: `HOZO_LINE_GROUP_MEMBER_INDEX_DATA_SOURCE_ID=${dataSourceId}`,
  nextStep: 'Add the env var to HOZO AM, then run npm run line:group-members -- --dry-run.',
}, null, 2));

function memberIndexProperties(conversationsDataSourceId, groupOptionsDataSourceId) {
  return {
    成員索引名稱: { title: {} },
    對象類型: {
      select: {
        options: [
          { name: 'group', color: 'blue' },
          { name: 'room', color: 'purple' },
        ],
      },
    },
    GroupID: { rich_text: {} },
    RoomID: { rich_text: {} },
    群組顯示名稱: { rich_text: {} },
    UserID: { rich_text: {} },
    成員顯示名稱: { rich_text: {} },
    圖片URL: { url: {} },
    成員狀態: {
      select: {
        options: [
          { name: 'active', color: 'green' },
          { name: 'unknown', color: 'yellow' },
          { name: 'left', color: 'gray' },
          { name: 'api_unavailable', color: 'red' },
          { name: 'profile_unavailable', color: 'orange' },
        ],
      },
    },
    來源: {
      select: {
        options: [
          { name: 'LINE API', color: 'green' },
          { name: 'Webhook', color: 'blue' },
          { name: 'Conversation fallback', color: 'yellow' },
          { name: 'Manual', color: 'purple' },
        ],
      },
    },
    LINE對話主檔: { relation: { data_source_id: conversationsDataSourceId, single_property: {} } },
    LINE群組選項: { relation: { data_source_id: groupOptionsDataSourceId, single_property: {} } },
    最後同步時間: { date: {} },
    最後出現時間: { date: {} },
    同步訊息: { rich_text: {} },
  };
}

async function createDatabase({ title, dataSourceTitle, properties }) {
  const body = {
    parent: { type: 'page_id', page_id: resolvedParentPageId },
    title: [{ type: 'text', text: { content: title } }],
    is_inline: false,
    initial_data_source: {
      title: [{ type: 'text', text: { content: dataSourceTitle } }],
      properties,
    },
  };

  try {
    return await notionRequest('/v1/databases', { method: 'POST', body });
  } catch (error) {
    if (!String(error?.message || '').includes('Parent block type column cannot contain databases')) throw error;
    const ancestorPageId = await findAncestorPageId(resolvedParentPageId);
    if (!ancestorPageId || ancestorPageId === resolvedParentPageId) throw error;
    resolvedParentPageId = ancestorPageId;
    body.parent = { type: 'page_id', page_id: resolvedParentPageId };
    return notionRequest('/v1/databases', { method: 'POST', body });
  }
}

async function findAncestorPageId(blockId) {
  let currentId = normalizeId(blockId);
  for (let depth = 0; depth < 8 && currentId; depth += 1) {
    const block = await notionRequest(`/v1/blocks/${currentId}`, { method: 'GET' });
    if (block.parent?.type === 'page_id') return normalizeId(block.parent.page_id);
    currentId = normalizeId(block.parent?.block_id || '');
  }
  return '';
}

async function notionRequest(pathname, { method, body }) {
  const response = await fetch(`https://api.notion.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Content-Type': 'application/json',
      'Notion-Version': notionVersion,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Notion API failed: ${response.status} ${responseText}`);
  return responseText ? JSON.parse(responseText) : {};
}

function dataSourceIdFromDatabase(database) {
  return database.data_sources?.[0]?.id || database.data_sources?.[0]?.data_source_id || null;
}

function normalizeId(value) {
  return String(value || '').replace(/-/g, '').trim();
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function loadEnvFile(pathname) {
  if (!existsSync(pathname)) return;
  const envFile = readFileSync(pathname, 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
