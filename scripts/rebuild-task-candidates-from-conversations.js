import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
loadEnv(path.join(root, '.env'));
loadEnv(path.resolve(root, '..', 'env.txt'));

const notionToken = process.env.NOTION_TOKEN;
const notionVersion = process.env.NOTION_VERSION || '2025-09-03';
const conversationsDataSourceId = process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID || '';
const tasksDataSourceId = process.env.HOZO_TASKS_DATA_SOURCE_ID || '';
const outgoingActorName = process.env.HOZO_OUTGOING_ACTOR_NAME || 'HOZO Jr.';
const taskReconciliationPolicy = loadJsonFile(path.join(root, 'config', 'hourly-line-task-reconciliation.json'));
const masterPromptPolicy = taskReconciliationPolicy.masterPromptPolicy || {};

const args = parseArgs(process.argv.slice(2));
const dryRun = Boolean(args['dry-run']);
const archiveCurrent = Boolean(args['archive-current']);
const createTasks = Boolean(args['create-tasks']);
const limitConversations = numberArg(args['limit-conversations'], 0);
const candidateLimit = numberArg(args['candidate-limit'], 0);
const minScore = numberArg(args['min-score'], 3);
const runId = formatRunId(new Date());
const outputDir = path.join(root, 'reports', 'task-rebuild');
const snapshotPath = path.join(outputDir, `hozo-am-task-archive-snapshot-${runId}.json`);
const candidateJsonPath = path.join(outputDir, `hozo-am-conversation-rebuild-candidates-${runId}.json`);
const candidateHtmlPath = path.join(outputDir, `hozo-am-conversation-rebuild-candidates-${runId}.html`);

if (!notionToken) throw new Error('NOTION_TOKEN is not set.');
if (!conversationsDataSourceId) throw new Error('HOZO_CONVERSATIONS_DATA_SOURCE_ID is not set.');
if (!tasksDataSourceId) throw new Error('HOZO_TASKS_DATA_SOURCE_ID is not set.');

fs.mkdirSync(outputDir, { recursive: true });

const startedAt = new Date();
const [taskPages, conversationPages] = await Promise.all([
  queryAllDataSourcePages(tasksDataSourceId),
  queryAllDataSourcePages(conversationsDataSourceId, {
    sorts: [{ property: '最後訊息時間', direction: 'descending' }],
  }),
]);

const tasks = taskPages.map(normalizeTask);
const conversations = sortConversationsForJudgement(
  (limitConversations ? conversationPages.slice(0, limitConversations) : conversationPages).map(normalizeConversation),
);
const snapshot = buildTaskSnapshot(tasks);
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

const archiveResults = archiveCurrent
  ? await archiveActiveTasks(tasks)
  : { requested: false, archived: 0, skipped: tasks.length, results: [] };

const conversationDetails = [];
const allCandidates = [];
for (const conversation of conversations) {
  const blocks = await getBlockChildren(conversation.id);
  const messages = parseConversationBlocks(conversation, blocks).reverse();
  const candidates = buildConversationCandidates(conversation, messages);
  conversationDetails.push({
    id: conversation.id,
    name: conversation.name,
    project: conversation.project,
    type: conversation.type,
    url: conversation.url,
    isMainController: isMainControllerConversation(conversation),
    messageCount: messages.length,
    candidateCount: candidates.length,
  });
  allCandidates.push(...candidates);
}

const dedupedCandidates = dedupeCandidates(allCandidates)
  .sort((a, b) => b.score - a.score || new Date(b.latestTime || 0) - new Date(a.latestTime || 0));
const finalCandidates = candidateLimit ? dedupedCandidates.slice(0, candidateLimit) : dedupedCandidates;
const createResults = createTasks
  ? await createRebuiltTasks(finalCandidates)
  : { requested: false, created: 0, skipped: finalCandidates.length, results: [] };

const result = {
  ok: true,
  dryRun,
  archiveCurrent,
  createTasks,
  sourceDataSource: 'HOZO_CONVERSATIONS_DATA_SOURCE_ID',
  forbiddenSourceDataSource: 'HOZO_MESSAGES_DATA_SOURCE_ID',
  mode: 'full-conversation-master-rebuild-candidates',
  judgmentPolicy: {
    ...masterPromptPolicy,
    name: masterPromptPolicy.name || '',
    version: masterPromptPolicy.version || '',
    mainControllerConversationLast: true,
    mainControllerConversations: conversations
      .filter(isMainControllerConversation)
      .map((conversation) => conversation.name),
  },
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  snapshotPath,
  candidateJsonPath,
  candidateHtmlPath,
  counts: {
    totalTasks: tasks.length,
    activeTasksBeforeArchive: tasks.filter(isActiveTask).length,
    archivedTasks: archiveResults.archived,
    conversations: conversations.length,
    conversationMessages: conversationDetails.reduce((sum, item) => sum + item.messageCount, 0),
    rawCandidates: allCandidates.length,
    dedupedCandidates: dedupedCandidates.length,
    outputCandidates: finalCandidates.length,
    createdTasks: createResults.created,
  },
  archiveResults,
  createResults,
  conversations: conversationDetails,
  candidates: finalCandidates,
};

fs.writeFileSync(candidateJsonPath, JSON.stringify(result, null, 2), 'utf8');
fs.writeFileSync(candidateHtmlPath, renderHtml(result), 'utf8');

console.log(JSON.stringify({
  ok: true,
  dryRun,
  archiveCurrent,
  createTasks,
  snapshotPath,
  candidateJsonPath,
  candidateHtmlPath,
  counts: result.counts,
}, null, 2));

async function createRebuiltTasks(candidates) {
  const results = [];
  let created = 0;
  for (const candidate of candidates) {
    if (dryRun) {
      created += 1;
      results.push({ id: candidate.id, title: candidate.title, action: 'dry-run-create' });
      continue;
    }

    const properties = compactProperties({
      任務名稱: titleProperty(candidate.title),
      專案: selectProperty(candidate.project),
      狀態: selectProperty('待確認'),
      確認狀態: selectProperty('未確認'),
      優先級: selectProperty(candidate.priority),
      負責人: richTextProperty(candidate.owner, 500),
      來源: selectProperty('LINE'),
      下一步: richTextProperty(candidate.nextStep, 900),
      來源原文: richTextProperty(candidate.evidence, 1900),
      'Codex 判斷摘要': richTextProperty(buildCandidateJudgment(candidate), 1900),
      最後更新: dateProperty(new Date()),
      期限依據: richTextProperty('全量重建預設：待確認任務先由負責人補期限或由下一輪追蹤判斷。', 900),
      下次追蹤日: dateProperty(nextTaipeiDate(1)),
      逾期狀態: selectProperty('未逾期'),
      任務層級: selectProperty(candidate.taskLevel || '父任務'),
      階層判斷狀態: selectProperty('已判斷'),
      階層判斷時間: dateProperty(new Date()),
      信心等級: selectProperty(candidate.score >= 10 ? '高' : candidate.score >= 6 ? '中' : '低'),
      完成目標定義: richTextProperty(completionDefinitionForCandidate(candidate), 900),
      完成門檻: richTextProperty('事件線中的待確認、等待回覆、補資料或處理事項都有結論，並已把結果回填到任務紀錄。', 900),
      完成百分比: { number: candidate.status === '重建候選' ? 20 : 0 },
      事件線識別: richTextProperty(candidate.id, 500),
    });

    const page = await notionRequest('/v1/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: tasksDataSourceId },
        properties,
        children: rebuiltTaskBlocks(candidate),
      },
    });
    created += 1;
    results.push({ id: candidate.id, pageId: page.id, url: page.url, title: candidate.title, action: 'created' });
  }
  return { requested: true, created, skipped: candidates.length - created, results };
}

function buildCandidateJudgment(candidate) {
  return [
    `重建批次：${runId}`,
    `來源群組：${candidate.conversationName}`,
    `任務層級：${candidate.taskLevel || '父任務'}`,
    `判斷分數：${candidate.score}`,
    `成立理由：${candidate.reasons.join('、') || '對話中包含可追蹤事項'}`,
    `重建規則：${candidate.sourcePolicy}`,
  ].join('\n');
}

function rebuiltTaskBlocks(candidate) {
  const evidenceLines = candidate.evidence.split(/\n{2,}/).map((line) => line.trim()).filter(Boolean);
  return [
    headingBlock('任務控制紀錄', 2),
    paragraphBlock(`建立方式：${dryRun ? '試跑' : '全量重建'}｜批次：${runId}`),
    paragraphBlock(`來源對話群組：${candidate.conversationName}`),
    paragraphBlock(`關聯頁面：${candidate.conversationUrl || candidate.conversationName}`),
    headingBlock('任務判斷', 3),
    bulletedBlock(`任務類型：LINE 對話全量重建候選任務。`),
    bulletedBlock(`任務層級：${candidate.taskLevel || '父任務'}。`),
    bulletedBlock(`所屬專案：${candidate.project}`),
    bulletedBlock(`目前狀態：待確認；確認狀態：未確認。`),
    bulletedBlock(`責任判斷：${candidate.owner}`),
    bulletedBlock(`判斷理由：${candidate.reasons.join('、') || '對話內含可追蹤事項'}。`),
    headingBlock('證據與處理紀錄', 3),
    ...evidenceLines.flatMap((line) => lineArchiveBlocks(candidate, line)),
    ...(candidate.media.length ? [
      headingBlock('相關媒體與附件', 3),
      ...candidate.media.slice(0, 20).map((item) => bulletedBlock(`${item.type || 'media'}：${item.name || item.lineMessageId || item.url}`)),
    ] : []),
    headingBlock('下一步', 3),
    bulletedBlock(candidate.nextStep),
  ];
}

function completionDefinitionForCandidate(candidate) {
  const text = `${candidate.title}\n${candidate.evidence}`;
  if (/明義街46號2之2|發霉|燈不/.test(text)) return '完成到場查看，確認燈光不足與浴室發霉的處理方式，並回覆住客後續安排或完成結果。';
  if (/垃圾清運|元冠環保|清運廠商/.test(text)) return '確認可承接的垃圾清運廠商或替代清運方案，並把結果回覆給需要安排的人。';
  if (/弱電|資訊維修|費用|UOF/.test(text)) return '確認 UOF 表單、圖片與費用表是否足以核對弱電/資訊維修費用；不足則列出需補資料。';
  if (/層架|烘衣機|工資|開單/.test(text)) return '確認層架與烘衣機安裝項目、工資金額與是否可開單。';
  if (/發票|收據/.test(text)) return '確認房客端發票/收據開立紀錄的需求與公司設立後的實務做法。';
  if (/官方\s*LINE|管理員/.test(text)) return '確認指定人員是否已成功加入官方 LINE 管理員，並可執行後台管理。';
  if (/房客優惠|櫻桃|素材/.test(text)) return '取得或確認櫻桃房客優惠素材檔案，供新旅客入住推薦使用。';
  if (/排程|錯誤|Render|User UI|報告/.test(text)) return '確認系統錯誤原因，修復後以一次報告或 User UI 驗證結果證明恢復正常。';
  return '確認此事件線是否仍需追蹤，補齊負責人、期限與完成條件後執行到有明確結論。';
}

function lineArchiveBlocks(candidate, line) {
  const match = line.match(/^【(.+?)】(.+?)：([\s\S]*)$/);
  if (!match) return [paragraphBlock(line)];
  const type = inferArchiveType(match[3], candidate.media);
  const header = `【${match[1]}】${candidate.conversationName} - ${match[2]}（${type}）`;
  const body = normalizeEvidenceBody(match[3], candidate, type, match[1], match[2]);
  return [paragraphBlock(header), paragraphBlock(body)];
}

function inferArchiveType(text, media) {
  if (/媒體：/.test(text)) {
    if ((media || []).some((item) => item.type === 'image')) return '圖片訊息';
    if ((media || []).some((item) => ['file', 'pdf'].includes(item.type))) return '檔案訊息';
    return '媒體訊息';
  }
  return '文字訊息';
}

function normalizeEvidenceBody(text, candidate, type, timeText, actor) {
  const parsedTime = parseTaipeiDisplayTime(timeText);
  const evidenceDate = parsedTime ? new Date(parsedTime) : (candidate.latestTime ? new Date(candidate.latestTime) : null);
  const lines = [
    evidenceDate ? `日期：${formatDateOnly(evidenceDate)}` : '',
    evidenceDate ? `時間：${formatTimeOnly(evidenceDate)}` : '',
    `群組：${candidate.conversationName}`,
    `使用者：${actor || '未知發話者'}`,
    `訊息類型：${type.replace(/訊息$/, '')}`,
    `內容：${String(text || '').replace(/\n媒體：[\s\S]*$/, '').trim()}`,
  ].filter(Boolean);
  const mediaLine = String(text || '').match(/\n媒體：([\s\S]+)$/)?.[1]?.trim();
  if (mediaLine) lines.push(`媒體：${mediaLine}`);
  return lines.join('\n');
}

function nextTaipeiDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function formatDateOnly(date) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatTimeOnly(date) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

async function archiveActiveTasks(tasks) {
  const results = [];
  let archived = 0;
  for (const task of tasks) {
    if (!isActiveTask(task)) {
      results.push({ id: task.id, title: task.title, status: task.status, action: 'skipped' });
      continue;
    }

    const note = [
      `任務重建批次封存：${new Date().toISOString()}`,
      '原因：改用 LINE 對話主檔全量重建候選任務。',
      '本任務未刪除；原始欄位與頁面內容保留，可依 snapshot 或 Notion 歷史回復。',
    ].join('\n');

    if (!dryRun) {
      await notionRequest(`/v1/pages/${task.id}`, {
        method: 'PATCH',
        body: {
          properties: compactProperties({
            狀態: selectProperty('封存'),
            下一步: richTextProperty('已批次封存，等待 LINE 對話主檔全量重建候選任務確認。', 900),
            最後更新: dateProperty(new Date()),
          }),
        },
      });
      await appendArchiveNote(task.id, note);
    }

    archived += 1;
    results.push({ id: task.id, title: task.title, previousStatus: task.status, action: dryRun ? 'dry-run-archive' : 'archived' });
  }
  return { requested: true, archived, skipped: tasks.length - archived, results };
}

async function appendArchiveNote(pageId, note) {
  await notionRequest(`/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: {
      children: [
        headingBlock('任務重建封存紀錄', 2),
        paragraphBlock(note),
      ],
    },
  });
}

function buildConversationCandidates(conversation, messages) {
  const groups = new Map();
  for (const message of messages) {
    if (!message.text || isAssistantOperation(message) || isLowValueMessage(message.text)) continue;
    const score = scoreMessage(message.text);
    if (score < minScore) continue;

    const project = normalizeProjectName(conversation.project) || inferProject(`${conversation.name}\n${message.text}`);
    const eventKey = inferEventLineKey(conversation, message);
    const key = `${project}:${conversation.name}:${eventKey}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        project,
        topic: '',
        conversationName: conversation.name,
        conversationId: conversation.id,
        conversationUrl: conversation.url,
        type: conversation.type,
        firstTime: message.time,
        latestTime: message.time,
        speakers: new Set(),
        messages: [],
        score: 0,
        reasons: new Set(),
      });
    }
    const current = groups.get(key);
    if (!current.firstTime || timestampMs(message.time) < timestampMs(current.firstTime)) {
      current.firstTime = message.time;
    }
    current.latestTime = message.time || current.latestTime;
    if (message.actor) current.speakers.add(message.actor);
    current.messages.push(message);
    current.score += score;
    for (const reason of scoreReasons(message.text)) current.reasons.add(reason);
  }

  return [...groups.values()]
    .map((candidate) => {
      candidate.messages.sort((a, b) => timestampMs(a.time) - timestampMs(b.time));
      candidate.topic = inferEventLineTitle(candidate);
      return finalizeCandidate(candidate);
    })
    .filter((candidate) => !shouldSuppressCandidate(candidate));
}

function timestampMs(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function finalizeCandidate(candidate) {
  const evidenceMessages = candidate.messages.slice(-12);
  const sourceText = evidenceMessages.map((message) => {
    const time = message.time ? formatTaipeiDateTime(new Date(message.time)) : '未記錄時間';
    const mediaText = message.media?.length
      ? `\n媒體：${message.media.map((item) => item.lineMessageId || item.name || item.type).filter(Boolean).join('、')}`
      : '';
    return `【${time}】${message.actor || '未知'}：${message.text}${mediaText}`;
  }).join('\n\n');
  const media = dedupeMedia(evidenceMessages.flatMap((message) => message.media || []));
  const title = clampText(candidate.topic, 90);
  const project = projectForEventTitle(title) || normalizeProjectName(inferProject(`${title}\n${sourceText}`)) || candidate.project;
  const nextStep = inferNextStep(sourceText);
  return {
    id: hashText(`${candidate.key}:${candidate.firstTime}:${candidate.latestTime}:${sourceText.slice(0, 160)}`),
    title,
    project,
    status: '重建候選',
    confirmation: '待人工確認',
    priority: inferPriority(sourceText, candidate.score),
    owner: inferOwner([...candidate.speakers], sourceText),
    conversationName: candidate.conversationName,
    conversationId: candidate.conversationId,
    conversationUrl: candidate.conversationUrl,
    firstTime: candidate.firstTime,
    latestTime: candidate.latestTime,
    speakers: [...candidate.speakers],
    score: Math.min(candidate.score, 30),
    reasons: uniqueValues([...candidate.reasons].map((reason) => reason.label || String(reason)).filter(Boolean)),
    nextStep,
    evidence: sourceText,
    media,
    sourcePolicy: '從 LINE 對話主檔全量讀取；未讀取 LINE 訊息紀錄。',
    promptPolicyVersion: masterPromptPolicy.version || '',
    taskLevel: '父任務',
  };
}

function projectForEventTitle(title) {
  const text = String(title || '');
  if (/明義街46號2之2/.test(text)) return '住客服務與體驗管理';
  if (/垃圾清運/.test(text)) return '房務管理';
  if (/發票|收據/.test(text)) return '財務與帳務管理';
  if (/紙本合約|用印/.test(text)) return '公司治理';
  if (/弱電|資訊維修|費用佐證/.test(text)) return '財務與帳務管理';
  if (/層架|烘衣機|工資|開單/.test(text)) return '工務維修管理';
  if (/品牌|櫻桃|素材/.test(text)) return '品牌官網';
  if (/官方 LINE|管理員/.test(text)) return '自動化';
  return '';
}

function inferEventLineKey(conversation, message) {
  const haystack = `${conversation.name}\n${message.text}`;
  if (/明義街46號2之2|明義街.*2之2|燈不|發霉|星期四連絡|週四晚上19/.test(haystack)) return 'resident-maintenance-inspection';
  if (/層架|烘衣機|工資|開單/.test(haystack)) return 'shelving-dryer-installation-billing';
  if (/弱電|資訊維修|UOF|5\s*月|未先報價|費用/.test(haystack)) return 'weak-current-it-repair-cost-proof';
  if (/垃圾清運|元冠環保|沿街垃圾|清運廠商|路線問題/.test(haystack)) return 'garbage-collection-vendor';
  if (/紙本合約|用印|合約/.test(haystack)) return 'contract-stamp-and-signing';
  if (/發票|收據|包租代管業/.test(haystack)) return 'invoice-receipt-record';
  if (/官方\s*LINE|LINE 群組|管理員|manager\.line\.biz|HOGO|HOZO/.test(haystack)) return 'line-official-account-admin';
  if (/房客優惠|櫻桃|旅客入住|檔案可以提供|品牌設計/.test(haystack)) return 'guest-discount-material';
  if (/排程警告|Cannot access|HttpStatusError|webhook|Render|User UI|資料庫|Notion|Codex|報告/.test(haystack)) return 'automation-system-issue';
  if (/看房|總部|討論|近期事項|準備什麼資訊|修繕處理|備品/.test(haystack)) return 'operations-schedule-and-prep';
  return normalizeKey(inferTopic(message.text)).slice(0, 64) || 'conversation-event';
}

function inferEventLineTitle(candidate) {
  const text = candidate.messages.map((message) => message.text).join('\n');
  const conversation = candidate.conversationName;
  if (/明義街46號2之2|燈不|發霉|星期四連絡|週四晚上19/.test(`${conversation}\n${text}`)) {
    return '明義街46號2之2：浴室發霉與兩盞燈光不足到場查看';
  }
  if (/層架|烘衣機|工資|開單/.test(text)) return 'HOZO好住工務群組：層架與烘衣機安裝工資開單確認';
  if (/弱電|資訊維修|UOF|未先報價|費用/.test(text)) return 'HOZO好住工務群組：弱電與資訊維修費用佐證確認';
  if (/垃圾清運|元冠環保|沿街垃圾|清運廠商|路線問題/.test(text)) return 'HOZO好住公司設立協助：垃圾清運廠商尋找與替代方案';
  if (/紙本合約|用印|合約/.test(text)) return 'HOZO好住公司設立協助：紙本合約用印安排';
  if (/發票|收據|包租代管業/.test(text)) return 'HOZO 公司群：房客發票與收據開立紀錄需求確認';
  if (/官方\s*LINE|LINE 群組|管理員|manager\.line\.biz|HOGO|HOZO/.test(text)) return 'HOZO 公司群：官方 LINE 管理員加入確認';
  if (/房客優惠|櫻桃|旅客入住|檔案可以提供|品牌設計/.test(text)) return 'HOZO品牌設計：櫻桃房客優惠素材檔案取得';
  if (/排程警告|Cannot access|HttpStatusError|webhook|Render|User UI|資料庫|Notion|Codex|報告/.test(text)) return '自動化：HOZO AM 報告與系統錯誤追蹤';
  if (/看房|總部|討論|近期事項|準備什麼資訊|修繕處理|備品/.test(text)) return 'HOZO 公司群：總部討論與看房行程準備';
  return `${candidate.project}：${inferTopic(text)}`;
}

function shouldSuppressCandidate(candidate) {
  const text = candidate.evidence || '';
  if (!text.trim()) return true;
  if (/^\s*(?:\[[^\]]+\]\s*)?(?:\(非 message 事件\)|其他訊息)\s*$/i.test(text)) return true;
  if (!/(請|麻煩|協助|確認|安排|追蹤|提供|處理|開單|用印|發票|收據|報價|費用|問題|異常|錯誤|修繕|發霉|燈|清運|管理員|檔案|看房|討論|準備)/.test(text)) return true;
  return false;
}

function dedupeMedia(items) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const key = item.url || item.lineMessageId || item.name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function sortConversationsForJudgement(conversations) {
  return conversations
    .map((conversation, index) => ({ conversation, index, isMainController: isMainControllerConversation(conversation) }))
    .sort((a, b) => Number(a.isMainController) - Number(b.isMainController) || a.index - b.index)
    .map((item) => item.conversation);
}

function isMainControllerConversation(conversation) {
  return isMainControllerConversationName(conversation?.name || '');
}

function isMainControllerConversationName(name) {
  const normalizedName = normalizeControllerName(name);
  if (!normalizedName) return false;
  const aliases = getMainControllerAliases();
  return aliases.some((alias) => normalizedName.includes(normalizeControllerName(alias)));
}

function getMainControllerAliases() {
  const configured = masterPromptPolicy.mainControllerConversation?.projectNameBasedAliases || {};
  const aliases = Object.values(configured)
    .flat()
    .filter((alias) => alias && !String(alias).includes('{'));
  return [...new Set([
    ...aliases,
    'HOZO Junior',
    '7Junior',
    '7 Junior',
    'HOZO Jr.',
    '7 Jr.',
    'HOZO Junior',
    'HOZO Jr.',
  ])];
}

function normalizeControllerName(value) {
  return String(value || '').replace(/[.\s_-]+/g, '').toLowerCase();
}

function dedupeCandidates(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    const key = normalizeKey(candidate.title);
    const existing = seen.get(key);
    if (!existing || candidate.score > existing.score) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
}

function buildTaskSnapshot(tasks) {
  return {
    createdAt: new Date().toISOString(),
    source: 'HOZO AM total-control task database',
    purpose: 'Snapshot before batch archive and conversation-master full rebuild candidate generation.',
    taskCount: tasks.length,
    tasks: tasks.map((task) => ({
      id: task.id,
      url: task.url,
      title: task.title,
      project: task.project,
      status: task.status,
      confirmation: task.confirmation,
      priority: task.priority,
      owner: task.owner,
      dueDate: task.dueDate,
      nextStep: task.nextStep,
      source: task.source,
      updatedAt: task.updatedAt,
      rawSourcePreview: clampText(task.rawSource, 500),
      judgmentPreview: clampText(task.judgment, 500),
    })),
  };
}

function normalizeTask(page) {
  return {
    id: page.id,
    url: page.url,
    title: pageText(page, '任務名稱') || '(未命名任務)',
    project: pageSelect(page, '專案') || '',
    status: pageSelect(page, '狀態') || '',
    confirmation: pageSelect(page, '確認狀態') || '',
    priority: pageSelect(page, '優先級') || '',
    owner: pageText(page, '負責人') || '',
    dueDate: pageDate(page, '截止日') || '',
    nextStep: pageText(page, '下一步') || '',
    source: pageSelect(page, '來源') || '',
    rawSource: pageText(page, '來源原文') || '',
    judgment: pageText(page, 'Codex 判斷摘要') || '',
    updatedAt: pageDate(page, '最後更新') || page.last_edited_time || '',
  };
}

function normalizeConversation(page) {
  return {
    id: page.id,
    url: page.url,
    name: pageText(page, '自定義名稱') || pageText(page, 'LINE 對話名稱') || pageTitle(page) || '(未命名對話)',
    type: pageSelect(page, '對象類型') || '',
    project: pageSelect(page, '總控專案') || pageSelect(page, '關聯專案') || '',
    latestAt: pageDate(page, '最後訊息時間') || page.last_edited_time || '',
  };
}

function isActiveTask(task) {
  return !/^(封存|已封存|Archived)$/i.test(String(task.status || '').trim());
}

function parseConversationBlocks(conversation, blocks) {
  const messages = [];
  let current = null;
  for (const block of blocks) {
    const media = blockToMedia(block);
    if (media) {
      if (!current) {
        current = {
          timeText: '',
          conversationLabel: conversation.name,
          actor: '',
          type: media.type,
          source: 'line',
          contentLines: [],
          media: [],
        };
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
      source: outgoing[2].trim() === outgoingActorName ? 'ai-engine' : 'line',
    };
  }
  return null;
}

function finalizeMessage(conversation, meta, index) {
  const text = meta.contentLines.join('\n').trim();
  return {
    id: hashText(`${conversation.id}:${meta.timeText}:${meta.actor}:${index}:${text.slice(0, 80)}`),
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

function mediaNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    return name || '';
  } catch {
    return '';
  }
}

function scoreMessage(text) {
  return scoreReasons(text).reduce((sum, reason) => sum + reason.weight, 0);
}

function scoreReasons(text) {
  const value = String(text || '');
  const reasons = [];
  const checks = [
    ['明確交辦', 5, /(請|麻煩|幫我|協助|再幫|處理|安排|追蹤|確認|檢查|補|提供|寄|傳|發|聯絡|回覆|通知)/],
    ['期限或時間', 3, /(今天|明天|後天|本週|下週|月底|週[一二三四五六日天]|上午|下午|\d{1,2}[\/月]\d{1,2}|期限|到期|前)/],
    ['等待或卡點', 4, /(還沒|未完成|缺|卡住|卡點|等|等待|沒回|沒有回覆|問題|異常|失敗|錯誤|閃退|衝突)/],
    ['交付或承諾', 4, /(報價|估價|付款|請款|合約|設計圖|資料|文件|名單|報表|會議|測試|版本|log|發票|用印)/i],
    ['決策需求', 4, /(要不要|是否|可不可以|能不能|決定|確認一下|看一下|需要.*決策|怎麼做|怎麼處理)/],
    ['完成線索', 2, /(已經|完成|好了|ok|收到|處理完|已提供|已轉給|已發|已寄)/i],
  ];
  for (const [label, weight, pattern] of checks) {
    if (pattern.test(value)) reasons.push({ label, weight });
  }
  return reasons;
}

function inferTopic(text) {
  const clean = cleanText(text);
  const patterns = [
    /(請|麻煩|幫我|協助|再幫|需要|確認|安排|追蹤|提供|處理|補|寄|傳|發|聯絡|回覆|通知)([^。\n，,]{2,42})/,
    /([^。\n，,]{2,42})(報價|估價|付款|請款|合約|設計圖|資料|文件|名單|報表|會議|測試|版本|log|發票|用印)/i,
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) return clampText(cleanText(match[0]), 48);
  }
  return clampText(clean, 48) || 'LINE 對話待確認事項';
}

function inferProject(text) {
  const value = String(text || '');
  if (/LINE|Notion|Codex|API|webhook|Render|User UI|自動化|機器人|系統|資料庫|權限|同步|測試|部署|token|OA|CRM/i.test(value)) return '自動化';
  if (/品牌|官網|設計|素材|Logo|網站|行銷|照片|文案|Google|地圖|SEO|房客優惠|櫻桃/i.test(value)) return '品牌官網';
  if (/公司設立|紙本合約|合約用印|用印|股東|章程|人事|員工|薪資|制度|法務|政府|申請|登記/.test(value)) return '公司治理';
  if (/垃圾清運|清運廠商|沿街垃圾|元冠環保|清潔|房務|打掃|退房|入住整理|備品|床單|棉被|發霉|除霉|環保/.test(value)) return '房務管理';
  if (/發票|收據|請款|付款|匯款|帳|財務|會計|報稅|稅|銀行|租金|費用|報價|估價|用印/.test(value)) return '財務與帳務管理';
  if (/弱電|維修|修繕|漏水|水電|冷氣|網路|設備|施工|工程|開單|路線|修理|層架|烘衣機/.test(value)) return '工務維修管理';
  if (/住客|旅客|客人|入住|退房|客服|投訴|客訴|回覆客人|明義街|會館|房客/.test(value)) return '住客服務與體驗管理';
  if (/新據點|裝修|建置|驗收|消防|基礎建置|裝潢|場域|施工排程/.test(value)) return '工程建置管理';
  if (/交接|SOP|營運|資料|文件|表單|名單|課程|討論|會議|準備|提供給/.test(value)) return '營運和資料交接';
  return '未分類';
}

function normalizeProjectName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const aliases = {
    財務: '財務與帳務管理',
    營運: '營運和資料交接',
    工務: '工務維修管理',
    維修: '工務維修管理',
    房務: '房務管理',
    品牌: '品牌官網',
    官網: '品牌官網',
    自動化: '自動化',
    人資: '公司治理',
    公司: '公司治理',
  };
  return aliases[text] || text;
}

function inferPriority(text, score) {
  if (/今天|明天|緊急|立刻|馬上|逾期|失敗|閃退|付款|請款|合約|法律|稅/.test(text) || score >= 12) return '高';
  if (score >= 7) return '中';
  return '低';
}

function inferOwner(speakers, text) {
  const mention = String(text || '').match(/@([^\s，,。:：]+)/);
  if (mention) return mention[1].trim();
  return speakers.find((speaker) => !/HOZO Jr|Junior|助理|AI/i.test(speaker)) || '待指定';
}

function inferNextStep(text) {
  if (/等|等待|沒回|沒有回覆/.test(text)) return '確認等待對象與預計回覆時間，必要時安排追蹤提醒。';
  if (/確認|看一下|可不可以|能不能|是否/.test(text)) return '由負責人確認判斷結果，決定是否轉成正式任務。';
  if (/提供|補|寄|傳|發/.test(text)) return '確認需要補齊或交付的資料，指定負責人與期限。';
  if (/報價|估價/.test(text)) return '確認報價/估價所需資料是否完整，追蹤對方回覆。';
  return '請人工確認此候選是否仍有效，若有效再補負責人、期限與完成條件。';
}

function isAssistantOperation(message) {
  const text = String(message.text || '');
  if (message.source === 'ai-engine') return true;
  return /(查待辦|列出.*待辦|打開第\s*\d+|看一下目前任務|早報|每日報告|任務校準|User UI|重載|重新整理)/i.test(text);
}

function isLowValueMessage(text) {
  const value = cleanText(text);
  if (value.length < 4) return true;
  if (/^(ok|OK|收到|好|好的|了解|謝謝|感謝|哈哈|哈|嗯|是|不是|對|可以|沒問題)[。！!]*$/i.test(value)) return true;
  if (/^(貼圖|圖片|影片|語音|檔案)$/i.test(value)) return true;
  if (/^(test|t\s*e\s*s\s*t|測試|hello|hi|哈囉|再測試一次)$/i.test(value)) return true;
  if (/^t\s*e\s*s\s*t\b/i.test(value)) return true;
  if (/入站測試|AS Line群組名稱|服務已重新啟動|這是.*測試|測試訊息|User UI|查待辦|列出.*待辦/i.test(value)) return true;
  if (/^(好呦|好的)?[～~，,\s]*我再確認[，,\s]*(謝謝|感謝)?[！!。]*$/.test(value)) return true;
  return false;
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

async function getBlockChildren(blockId) {
  const results = [];
  let startCursor;
  do {
    const cursor = startCursor ? `&start_cursor=${encodeURIComponent(startCursor)}` : '';
    const result = await notionRequest(`/v1/blocks/${blockId}/children?page_size=100${cursor}`);
    results.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : undefined;
  } while (startCursor);
  return results;
}

async function notionRequest(endpoint, { method = 'GET', body } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`https://api.notion.com${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${notionToken}`,
        'Notion-Version': notionVersion,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    if (response.ok) return json;
    lastError = new Error(`${endpoint} ${response.status}: ${json.message || 'Notion request failed'}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 4) break;
    await sleep(750 * attempt);
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (prop.type === 'number') return prop.number == null ? '' : String(prop.number);
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

function richText(value) {
  return (value || []).map((item) => item.plain_text || '').join('').trim();
}

function blockText(block) {
  const type = block.type;
  const value = block[type];
  if (!value) return '';
  return richText(value.rich_text || value.text || value.title || []);
}

function titleProperty(content) {
  return { title: [{ type: 'text', text: { content: String(content || '').slice(0, 2000) } }] };
}

function richTextProperty(content, limit = 2000) {
  return { rich_text: [{ type: 'text', text: { content: String(content || '').slice(0, limit) } }] };
}

function selectProperty(name) {
  return name ? { select: { name } } : undefined;
}

function dateProperty(value) {
  const date = value instanceof Date ? value.toISOString() : String(value || '');
  return date ? { date: { start: date } } : undefined;
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function paragraphBlock(content) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: String(content || '').slice(0, 2000) } }] },
  };
}

function bulletedBlock(content) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: String(content || '').slice(0, 2000) } }] },
  };
}

function headingBlock(content, level = 2) {
  const type = level === 3 ? 'heading_3' : level === 1 ? 'heading_1' : 'heading_2';
  return {
    object: 'block',
    type,
    [type]: { rich_text: [{ type: 'text', text: { content: String(content || '').slice(0, 2000) } }] },
  };
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

function minutesBetween(a, b) {
  const first = new Date(a || 0).getTime();
  const second = new Date(b || 0).getTime();
  if (!first || !second) return 0;
  return Math.abs(second - first) / 60000;
}

function hashText(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function normalizeKey(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, '');
}

function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function cleanText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(value, max) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

function numberArg(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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

function loadJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`Could not load JSON policy ${filePath}: ${error.message}`);
    return {};
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderHtml(result) {
  const rows = result.candidates.map((candidate, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(candidate.title)}</strong><br><span>${escapeHtml(candidate.nextStep)}</span></td>
      <td>${escapeHtml(candidate.project)}</td>
      <td>${escapeHtml(candidate.priority)}</td>
      <td>${escapeHtml(candidate.owner)}</td>
      <td><a href="${escapeHtml(candidate.conversationUrl)}">${escapeHtml(candidate.conversationName)}</a></td>
      <td>${escapeHtml(candidate.speakers.join(', '))}</td>
      <td>${escapeHtml(candidate.latestTime ? formatTaipeiDateTime(new Date(candidate.latestTime)) : '')}</td>
      <td><pre>${escapeHtml(candidate.evidence)}</pre></td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HOZO AM LINE 對話主檔全量重建候選任務</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #1f2933; background: #f7f8fa; }
    h1 { font-size: 24px; margin: 0 0 12px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 16px 0 22px; }
    .metric { background: #fff; border: 1px solid #d9dee7; padding: 12px; border-radius: 8px; }
    .metric b { display: block; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { border: 1px solid #d9dee7; padding: 8px; vertical-align: top; font-size: 13px; }
    th { background: #edf1f7; text-align: left; }
    pre { white-space: pre-wrap; margin: 0; max-width: 520px; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>HOZO AM LINE 對話主檔全量重建候選任務</h1>
  <p>來源規則：只讀 LINE 對話主檔，不讀 LINE 訊息紀錄。候選任務尚未寫入正式任務庫。</p>
  <p>判斷規範：${escapeHtml(result.judgmentPolicy.name || 'Conversation-to-task event-line judgment')} / ${escapeHtml(result.judgmentPolicy.version || '未標示版本')}；主控群組最後分析。</p>
  <div class="summary">
    <div class="metric"><span>封存舊任務</span><b>${result.counts.archivedTasks}</b></div>
    <div class="metric"><span>掃描對話</span><b>${result.counts.conversations}</b></div>
    <div class="metric"><span>掃描訊息</span><b>${result.counts.conversationMessages}</b></div>
    <div class="metric"><span>候選任務</span><b>${result.counts.outputCandidates}</b></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>候選任務</th><th>專案</th><th>優先</th><th>負責人</th><th>對話</th><th>發言者</th><th>最新時間</th><th>來源證據</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

