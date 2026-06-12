import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
loadEnv(path.join(root, '.env'));
loadEnv(path.resolve(root, '..', 'env.txt'));

const notionToken = process.env.NOTION_TOKEN;
const notionVersion = process.env.NOTION_VERSION || '2025-09-03';
const notionFileUploadVersion = process.env.NOTION_FILE_UPLOAD_VERSION || '2026-03-11';
const conversationsDataSourceId = process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID || '';
const tasksDataSourceId = process.env.HOZO_TASKS_DATA_SOURCE_ID || '';

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const planPath = path.resolve(root, args.plan || 'reports/task-rebuild/hozoam-curated-task-create-plan-20260610.json');
const maxMediaPerTask = numberArg(args['max-media-per-task'], 8);
const contextWindow = numberArg(args['context-window'], 3);
const runId = formatRunId(new Date());
const outputPath = path.join(root, 'reports', 'task-rebuild', `hozoam-task-media-backfill-${runId}.json`);

if (!notionToken) throw new Error('NOTION_TOKEN is not set.');
if (!conversationsDataSourceId) throw new Error('HOZO_CONVERSATIONS_DATA_SOURCE_ID is not set.');
if (!tasksDataSourceId) throw new Error('HOZO_TASKS_DATA_SOURCE_ID is not set.');

const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const [conversationPages, taskPages] = await Promise.all([
  queryAllDataSourcePages(conversationsDataSourceId),
  queryAllDataSourcePages(tasksDataSourceId),
]);

const conversations = [];
for (const page of conversationPages) {
  const conversation = normalizeConversation(page);
  const blocks = await getBlockChildren(conversation.id);
  conversations.push({
    ...conversation,
    messages: parseConversationBlocks(conversation, blocks).reverse(),
  });
}

const tasks = taskPages.map(normalizeTask);
const results = [];

for (const planTask of plan.tasks || []) {
  const task = tasks.find((item) => isActiveTask(item) && normalizeKey(item.title) === normalizeKey(planTask.title));
  if (!task) {
    results.push({ action: 'skipped-task-not-found', title: planTask.title, media: 0 });
    continue;
  }

  if (await hasExistingMediaBackfill(task.id)) {
    results.push({ action: 'skipped-existing-media-backfill', title: task.title, pageId: task.id, media: 0 });
    continue;
  }

  const mediaMatches = findMediaForPlanTask(planTask, conversations).slice(0, maxMediaPerTask);
  if (!mediaMatches.length) {
    results.push({ action: 'skipped-no-media-found', title: task.title, pageId: task.id, media: 0 });
    continue;
  }

  if (dryRun) {
    results.push({
      action: 'dry-run-backfill',
      title: task.title,
      pageId: task.id,
      media: mediaMatches.length,
      mediaItems: mediaMatches.map((item) => mediaSummary(item)),
    });
    continue;
  }

  const children = [
    headingBlock('heading_2', '對話圖片與附件證據補強'),
    paragraphBlock([
      `補強時間：${formatTaipeiDateTime(new Date())}`,
      '來源：LINE 對話主檔中的圖片/檔案區塊。',
      '目的：讓任務內文可以直接看到原始對話圖片，提升人工判斷速度與品質。',
    ].join('\n')),
  ];

  for (const match of mediaMatches) {
    children.push(paragraphBlock([
      `對話：${match.conversationName}`,
      match.actor ? `發話者：${match.actor}` : '',
      match.time ? `時間：${formatTaipeiDateTime(new Date(match.time))}` : '',
      match.context ? `前後文：${match.context}` : '',
      match.media.lineMessageId ? `LINE 訊息 ID：${match.media.lineMessageId}` : '',
    ].filter(Boolean).join('\n')));

    const uploaded = await uploadMediaToNotion(match.media);
    if (uploaded?.id) {
      children.push(mediaUploadBlock(uploaded, match.media));
    } else {
      children.push(paragraphBlock(`媒體補強失敗：${match.media.name || match.media.url}`));
    }
  }

  await appendBlockChildren(task.id, children);
  await notionRequest(`/v1/pages/${task.id}`, {
    method: 'PATCH',
    body: {
      properties: compactProperties({
        最後更新: dateProperty(new Date()),
      }),
    },
  });

  results.push({
    action: 'backfilled',
    title: task.title,
    pageId: task.id,
    url: task.url,
    media: mediaMatches.length,
    mediaItems: mediaMatches.map((item) => mediaSummary(item)),
  });
}

const output = {
  ok: true,
  dryRun,
  planPath,
  outputPath,
  sourceDataSource: 'HOZO_CONVERSATIONS_DATA_SOURCE_ID',
  forbiddenSourceDataSource: 'HOZO_MESSAGES_DATA_SOURCE_ID',
  counts: {
    plannedTasks: plan.tasks?.length || 0,
    backfilled: results.filter((item) => item.action === 'backfilled').length,
    dryRunBackfill: results.filter((item) => item.action === 'dry-run-backfill').length,
    skippedNoMediaFound: results.filter((item) => item.action === 'skipped-no-media-found').length,
    skippedExisting: results.filter((item) => item.action === 'skipped-existing-media-backfill').length,
    totalMedia: results.reduce((sum, item) => sum + (item.media || 0), 0),
  },
  results,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify(output, null, 2));

function findMediaForPlanTask(planTask, allConversations) {
  const matches = [];
  const seen = new Set();
  for (const filter of planTask.sourceCandidateFilters || []) {
    const conversationName = normalizeKey(filter.conversationName || '');
    const titleIncludes = normalizeKey(filter.titleIncludes || '');
    const conversation = allConversations.find((item) => normalizeKey(item.name) === conversationName);
    if (!conversation) continue;

    const messageMatches = conversation.messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => {
        const haystack = normalizeKey([
          message.text,
          message.actor,
          ...(message.media || []).map((media) => `${media.name} ${media.caption} ${media.lineMessageId}`),
        ].join('\n'));
        return titleIncludes && haystack.includes(titleIncludes);
      });

    for (const { index } of messageMatches) {
      const start = Math.max(0, index - contextWindow);
      const end = Math.min(conversation.messages.length, index + contextWindow + 1);
      for (const nearby of conversation.messages.slice(start, end)) {
        for (const media of nearby.media || []) {
          if (!shouldIncludeMedia(media)) continue;
          const key = media.url || media.lineMessageId || `${conversation.id}:${nearby.time}:${media.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          matches.push({
            conversationName: conversation.name,
            conversationUrl: conversation.url,
            actor: nearby.actor,
            time: nearby.time,
            context: clampText(nearby.text || '', 160),
            media,
          });
        }
      }
    }
  }
  return matches;
}

function shouldIncludeMedia(media) {
  const value = `${media.type || ''} ${media.name || ''} ${media.caption || ''} ${media.url || ''}`.toLowerCase();
  if (!media.url) return false;
  if (/stickershop|sticker/.test(value)) return false;
  if (/audio|video/.test(value)) return false;
  return /image|file|pdf|png|jpe?g|webp|gif|pptx|docx|xlsx/.test(value);
}

async function uploadMediaToNotion(media) {
  const response = await fetch(media.url);
  if (!response.ok) return null;
  const contentType = response.headers.get('content-type') || contentTypeFromName(media.name || media.url);
  const bytes = Buffer.from(await response.arrayBuffer());
  const filename = safeFileName(media.name || media.lineMessageId || `line-media${extensionFromContentType(contentType, media.type)}`);

  const upload = await notionRequest('/v1/file_uploads', {
    method: 'POST',
    notionVersionOverride: notionFileUploadVersion,
    body: {},
  });

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType || 'application/octet-stream' }), filename);
  const sent = await notionRequest(`/v1/file_uploads/${upload.id}/send`, {
    method: 'POST',
    notionVersionOverride: notionFileUploadVersion,
    form,
  });

  return sent?.status === 'uploaded' ? sent : null;
}

function mediaUploadBlock(uploaded, media) {
  const blockType = isImageMedia(media) ? 'image' : inferFileBlockType(media);
  return {
    object: 'block',
    type: blockType,
    [blockType]: {
      caption: richTextArray(mediaCaption(media)),
      type: 'file_upload',
      file_upload: { id: uploaded.id },
    },
  };
}

function inferFileBlockType(media) {
  const value = `${media.name || ''} ${media.url || ''}`.toLowerCase();
  if (/\.pdf(\?|#|$)/.test(value)) return 'pdf';
  return 'file';
}

function isImageMedia(media) {
  const value = `${media.type || ''} ${media.name || ''} ${media.url || ''}`.toLowerCase();
  return /image|png|jpe?g|webp|gif/.test(value);
}

function mediaCaption(media) {
  return [
    media.name || 'LINE 對話圖片',
    media.lineMessageId ? `LINE ID ${media.lineMessageId}` : '',
  ].filter(Boolean).join(' / ');
}

function mediaSummary(item) {
  return {
    conversationName: item.conversationName,
    time: item.time,
    actor: item.actor,
    name: item.media.name,
    type: item.media.type,
    lineMessageId: item.media.lineMessageId,
  };
}

async function hasExistingMediaBackfill(pageId) {
  const blocks = await getBlockChildren(pageId, 100);
  return blocks.some((block) => blockText(block).includes('對話圖片與附件證據補強'));
}

function parseConversationBlocks(conversation, blocks) {
  const messages = [];
  let current = null;
  for (const block of blocks) {
    const media = blockToMedia(block);
    if (media) {
      if (!current) {
        current = { timeText: '', conversationLabel: conversation.name, actor: '', type: media.type, source: 'line', contentLines: [], media: [] };
      }
      current.media.push(media);
      continue;
    }

    const text = blockText(block).trim();
    if (!text || text.includes('LINE 對話記錄')) continue;
    const meta = parseMessageHeader(text);
    if (meta) {
      if (current) messages.push(finalizeMessage(conversation, current, messages.length));
      current = { ...meta, contentLines: [], media: [] };
      continue;
    }
    if (current) current.contentLines.push(text);
  }
  if (current) messages.push(finalizeMessage(conversation, current, messages.length));
  return messages;
}

function parseMessageHeader(text) {
  const incoming = text.match(/^【(.+?)】(.+?) - (.+?)（(.+?)）$/);
  if (incoming) {
    return {
      timeText: incoming[1],
      conversationLabel: incoming[2].trim(),
      actor: incoming[3].trim(),
      type: incoming[4].trim(),
      source: 'line',
    };
  }
  const outgoing = text.match(/^【(.+?)】(.+?)：(.+?)$/);
  if (outgoing) {
    return {
      timeText: outgoing[1],
      conversationLabel: '',
      actor: outgoing[2].trim(),
      type: outgoing[3].trim(),
      source: 'ai-engine',
    };
  }
  return null;
}

function finalizeMessage(conversation, meta, index) {
  const text = meta.contentLines.join('\n').trim();
  return {
    id: `${conversation.id}:conversation-master:${index}`,
    conversationId: conversation.id,
    conversationName: conversation.name || meta.conversationLabel,
    actor: meta.actor,
    source: meta.source,
    type: meta.type,
    time: parseTaipeiDisplayTime(meta.timeText) || conversation.latestAt || '',
    text,
    media: meta.media || [],
  };
}

function blockToMedia(block) {
  const data = block?.[block.type];
  if (!data || !['image', 'file', 'pdf', 'video'].includes(block.type)) return null;
  const url = data.file?.url || data.external?.url || '';
  if (!url) return null;
  const caption = richText(data.caption || []);
  return {
    type: block.type,
    name: data.name || caption || mediaNameFromUrl(url) || block.type,
    url,
    caption,
    lineMessageId: caption.match(/[0-9]{10,}/)?.[0] || '',
  };
}

function normalizeConversation(page) {
  return {
    id: page.id,
    url: page.url,
    name: pageText(page, '自定義名稱') || pageText(page, 'LINE 對話名稱') || pageTitle(page) || '(未命名對話)',
    type: pageSelect(page, '對象類型') || '',
    latestAt: pageDate(page, '最後訊息時間') || page.last_edited_time || '',
  };
}

function normalizeTask(page) {
  return {
    id: page.id,
    url: page.url,
    title: pageText(page, '任務名稱') || '(未命名任務)',
    status: pageSelect(page, '狀態') || '',
  };
}

async function queryAllDataSourcePages(dataSourceId, extraBody = {}) {
  const results = [];
  let startCursor;
  do {
    const body = { page_size: 100, ...extraBody };
    if (startCursor) body.start_cursor = startCursor;
    const result = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, { method: 'POST', body });
    results.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor);
  return results;
}

async function getBlockChildren(blockId, limit = Infinity) {
  const results = [];
  let startCursor;
  do {
    const pageSize = Math.min(100, limit - results.length);
    if (pageSize <= 0) break;
    const cursor = startCursor ? `&start_cursor=${encodeURIComponent(startCursor)}` : '';
    const result = await notionRequest(`/v1/blocks/${blockId}/children?page_size=${pageSize}${cursor}`);
    results.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor && results.length < limit);
  return results;
}

async function appendBlockChildren(pageId, children) {
  for (const group of chunk(children, 80)) {
    await notionRequest(`/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children: group },
    });
  }
}

async function notionRequest(endpoint, { method = 'GET', body, form, notionVersionOverride } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const headers = {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': notionVersionOverride || notionVersion,
    };
    let requestBody;
    if (form) {
      requestBody = form;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(body);
    }
    const response = await fetch(`https://api.notion.com${endpoint}`, {
      method,
      headers,
      body: requestBody,
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok) return json;
    lastError = new Error(`${endpoint} ${response.status}: ${json.message || 'Notion request failed'}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) break;
    await sleep(750 * attempt);
  }
  throw lastError;
}

function pageTitle(page) {
  for (const property of Object.values(page.properties || {})) {
    if (property.type === 'title') return richText(property.title);
  }
  return '';
}

function pageText(page, name) {
  const prop = page.properties?.[name];
  if (!prop) return '';
  if (prop.type === 'title') return richText(prop.title);
  if (prop.type === 'rich_text') return richText(prop.rich_text);
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'status') return prop.status?.name || '';
  if (prop.type === 'url') return prop.url || '';
  if (prop.type === 'date') return prop.date?.start || '';
  return '';
}

function pageSelect(page, name) {
  const prop = page.properties?.[name];
  if (prop?.type === 'select') return prop.select?.name || '';
  if (prop?.type === 'status') return prop.status?.name || '';
  return '';
}

function pageDate(page, name) {
  const prop = page.properties?.[name];
  return prop?.type === 'date' ? prop.date?.start || '' : '';
}

function blockText(block) {
  const data = block?.[block.type];
  return richText(data?.rich_text || data?.caption || data?.title || []);
}

function headingBlock(type, text) {
  return { object: 'block', type, [type]: { rich_text: richTextArray(text) } };
}

function paragraphBlock(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: richTextArray(text) } };
}

function richTextArray(text) {
  return [{ type: 'text', text: { content: String(text || '').slice(0, 2000) } }];
}

function dateProperty(value) {
  const date = value instanceof Date ? value.toISOString() : String(value || '');
  return date ? { date: { start: date } } : undefined;
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function richText(value) {
  return (value || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
}

function isActiveTask(task) {
  return !/^(封存|已封存|Archived)$/i.test(String(task.status || '').trim());
}

function parseTaipeiDisplayTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const meridiem = match[4] || '';
  let hour = Number(match[5]);
  const minute = Number(match[6]);
  if (meridiem === '下午' && hour < 12) hour += 12;
  if (meridiem === '上午' && hour === 12) hour = 0;
  const date = new Date(Date.UTC(year, month, day, hour - 8, minute));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function formatTaipeiDateTime(date) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatRunId(date) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(' ', '-').replaceAll(':', '');
  return parts.replaceAll('-', '');
}

function extensionFromContentType(contentType, fallbackType) {
  const lower = String(contentType || '').toLowerCase();
  if (lower.includes('jpeg')) return '.jpg';
  if (lower.includes('png')) return '.png';
  if (lower.includes('gif')) return '.gif';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('pdf')) return '.pdf';
  if (String(fallbackType || '').toLowerCase() === 'image') return '.jpg';
  return '.bin';
}

function contentTypeFromName(name) {
  const value = String(name || '').toLowerCase();
  if (/\.jpe?g(\?|#|$)/.test(value)) return 'image/jpeg';
  if (/\.png(\?|#|$)/.test(value)) return 'image/png';
  if (/\.gif(\?|#|$)/.test(value)) return 'image/gif';
  if (/\.webp(\?|#|$)/.test(value)) return 'image/webp';
  if (/\.pdf(\?|#|$)/.test(value)) return 'application/pdf';
  return 'application/octet-stream';
}

function mediaNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname.split('/').pop() || '') || '';
  } catch {
    return '';
  }
}

function safeFileName(value) {
  return String(value || 'line-media')
    .replace(/[?#].*$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120) || 'line-media';
}

function clampText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeKey(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
