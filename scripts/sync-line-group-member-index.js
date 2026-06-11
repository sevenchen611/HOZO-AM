import { existsSync, readFileSync } from 'node:fs';

loadEnvFile('.env');
loadEnvFile('../env.txt');

const notionToken = process.env.NOTION_TOKEN;
const notionVersion = process.env.NOTION_VERSION || '2025-09-03';
const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const conversationsDataSourceId = process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID || '';
const groupOptionsDataSourceId = process.env.HOZO_LINE_GROUP_OPTIONS_DATA_SOURCE_ID || '';
const memberIndexDataSourceId = process.env.HOZO_LINE_GROUP_MEMBER_INDEX_DATA_SOURCE_ID || '';

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const limit = clampNumber(Number(args.limit || 100), 1, 100);

if (!notionToken) fail('NOTION_TOKEN is not set.');
if (!lineToken) fail('LINE_CHANNEL_ACCESS_TOKEN is not set.');
if (!conversationsDataSourceId) fail('HOZO_CONVERSATIONS_DATA_SOURCE_ID is not set.');
if (!groupOptionsDataSourceId) fail('HOZO_LINE_GROUP_OPTIONS_DATA_SOURCE_ID is not set.');
if (!memberIndexDataSourceId) fail('HOZO_LINE_GROUP_MEMBER_INDEX_DATA_SOURCE_ID is not set.');

try {
  await Promise.all([
    assertHozoDataSource(conversationsDataSourceId),
    assertHozoDataSource(groupOptionsDataSourceId),
    assertHozoDataSource(memberIndexDataSourceId),
  ]);

  const [conversations, groupOptions, existingIndexRows] = await Promise.all([
    queryAllPages(conversationsDataSourceId, {
      page_size: limit,
      filter: {
        or: [
          { property: '對象類型', select: { equals: '群組' } },
          { property: '對象類型', select: { equals: '聊天室' } },
        ],
      },
      sorts: [{ property: '最後訊息時間', direction: 'descending' }],
    }),
    queryAllPages(groupOptionsDataSourceId, { page_size: 100 }),
    queryAllPages(memberIndexDataSourceId, { page_size: 100 }),
  ]);

  const groupOptionsByTarget = new Map(groupOptions.map(normalizeGroupOption).filter((item) => item.targetKey).map((item) => [item.targetKey, item]));
  const existingByMembership = new Map(existingIndexRows.map(normalizeMemberIndexRow).filter((item) => item.membershipKey).map((item) => [item.membershipKey, item]));

  const created = [];
  const updated = [];
  const unavailable = [];
  const now = new Date().toISOString();

  for (const conversation of conversations) {
    const source = normalizeConversation(conversation);
    if (!source.targetId || !['group', 'room'].includes(source.targetType)) continue;

    const groupOption = groupOptionsByTarget.get(source.targetKey);
    let memberIds = [];
    try {
      memberIds = await listLineMemberIds(source);
    } catch (error) {
      unavailable.push({ targetName: source.displayName, targetType: source.targetType, reason: error.message });
      continue;
    }

    for (const userId of memberIds) {
      const profile = await getLineMemberProfile(source, userId).catch((error) => ({
        displayName: '',
        pictureUrl: '',
        statusMessage: `profile_unavailable: ${error.message}`,
      }));
      const displayName = profile.displayName || userId;
      const row = {
        source,
        groupOption,
        userId,
        displayName,
        pictureUrl: profile.pictureUrl || '',
        status: profile.displayName ? 'active' : 'profile_unavailable',
        syncMessage: profile.statusMessage || 'Synced from LINE group member API.',
        syncedAt: now,
      };
      const existing = existingByMembership.get(`${source.targetKey}:${userId}`);
      if (!existing) {
        created.push(row);
        if (!dryRun) {
          await createPage(memberIndexDataSourceId, memberIndexProperties(row));
        }
        continue;
      }
      const patch = memberIndexUpdateProperties(row, existing);
      if (Object.keys(patch).length) {
        updated.push({ ...row, pageId: existing.id });
        if (!dryRun) {
          await updatePage(existing.id, patch);
        }
      }
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    scannedConversations: conversations.length,
    createdMembers: created.map((item) => ({ groupName: item.source.displayName, displayName: item.displayName, userId: maskId(item.userId) })),
    updatedMembers: updated.map((item) => ({ groupName: item.source.displayName, displayName: item.displayName, userId: maskId(item.userId) })),
    unavailableGroups: unavailable,
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function listLineMemberIds(source) {
  const pathname = source.targetType === 'room'
    ? `/v2/bot/room/${encodeURIComponent(source.targetId)}/members/ids`
    : `/v2/bot/group/${encodeURIComponent(source.targetId)}/members/ids`;
  const memberIds = [];
  let start = '';
  do {
    const query = start ? `?start=${encodeURIComponent(start)}` : '';
    const response = await lineRequest(`${pathname}${query}`);
    memberIds.push(...(response.memberIds || []));
    start = response.next || '';
  } while (start);
  return [...new Set(memberIds)];
}

async function getLineMemberProfile(source, userId) {
  const pathname = source.targetType === 'room'
    ? `/v2/bot/room/${encodeURIComponent(source.targetId)}/member/${encodeURIComponent(userId)}`
    : `/v2/bot/group/${encodeURIComponent(source.targetId)}/member/${encodeURIComponent(userId)}`;
  return lineRequest(pathname);
}

async function lineRequest(pathname) {
  const response = await fetch(`https://api.line.me${pathname}`, {
    headers: { Authorization: `Bearer ${lineToken}` },
  });
  const responseText = await response.text();
  const json = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    const message = json.message || responseText || 'LINE request failed';
    throw new Error(`${response.status} ${message}`);
  }
  return json;
}

function normalizeConversation(page) {
  const targetType = normalizeTargetType(pageSelect(page, '對象類型') || 'unknown');
  const targetId = targetType === 'room' ? pageText(page, 'Room ID') : pageText(page, 'Group ID');
  const displayName = pageText(page, '自定義名稱') || pageText(page, 'LINE 對話名稱') || targetId;
  return {
    pageId: page.id,
    pageUrl: page.url,
    targetType,
    targetId,
    targetKey: `${targetType}:${targetId}`,
    displayName,
    lastMessageAt: pageDate(page, '最後訊息時間'),
  };
}

function normalizeGroupOption(page) {
  const targetType = selectName(page.properties?.['對象類型']) || 'group';
  const groupId = pageText(page, 'GroupID');
  return {
    id: page.id,
    targetType,
    targetId: groupId,
    targetKey: `${targetType}:${groupId}`,
    title: pageTitle(page, '群組顯示名稱') || pageText(page, 'LINE對話名稱') || pageText(page, '自定義名稱'),
  };
}

function normalizeMemberIndexRow(page) {
  const targetType = selectName(page.properties?.['對象類型']) || 'group';
  const groupId = pageText(page, 'GroupID');
  const roomId = pageText(page, 'RoomID');
  const targetId = targetType === 'room' ? roomId : groupId;
  const userId = pageText(page, 'UserID');
  return {
    id: page.id,
    targetType,
    targetId,
    targetKey: `${targetType}:${targetId}`,
    userId,
    membershipKey: targetId && userId ? `${targetType}:${targetId}:${userId}` : '',
    displayName: pageText(page, '成員顯示名稱'),
    pictureUrl: page.properties?.['圖片URL']?.url || '',
    status: selectName(page.properties?.['成員狀態']),
    groupOptionIds: relationIds(page.properties?.['LINE群組選項']),
    conversationIds: relationIds(page.properties?.['LINE對話主檔']),
  };
}

function memberIndexProperties(row) {
  const targetIdProps = row.source.targetType === 'room'
    ? { RoomID: richTextProperty(row.source.targetId), GroupID: richTextProperty('') }
    : { GroupID: richTextProperty(row.source.targetId), RoomID: richTextProperty('') };
  return {
    成員索引名稱: titleProperty(`${row.source.displayName} / ${row.displayName}`),
    對象類型: selectProperty(row.source.targetType),
    ...targetIdProps,
    群組顯示名稱: richTextProperty(row.source.displayName),
    UserID: richTextProperty(row.userId),
    成員顯示名稱: richTextProperty(row.displayName),
    圖片URL: urlProperty(row.pictureUrl),
    成員狀態: selectProperty(row.status),
    來源: selectProperty('LINE API'),
    LINE對話主檔: relationProperty([row.source.pageId]),
    LINE群組選項: relationProperty(row.groupOption?.id ? [row.groupOption.id] : []),
    最後同步時間: dateProperty(row.syncedAt),
    最後出現時間: dateProperty(row.source.lastMessageAt || row.syncedAt),
    同步訊息: richTextProperty(row.syncMessage),
  };
}

function memberIndexUpdateProperties(row, existing) {
  const properties = {};
  if (existing.displayName !== row.displayName) properties.成員顯示名稱 = richTextProperty(row.displayName);
  if (existing.pictureUrl !== row.pictureUrl) properties.圖片URL = urlProperty(row.pictureUrl);
  if (existing.status !== row.status) properties.成員狀態 = selectProperty(row.status);
  if (!existing.conversationIds.includes(row.source.pageId)) properties.LINE對話主檔 = relationProperty([...existing.conversationIds, row.source.pageId]);
  if (row.groupOption?.id && !existing.groupOptionIds.includes(row.groupOption.id)) properties.LINE群組選項 = relationProperty([...existing.groupOptionIds, row.groupOption.id]);
  properties.群組顯示名稱 = richTextProperty(row.source.displayName);
  properties.來源 = selectProperty('LINE API');
  properties.最後同步時間 = dateProperty(row.syncedAt);
  properties.同步訊息 = richTextProperty(row.syncMessage);
  return compactProperties(properties);
}

async function queryAllPages(dataSourceId, body = {}) {
  const results = [];
  let startCursor = null;
  do {
    const response = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
      method: 'POST',
      body: {
        page_size: body.page_size || 100,
        start_cursor: startCursor || undefined,
        filter: body.filter,
        sorts: body.sorts,
      },
    });
    results.push(...(response.results || []));
    startCursor = response.has_more ? response.next_cursor : null;
  } while (startCursor);
  return results;
}

async function createPage(dataSourceId, properties) {
  return notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: compactProperties(properties),
    },
  });
}

async function updatePage(pageId, properties) {
  return notionRequest(`/v1/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties: compactProperties(properties) },
  });
}

async function assertHozoDataSource(dataSourceId) {
  const dataSource = await notionRequest(`/v1/data_sources/${dataSourceId}`, { method: 'GET' });
  const title = plainText(dataSource.title || []);
  if (!/(HOZO|好住|寓好|LINE|group|member|conversation)/i.test(title)) {
    fail(`Refusing to write to non-HOZO data source: ${title || dataSourceId}`);
  }
  return dataSource;
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

function normalizeTargetType(value) {
  if (value === '群組') return 'group';
  if (value === '聊天室') return 'room';
  return value || 'unknown';
}

function titleProperty(content) {
  return { title: [{ type: 'text', text: { content: clampText(content) } }] };
}

function richTextProperty(content) {
  return { rich_text: content ? [{ type: 'text', text: { content: clampText(content) } }] : [] };
}

function selectProperty(name) {
  return name ? { select: { name } } : undefined;
}

function dateProperty(value) {
  return value ? { date: { start: value instanceof Date ? value.toISOString() : new Date(value).toISOString() } } : undefined;
}

function relationProperty(ids) {
  return { relation: ids.filter(Boolean).map((id) => ({ id })) };
}

function urlProperty(value) {
  return value ? { url: value } : undefined;
}

function relationIds(property) {
  return (property?.relation || []).map((item) => item.id).filter(Boolean);
}

function pageTitle(page, propertyName) {
  return plainText(page?.properties?.[propertyName]?.title || []);
}

function pageText(page, propertyName) {
  const property = page?.properties?.[propertyName];
  return plainText(property?.title || property?.rich_text || []);
}

function pageSelect(page, propertyName) {
  return selectName(page?.properties?.[propertyName]);
}

function pageDate(page, propertyName) {
  return page?.properties?.[propertyName]?.date?.start || '';
}

function selectName(property) {
  return property?.select?.name || '';
}

function plainText(items) {
  return (items || []).map((item) => item.plain_text || item.text?.content || '').join('');
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function clampText(value) {
  return String(value || '').slice(0, 1900);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function maskId(value) {
  const text = String(value || '');
  return text.length > 10 ? `${text.slice(0, 4)}...${text.slice(-4)}` : text;
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

