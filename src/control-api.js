import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';

loadDotenv();

const originalCreateServer = http.createServer.bind(http);

const TASKS_DATA_SOURCE_ID = process.env.HOZO_TASKS_DATA_SOURCE_ID || '';
const RISK_DECISIONS_DATA_SOURCE_ID = process.env.HOZO_RISK_DECISIONS_DATA_SOURCE_ID || '';
const ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID = process.env.HOZO_ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID || '';
const CODEX_COMMANDS_DATA_SOURCE_ID = process.env.HOZO_CODEX_COMMANDS_DATA_SOURCE_ID || '';
const DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID = process.env.HOZO_DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID || '';
const JUDGMENT_RULES_DATA_SOURCE_ID = process.env.HOZO_JUDGMENT_RULES_DATA_SOURCE_ID || '';
const CONVERSATIONS_DATA_SOURCE_ID = process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID || '';
const MESSAGES_DATA_SOURCE_ID = process.env.HOZO_MESSAGES_DATA_SOURCE_ID || '';
const RESPONSIBILITY_DATA_SOURCE_ID = process.env.HOZO_RESPONSIBILITY_DATA_SOURCE_ID || '';
const OUTGOING_ACTOR_NAME = process.env.HOZO_OUTGOING_ACTOR_NAME || 'HOZO Jr.';
const HOZO_DATA_SOURCE_PARENT_BLOCK_ID = normalizeId(process.env.HOZO_DATA_SOURCE_PARENT_BLOCK_ID || '35f51c68-6dac-805f-88b4-e1cf5a86bbc1');
const HOZO_DATA_SOURCE_PARENT_PAGE_ID = normalizeId(process.env.HOZO_DATA_SOURCE_PARENT_PAGE_ID || '35d51c68-6dac-802c-81e6-c71b560c0498');
const verifiedHozoDataSources = new Map();
const dailyConversationProjectCache = new Map();
const CONVERSATION_ANCHOR_TEXT = '【HOZO LINE】對話記錄';
const CONVERSATION_ANCHOR_PATTERN = /對話記錄(?:（最新在最上方）)?/;
const OUTGOING_BLOCK_COLOR = 'orange';
const PUBLIC_BASE_URL = (process.env.HOZO_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const CODEX_COMMAND_TRIGGERS = buildCodexCommandTriggers(process.env.HOZO_CODEX_COMMAND_TRIGGERS || 'HOZO Junior,HOZ Jr.,HOZO Jr.');
const REPORT_ROUTES = new Map([
  ['/reports/morning-brief', '../reports/morning-brief-prototype.html'],
  ['/reports/morning-brief-prototype.html', '../reports/morning-brief-prototype.html'],
  ['/reports/daily-control-report', '../reports/daily-control-report-prototype.html'],
  ['/reports/daily-control-report-prototype.html', '../reports/daily-control-report-prototype.html'],
  ['/reports/followup-confirmation', '../reports/followup-confirmation-prototype.html'],
  ['/reports/followup-confirmation-prototype.html', '../reports/followup-confirmation-prototype.html'],
]);

http.createServer = function createServerWithControlApi(listener) {
  return originalCreateServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && REPORT_ROUTES.has(pathname)) {
      return serveReportPage(res, pathname);
    }

    if (pathname.startsWith('/control/')) {
      return handleControlRequest(req, res, pathname);
    }

    return listener(req, res);
  });
};

async function handleControlRequest(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    return sendNoContent(res);
  }

  if (req.method === 'GET' && pathname === '/control/health') {
    return sendJson(res, 200, {
      ok: true,
      controlApiEnabled: Boolean(process.env.HOZO_CONTROL_API_KEY),
      linePushEnabled: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      approvalWriteBackEnabled: Boolean(process.env.NOTION_TOKEN),
      approvalAcknowledgementEnabled: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      outgoingMessageLoggingEnabled: Boolean(process.env.NOTION_TOKEN && CONVERSATIONS_DATA_SOURCE_ID && MESSAGES_DATA_SOURCE_ID),
      defaultReportTargetConfigured: Boolean(process.env.HOZO_REPORT_TARGET_ID),
      defaultReportCcConfigured: Boolean(process.env.HOZO_REPORT_CC_TARGET_IDS || process.env.HOZO_REPORT_CC_NAME_KEYWORDS || 'Seven陳聖文'),
      defaultReportTargetAutoResolveEnabled: Boolean(process.env.NOTION_TOKEN && process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID),
      codexCommandQueueConfigured: Boolean(CODEX_COMMANDS_DATA_SOURCE_ID),
      dailyReportSnapshotsConfigured: Boolean(DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID),
      judgmentRulesConfigured: Boolean(JUDGMENT_RULES_DATA_SOURCE_ID),
      userUiLoginEnabled: Boolean(process.env.HOZO_USER_UI_USERNAME && process.env.HOZO_USER_UI_PASSWORD),
      reportTypes: ['morning', 'daily', 'followup-morning', 'followup-midday', 'followup-afternoon'],
      endpoints: ['POST /control/line/push', 'POST /control/reports/send', 'POST /control/reports/preview', 'POST /control/reports/approve', 'POST /control/codex-commands/test', 'POST /control/tasks/update', 'POST /control/judgment-rules/create'],
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    if (pathname === '/control/reports/approve') {
      const body = await readJsonBody(req);
      const result = await approveReport(req, body);
      return sendJson(res, 200, result);
    }

    if (!isAuthorized(req) && !isUserUiAuthorized(req)) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const body = await readJsonBody(req);

    if (pathname === '/control/line/push') {
      const result = await pushLineMessages(req, body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/control/reports/send') {
      const result = await sendReport(req, body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/control/reports/preview') {
      const result = await previewReport(body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/control/codex-commands/test') {
      const result = await createCodexCommandTest(body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/control/tasks/update') {
      const result = await updateTaskFromUserUi(req, body);
      return sendJson(res, 200, result);
    }

    if (pathname === '/control/judgment-rules/create') {
      const result = await createJudgmentRuleFromUserUi(req, body);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
}

async function createCodexCommandTest(body) {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set.');
  }
  if (!CODEX_COMMANDS_DATA_SOURCE_ID) {
    throw new Error('HOZO_CODEX_COMMANDS_DATA_SOURCE_ID is not set.');
  }

  const now = new Date();
  const originalText = String(body.text || body.originalText || `${OUTGOING_ACTOR_NAME} 測試 Command Queue：請回覆我你已成功收到這個測試命令。`).trim();
  const trigger = findCodexCommandTrigger(originalText);
  const commandText = extractCodexCommand(originalText);
  const sourceType = String(body.sourceType || body.targetType || 'user').trim();
  const sourceId = String(body.sourceId || body.targetId || process.env.HOZO_REPORT_TARGET_ID || '').trim();
  const lineMessageId = String(body.lineMessageId || `control-test-${now.getTime()}`).trim();
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : now;

  const page = await notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: CODEX_COMMANDS_DATA_SOURCE_ID },
      properties: compactProperties({
        Name: titleProperty(commandText || originalText),
        Status: selectProperty('Pending'),
        Trigger: richTextProperty(trigger?.label || 'Manual Test'),
        Command: richTextProperty(commandText),
        'Original Text': richTextProperty(originalText),
        'Source Type': selectProperty(sourceType),
        'Source ID': richTextProperty(sourceId),
        'User ID': richTextProperty(sourceType === 'user' ? sourceId : String(body.userId || '')),
        'Conversation Name': richTextProperty(String(body.conversationName || `${OUTGOING_ACTOR_NAME} control test`)),
        'Actor Name': richTextProperty(String(body.actorName || '陸昱晴')),
        'Conversation Key': richTextProperty(`${sourceType}:${sourceId}`),
        'LINE Message ID': richTextProperty(lineMessageId),
        'LINE Event ID': richTextProperty(String(body.lineEventId || `control-test-event-${now.getTime()}`)),
        'Message Page URL': body.messagePageUrl ? urlProperty(String(body.messagePageUrl)) : undefined,
        'Conversation Page URL': body.conversationPageUrl ? urlProperty(String(body.conversationPageUrl)) : undefined,
        'Received At': dateProperty(receivedAt),
        'Risk Level': selectProperty(resolveCommandRiskLevel(commandText || originalText)),
        'Raw Event': richTextProperty(JSON.stringify({
          source: 'control-api-test',
          originalText,
          sourceType,
          sourceId,
          lineMessageId,
          createdAt: now.toISOString(),
        })),
      }),
      children: [
        paragraphProperty(`Trigger: ${trigger?.label || 'Manual Test'}`),
        paragraphProperty(`Command: ${commandText || '(no command text after trigger)'}`),
        paragraphProperty(`Source: ${sourceType} ${sourceId}`.trim()),
      ],
    },
  });

  return {
    ok: true,
    pageId: page.id,
    url: page.url,
    status: 'Pending',
    trigger: trigger?.label || 'Manual Test',
    command: commandText,
    sourceType,
    sourceId,
    lineMessageId,
  };
}

async function createJudgmentRuleFromUserUi(req, body) {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set.');
  }
  if (!JUDGMENT_RULES_DATA_SOURCE_ID) {
    throw new Error('HOZO_JUDGMENT_RULES_DATA_SOURCE_ID is not set.');
  }

  const name = stringOrEmpty(body.name || body.ruleName);
  const preferred = stringOrEmpty(body.preferred || body.preferredJudgment);
  if (!name) {
    throw new Error('規則名稱不可空白。');
  }
  if (!preferred) {
    throw new Error('應該怎麼判斷不可空白。');
  }

  const now = new Date();
  const editedBy = resolveUserUiEditor(req, body);
  const appliesTo = normalizeMultiSelect(body.appliesTo || 'HOZO_AM');
  const category = stringOrEmpty(body.category || 'Task extraction') || 'Task extraction';
  const status = stringOrEmpty(body.status || 'Needs review') || 'Needs review';
  const triggerPattern = stringOrEmpty(body.triggerPattern);
  const avoided = stringOrEmpty(body.avoided || body.avoidedJudgment);
  const reason = stringOrEmpty(body.reason);
  const exceptions = stringOrEmpty(body.exceptions);
  const checklistPlacement = stringOrEmpty(body.checklistPlacement || 'Manual task judgment rules');
  const sourceNote = `User UI 手動新增｜${formatTaipeiDateTime(now)}｜${editedBy}`;

  const page = await notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: JUDGMENT_RULES_DATA_SOURCE_ID },
      properties: compactProperties({
        'Rule Name': titleProperty(name),
        Status: selectProperty(status),
        'Applies To': multiSelectProperty(appliesTo),
        'Preferred Judgment': richTextProperty(preferred),
        'Avoided Judgment': avoided ? richTextProperty(avoided) : undefined,
        Reason: reason ? richTextProperty(reason) : undefined,
        'Trigger Pattern': triggerPattern ? richTextProperty(triggerPattern) : undefined,
        Exceptions: exceptions ? richTextProperty(exceptions) : undefined,
        'Checklist Placement': checklistPlacement ? selectProperty(checklistPlacement) : undefined,
        'Last Verified': dateProperty(now),
        'Source Case Count': numberProperty(0),
      }),
      children: [
        paragraphProperty(`【手動加入任務判斷規則】${sourceNote}`),
        paragraphProperty(`規則：${name}`),
        paragraphProperty(`類別：${category}`),
        paragraphProperty(`應該怎麼判斷：${preferred}`),
        avoided ? paragraphProperty(`避免：${avoided}`) : undefined,
        reason ? paragraphProperty(`原因：${reason}`) : undefined,
        triggerPattern ? paragraphProperty(`觸發條件：${triggerPattern}`) : undefined,
        exceptions ? paragraphProperty(`例外：${exceptions}`) : undefined,
      ].filter(Boolean),
    },
  });

  return {
    ok: true,
    pageId: page.id,
    url: page.url,
    name,
    status,
    appliesTo,
    createdBy: editedBy,
    createdAt: now.toISOString(),
  };
}

async function updateTaskFromUserUi(req, body) {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set.');
  }

  const pageId = normalizeId(body.pageId || body.taskPageId || body.id);
  if (!pageId) {
    throw new Error('Task page id is required.');
  }

  const page = await assertTaskPage(pageId);
  const submittedAt = new Date();
  const updates = body.updates && typeof body.updates === 'object' ? body.updates : body;
  const editedBy = stringOrEmpty(updates.editedBy || updates.editor || updates.userName) || 'User UI 使用者';
  const properties = compactProperties({
    狀態: taskPropertyUpdate(page, '狀態', normalizeOptionalTaskStatus(updates.status)),
    確認狀態: taskPropertyUpdate(page, '確認狀態', stringOrEmpty(updates.confirmation)),
    負責人: taskPropertyUpdate(page, '負責人', stringOrEmpty(updates.owner)),
    下一步: taskPropertyUpdate(page, '下一步', stringOrEmpty(updates.next)),
    優先級: taskPropertyUpdate(page, '優先級', stringOrEmpty(updates.priority)),
    優先順序: taskPropertyUpdate(page, '優先順序', stringOrEmpty(updates.priority)),
    截止日: taskPropertyUpdate(page, '截止日', stringOrEmpty(updates.dueDate)),
    期限依據: taskPropertyUpdate(page, '期限依據', stringOrEmpty(updates.deadlineBasis)),
    下次追蹤日: taskPropertyUpdate(page, '下次追蹤日', stringOrEmpty(updates.nextFollowupDate)),
    逾期狀態: taskPropertyUpdate(page, '逾期狀態', stringOrEmpty(updates.overdueStatus)),
    'Codex 判斷摘要': taskPropertyUpdate(page, 'Codex 判斷摘要', stringOrEmpty(updates.judgment)),
    來源原文: taskPropertyUpdate(page, '來源原文', stringOrEmpty(updates.rawSource)),
    最後更新: page.properties?.最後更新 ? dateProperty(submittedAt) : undefined,
  });

  if (!Object.keys(properties).length && !stringOrEmpty(updates.editNote) && !stringOrEmpty(updates.pageContent)) {
    throw new Error('No supported task fields were provided.');
  }

  if (Object.keys(properties).length) {
    await notionRequest(`/v1/pages/${pageId}`, {
      method: 'PATCH',
      body: { properties },
    });
  }

  const editNote = stringOrEmpty(updates.editNote);
  const pageContent = stringOrEmpty(updates.pageContent);
  const children = [];
  if (editNote) {
    children.push(paragraphProperty(`【User UI 編輯】${formatTaipeiDateTime(submittedAt)}｜編輯者：${editedBy}｜${editNote}`));
  }
  if (pageContent) {
    children.push(paragraphProperty(`【User UI 頁面內容更新】${formatTaipeiDateTime(submittedAt)}｜編輯者：${editedBy}`));
    children.push(paragraphProperty(pageContent));
  }
  if (children.length) {
    await notionRequest(`/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children },
    });
  }

  return {
    ok: true,
    pageId,
    url: page.url,
    updatedProperties: Object.keys(properties),
    noteAppended: Boolean(editNote),
    pageContentAppended: Boolean(pageContent),
    editedBy,
    updatedAt: submittedAt.toISOString(),
  };
}

function resolveUserUiEditor(req, updates) {
  const bodyEditor = stringOrEmpty(updates.editedBy || updates.editor || updates.userName);
  if (bodyEditor) {
    return bodyEditor;
  }

  const basicUser = parseBasicAuth(req)?.username;
  return basicUser || 'User UI 使用者';
}

async function assertTaskPage(pageId) {
  const page = await notionFetchJson(`/v1/pages/${pageId}`);
  const parentId = normalizeId(page.parent?.data_source_id || page.parent?.database_id || '');
  if (parentId !== normalizeId(TASKS_DATA_SOURCE_ID)) {
    throw new Error('Blocked Notion access: page is not in the HOZO AM task data source.');
  }
  return page;
}

function taskPropertyUpdate(page, propertyName, value) {
  const property = page.properties?.[propertyName];
  if (!property) {
    return undefined;
  }

  const text = stringOrEmpty(value);
  if (!text) {
    return undefined;
  }

  if (property.type === 'status') {
    return { status: { name: text } };
  }
  if (property.type === 'select') {
    return selectProperty(text);
  }
  if (property.type === 'multi_select') {
    return { multi_select: text.split(/[,，、]/).map((name) => ({ name: name.trim() })).filter((item) => item.name) };
  }
  if (property.type === 'rich_text') {
    return richTextProperty(text);
  }
  if (property.type === 'title') {
    return titleProperty(text);
  }
  if (property.type === 'url') {
    return urlProperty(text);
  }
  if (property.type === 'date') {
    return { date: { start: text } };
  }
  if (property.type === 'number') {
    const number = Number(text);
    return Number.isFinite(number) ? { number } : undefined;
  }
  if (property.type === 'checkbox') {
    return checkboxProperty(/^(true|yes|1|是|已|完成)$/i.test(text));
  }

  return undefined;
}

function normalizeOptionalTaskStatus(value) {
  const status = stringOrEmpty(value);
  return status ? normalizeTaskStatus(status) : '';
}

function stringOrEmpty(value) {
  return String(value || '').trim();
}

function normalizeMultiSelect(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[,，、]/);
  return [...new Set(values.map((item) => stringOrEmpty(item)).filter(Boolean))];
}

function findCodexCommandTrigger(text) {
  const value = String(text || '');
  return CODEX_COMMAND_TRIGGERS.find((trigger) => trigger.pattern.test(value)) || null;
}

function buildCodexCommandTriggers(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((label) => ({
      label,
      pattern: new RegExp(escapeRegex(label).replace(/\\\s+/g, '\\s+'), 'i'),
    }));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCodexCommand(text) {
  const value = String(text || '').trim();
  const trigger = findCodexCommandTrigger(value);
  if (!trigger) {
    return value;
  }
  return value.replace(trigger.pattern, '').replace(/^[\s:：,，。-]+/, '').trim();
}

function resolveCommandRiskLevel(text) {
  const value = String(text || '').toLowerCase();
  const highRiskTerms = ['contract', 'legal', 'tax', 'salary', 'payment', 'invoice', 'fire ', 'terminate', '合約', '法律', '稅', '薪資', '付款', '匯款', '發票', '解僱', '資遣', '報價'];
  return highRiskTerms.some((term) => value.includes(term)) ? 'High' : 'Normal';
}

function isAuthorized(req) {
  const expected = process.env.HOZO_CONTROL_API_KEY;
  if (!expected) {
    return false;
  }

  const headerKey = req.headers['x-hozo-control-key'];
  const authorization = req.headers.authorization || '';
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
  return headerKey === expected || bearerToken === expected;
}

function isUserUiAuthorized(req) {
  const expectedUsername = process.env.HOZO_USER_UI_USERNAME;
  const expectedPassword = process.env.HOZO_USER_UI_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    return false;
  }

  const credentials = parseBasicAuth(req);
  return credentials?.username === expectedUsername && credentials.password === expectedPassword;
}

function parseBasicAuth(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function isApprovalAuthorized(req, body) {
  const expected = process.env.HOZO_REPORT_APPROVAL_KEY;
  if (!expected) {
    return true;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');
  const headerKey = req.headers['x-hozo-approval-key'];
  const queryKey = url.searchParams.get('approvalKey');
  const bodyKey = body.approvalKey;
  return headerKey === expected || queryKey === expected || bodyKey === expected;
}

async function approveReport(req, body) {
  if (!process.env.NOTION_TOKEN) {
    throw new Error('NOTION_TOKEN is not set.');
  }

  if (!isApprovalAuthorized(req, body)) {
    throw new Error('Approval key is invalid.');
  }

  const reportType = String(body.reportType || 'daily').trim().toLowerCase();
  const approvedBy = String(body.approvedBy || '陸昱晴').trim();
  const submittedAt = body.submittedAt ? new Date(body.submittedAt) : new Date();
  const tasks = normalizeApprovalList(body.tasks);
  const attachments = normalizeApprovalList(body.attachments);
  const reportContent = String(body.reportContent || body.editedReport || '').trim();
  const decisions = normalizeApprovalList(body.decisions);
  const followups = normalizeApprovalList(body.followups);

  const taskResults = [];
  for (const item of tasks) {
    taskResults.push(await applyTaskApproval(item, { reportType, approvedBy, submittedAt }));
  }

  const attachmentResults = [];
  for (const item of attachments) {
    attachmentResults.push(await createAttachmentConversionApproval(item, { reportType, approvedBy, submittedAt }));
  }

  const decisionPage = await createApprovalDecisionPage({
    reportType,
    approvedBy,
    submittedAt,
    taskResults,
    attachmentResults,
    reportContent,
    decisions,
    followups,
    notes: body.notes,
  });
  const snapshotUpdate = await maybeMarkDailyReportSnapshotConfirmed({
    reportType,
    decisionPage,
    submittedAt,
  });
  const acknowledgement = await sendReportApprovalAcknowledgement(body, {
    reportType,
    approvedBy,
    submittedAt,
    taskResults,
    attachmentResults,
    decisions,
    followups,
    decisionPage,
  });

  return {
    ok: true,
    reportType,
    decisionPageId: decisionPage.id,
    acknowledgement,
    tasksWritten: taskResults.length,
    attachmentsWritten: attachmentResults.length,
    snapshotUpdate,
    taskResults,
    attachmentResults,
  };
}

async function sendReportApprovalAcknowledgement(body, context) {
  if (body.sendAcknowledgement === false || body.acknowledgement === false) {
    return { ok: false, skipped: true, reason: 'disabled-by-request' };
  }

  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    return { ok: false, skipped: true, reason: 'LINE_CHANNEL_ACCESS_TOKEN is not set.' };
  }

  try {
    const targets = await resolveAcknowledgementTargets(body);
    if (!targets.length) {
      return { ok: false, skipped: true, reason: 'No acknowledgement target found.' };
    }

    const message = buildApprovalAcknowledgementMessage(context);
    const result = await pushToTargets(targets, [message]);
    return { ok: true, targets: result.results || [], message: message.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to send report approval acknowledgement: ${message}`);
    return { ok: false, error: message };
  }
}

async function resolveAcknowledgementTargets(body) {
  const ackTargets = normalizeTargets(body.ackTargets || body.acknowledgementTargets, body.ackTargetId, body.ackTargetType);
  if (ackTargets.length) {
    return ackTargets;
  }

  return resolveReportTargets({
    targets: body.targets,
    targetId: body.targetId,
    targetType: body.targetType,
  });
}

function buildApprovalAcknowledgementMessage({ reportType, approvedBy, submittedAt, taskResults, attachmentResults, decisions, followups, decisionPage }) {
  const label = reportTypeLabel(reportType);
  const lines = [
    `${OUTGOING_ACTOR_NAME} 已收到你送出的${label}確認。`,
    `確認人：${approvedBy}`,
    `時間：${formatTaipeiDateTime(submittedAt)}`,
  ];

  const summary = [];
  if (decisions.length) summary.push(`決策 ${decisions.length} 項`);
  if (followups.length) summary.push(`追蹤 ${followups.length} 項`);
  if (taskResults.length) summary.push(`任務 ${taskResults.length} 項`);
  if (attachmentResults.length) summary.push(`附件 ${attachmentResults.length} 項`);

  lines.push(summary.length ? `已寫入：${summary.join('、')}` : '已寫入：本次確認紀錄');

  if (decisionPage?.url) {
    lines.push(`Notion 紀錄：${decisionPage.url}`);
  }

  lines.push('我會依照這次確認結果更新後續追蹤。');

  return { type: 'text', text: clampLineText(lines.join('\n')) };
}

function reportTypeLabel(reportType) {
  const labels = {
    morning: '早報',
    'morning-brief': '早報',
    daily: '每日總控報告',
    evening: '每日總控報告',
    night: '每日總控報告',
    'followup-morning': '10:00 目標追認與新任務確認',
    'followup-midday': '13:00 目標追認與新任務確認',
    'followup-afternoon': '17:00 目標追認與新任務確認',
    'followup-10': '10:00 目標追認與新任務確認',
    'followup-13': '13:00 目標追認與新任務確認',
    'followup-17': '17:00 目標追認與新任務確認',
  };
  return labels[String(reportType || '').trim().toLowerCase()] || `${reportType || '報告'}報告`;
}

function normalizeApprovalList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

async function applyTaskApproval(item, context) {
  const taskName = String(item.task || item.name || '').trim();
  if (!taskName) {
    throw new Error('Task approval is missing task name.');
  }

  const status = normalizeTaskStatus(item.status);
  const existingPage = await findTaskByName(taskName);
  const summary = `由 ${context.approvedBy} 於 ${formatTaipeiDateTime(context.submittedAt)} 從 ${context.reportType} 報告確認。`;

  if (existingPage) {
    await notionRequest(`/v1/pages/${existingPage.id}`, {
      method: 'PATCH',
      body: {
        properties: compactProperties({
          狀態: selectProperty(status),
          確認狀態: selectProperty('已確認'),
          最後更新: dateProperty(context.submittedAt),
          'Codex 判斷摘要': richTextProperty(summary),
        }),
      },
    });

    return { task: taskName, status, action: 'updated', pageId: existingPage.id };
  }

  const created = await notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: TASKS_DATA_SOURCE_ID },
      properties: compactProperties({
        任務名稱: titleProperty(taskName),
        狀態: selectProperty(status),
        確認狀態: selectProperty('已確認'),
        來源: selectProperty('Codex 手動整理'),
        信心等級: selectProperty('中'),
        優先級: selectProperty('中'),
        專案: selectProperty('未分類'),
        來源原文: richTextProperty(`${context.reportType} 報告頁面確認`),
        'Codex 判斷摘要': richTextProperty(summary),
        最後更新: dateProperty(context.submittedAt),
      }),
    },
  });

  return { task: taskName, status, action: 'created', pageId: created.id };
}

async function findTaskByName(taskName) {
  const result = await notionRequest(`/v1/data_sources/${TASKS_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 1,
      filter: { property: '任務名稱', title: { equals: taskName } },
    },
  });

  return result.results?.[0] || null;
}

async function createAttachmentConversionApproval(item, context) {
  const fileName = String(item.file || item.name || '').trim();
  if (!fileName) {
    throw new Error('Attachment approval is missing file name.');
  }

  const action = String(item.action || '暫不轉檔').trim();
  const conversionStatus = resolveConversionStatus(action);
  const conversionType = resolveConversionType(action);
  const sourceUrl = String(item.sourceUrl || '').trim();
  const summary = `由 ${context.approvedBy} 於 ${formatTaipeiDateTime(context.submittedAt)} 從 ${context.reportType} 報告確認：${action}`;

  const created = await notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: ATTACHMENT_CONVERSIONS_DATA_SOURCE_ID },
      properties: compactProperties({
        轉檔項目: titleProperty(`${fileName} - ${action}`),
        原始檔名: richTextProperty(fileName),
        轉檔狀態: selectProperty(conversionStatus),
        轉檔類型: selectProperty(conversionType),
        附件類型: selectProperty('file'),
        '可供 Codex 判斷': checkboxProperty(conversionStatus !== '不需轉檔'),
        轉檔時間: dateProperty(context.submittedAt),
        摘要: richTextProperty(summary),
        轉檔來源附件: sourceUrl ? urlProperty(sourceUrl) : undefined,
      }),
    },
  });

  return { file: fileName, action, conversionStatus, conversionType, pageId: created.id };
}

async function createApprovalDecisionPage({ reportType, approvedBy, submittedAt, taskResults, attachmentResults, reportContent, decisions, followups, notes }) {
  const title = `${reportType} 報告確認 ${formatTaipeiDateTime(submittedAt)}`;
  const taskLines = taskResults.length
    ? taskResults.map((item) => `${item.task} -> ${item.status} (${item.action})`).join('\n')
    : '沒有任務狀態變更。';
  const attachmentLines = attachmentResults.length
    ? attachmentResults.map((item) => `${item.file} -> ${item.action} (${item.conversionStatus})`).join('\n')
    : '沒有附件轉檔確認。';
  const decisionLines = decisions?.length
    ? decisions.map((item) => `${item.item || item.title || '決策'} -> ${item.decision || item.value || item.status || ''}${item.actionKey ? ` (${item.actionKey})` : ''}`).join('\n')
    : '沒有額外決策選擇。';
  const followupLines = followups?.length
    ? followups.map((item) => [
      `目標：${item.target || ''}`,
      `動作：${item.action || ''}`,
      `是否發送：${item.send ? '是' : '否'}`,
      `訊息：${item.message || ''}`,
    ].join('\n')).join('\n---\n')
    : '沒有追蹤訊息確認。';
  const reportText = reportContent || '沒有提供修改後報告內容。';

  return notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: RISK_DECISIONS_DATA_SOURCE_ID },
      properties: compactProperties({
        議題: titleProperty(title),
        類型: selectProperty('決策'),
        專案: selectProperty('跨專案'),
        狀態: selectProperty('已決策'),
        嚴重度: selectProperty('低'),
        說明: richTextProperty(`確認人：${approvedBy}\n報告類型：${reportType}\n\n修改後報告內容：\n${reportText}\n\n決策：\n${decisionLines}\n\n追蹤訊息：\n${followupLines}\n\n任務：\n${taskLines}\n\n附件：\n${attachmentLines}`),
        後續行動: richTextProperty(notes ? String(notes) : '依照本次確認結果更新任務與附件轉檔佇列。'),
      }),
    },
  });
}

function normalizeTaskStatus(value) {
  const status = String(value || '').trim();
  const allowed = new Set(['待確認', '未開始', '進行中', '等待回覆', '待確認完成', '已完成', '封存']);
  return allowed.has(status) ? status : '待確認';
}

function resolveConversionStatus(action) {
  return /不需|暫不|不要|跳過/.test(action) ? '不需轉檔' : '待轉檔';
}

function resolveConversionType(action) {
  if (/OCR|圖片|影像/.test(action)) return 'OCR';
  if (/PDF|文字/.test(action)) return 'PDF 文字';
  if (/摘要|整理/.test(action)) return '檔案摘要';
  return '人工整理';
}

async function sendReport(req, body) {
  const reportType = String(body.reportType || body.type || '').trim().toLowerCase();
  const report = await buildReportMessage(reportType, body.text);
  const targets = await resolveReportTargets(body);
  const cronMeta = readCronMeta(req, body);

  if (!targets.length) {
    throw new Error(`No LINE report target found. Send a message to ${OUTGOING_ACTOR_NAME} first, or set HOZO_REPORT_TARGET_ID.`);
  }

  if (cronMeta) {
    console.log(JSON.stringify({
      event: 'control-report-send',
      reportType,
      cronMeta,
      targetCount: targets.length,
    }));
  }

  const result = await pushToTargets(targets, [report]);
  const snapshot = await maybeCreateDailyReportSnapshot({
    reportType,
    report,
    targets,
    cronMeta,
    sentAt: new Date(),
  });
  return { ...result, ...(cronMeta ? { cronMeta } : {}), ...(snapshot ? { snapshot } : {}) };
}

async function previewReport(body) {
  const reportType = String(body.reportType || body.type || '').trim().toLowerCase();
  const report = await buildReportMessage(reportType, body.text);
  return {
    ok: true,
    reportType,
    report,
    wouldSend: false,
  };
}

async function resolveReportTargets(body) {
  const targets = normalizeTargets(body.targets, body.targetId, body.targetType);
  if (targets.length) {
    return uniqueTargets(targets);
  }

  const defaultTargets = [];
  defaultTargets.push(...targetsFromIds(process.env.HOZO_REPORT_TARGET_IDS || process.env.HOZO_REPORT_TARGET_ID, process.env.HOZO_REPORT_TARGET_TYPE || 'user'));
  defaultTargets.push(...targetsFromIds(process.env.HOZO_REPORT_CC_TARGET_IDS, process.env.HOZO_REPORT_CC_TARGET_TYPE || 'user'));

  const mainKeywords = process.env.HOZO_REPORT_TARGET_NAME_KEYWORD || (defaultTargets.length ? '' : 'Maggie');
  defaultTargets.push(...await findReportTargetsFromNotion(mainKeywords, { fallbackLatestPersonal: !defaultTargets.length }));

  const ccKeywords = process.env.HOZO_REPORT_CC_NAME_KEYWORDS || 'Seven陳聖文,Seven 陳聖文';
  defaultTargets.push(...await findReportTargetsFromNotion(ccKeywords, { fallbackLatestPersonal: false }));

  return uniqueTargets(defaultTargets);
}

function targetsFromIds(value, targetType) {
  return String(value || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => ({ id, type: targetType || inferTargetType(id), source: 'env' }));
}

async function maybeCreateDailyReportSnapshot({ reportType, report, targets, cronMeta, sentAt }) {
  if (!isDailyReportType(reportType) || !DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID || !process.env.NOTION_TOKEN) {
    return null;
  }

  try {
    const text = outgoingMessageText(report);
    const reportUrl = firstUrlFromText(text);
    const reportDate = taipeiDateOnly(sentAt);
    const targetSummary = targets.map((target) => target.name || target.id).filter(Boolean).join('、');
    const page = await notionRequest('/v1/pages', {
      method: 'POST',
      body: {
        parent: { type: 'data_source_id', data_source_id: DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID },
        properties: compactProperties({
          報告名稱: titleProperty(`${reportDate} 每日總控總確認`),
          報告日期: dateProperty(`${reportDate}T00:00:00+08:00`),
          報告類型: selectProperty('每日總控總確認'),
          狀態: selectProperty('已發送'),
          報告連結: reportUrl ? urlProperty(reportUrl) : undefined,
          LINE訊息內容: richTextProperty(text),
          發送時間: dateProperty(sentAt),
          CronJob: richTextProperty(cronMeta?.jobName || ''),
          RunID: richTextProperty(cronMeta?.runId || ''),
          目標: richTextProperty(targetSummary),
          摘要: richTextProperty('20:30 每日總控總確認已發送，等待使用者確認寫回。'),
        }),
        children: [
          paragraphProperty('每日總控總確認快照'),
          paragraphProperty(`報告日期：${reportDate}`),
          paragraphProperty(`報告連結：${reportUrl || '未提供'}`),
          paragraphProperty(`發送目標：${targetSummary || '預設報告對象'}`),
          paragraphProperty('LINE 訊息內容：'),
          paragraphProperty(text),
        ],
      },
    });

    return { ok: true, pageId: page.id, url: page.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to create daily report snapshot: ${message}`);
    return { ok: false, error: message };
  }
}

async function maybeMarkDailyReportSnapshotConfirmed({ reportType, decisionPage, submittedAt }) {
  if (!isDailyReportType(reportType) || !DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID || !process.env.NOTION_TOKEN) {
    return null;
  }

  try {
    const result = await notionRequest(`/v1/data_sources/${DAILY_REPORT_SNAPSHOTS_DATA_SOURCE_ID}/query`, {
      method: 'POST',
      body: {
        page_size: 1,
        filter: { property: '報告類型', select: { equals: '每日總控總確認' } },
        sorts: [{ property: '發送時間', direction: 'descending' }],
      },
    });
    const snapshot = result.results?.[0];
    if (!snapshot) {
      return { ok: false, skipped: true, reason: 'no-daily-report-snapshot-found' };
    }

    const page = await notionRequest(`/v1/pages/${snapshot.id}`, {
      method: 'PATCH',
      body: {
        properties: compactProperties({
          狀態: selectProperty('已確認'),
          確認時間: dateProperty(submittedAt),
          確認紀錄連結: decisionPage?.url ? urlProperty(decisionPage.url) : undefined,
          摘要: richTextProperty('每日總控總確認已由使用者確認，確認結果已寫入風險與決策庫。'),
        }),
      },
    });

    return { ok: true, pageId: page.id, url: page.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Unable to update daily report snapshot confirmation: ${message}`);
    return { ok: false, error: message };
  }
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const id = String(target.id || '').trim();
    if (!id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    target.id = id;
    target.type = target.type || inferTargetType(id);
    return true;
  });
}

async function findReportTargetsFromNotion(keywordList, { fallbackLatestPersonal = false } = {}) {
  const notionToken = process.env.NOTION_TOKEN;
  const dataSourceId = process.env.HOZO_CONVERSATIONS_DATA_SOURCE_ID;
  if (!notionToken || !dataSourceId) {
    return [];
  }

  const keywords = String(keywordList || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const result = await notionRequest(`/v1/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    body: {
      page_size: 100,
      filter: { property: '對象類型', select: { equals: '個人' } },
      sorts: [{ property: '最後訊息時間', direction: 'descending' }],
    },
  });

  const pages = result.results || [];
  const selectedPages = keywords.length
    ? pages.filter((page) => {
      const name = `${pageTextProperty(page, 'LINE 對話名稱')} ${pageTextProperty(page, '自定義名稱')}`.toLowerCase();
      return keywords.some((keyword) => name.includes(keyword));
    })
    : [];

  const fallbackPages = selectedPages.length || !fallbackLatestPersonal ? [] : pages.slice(0, 1);
  return [...selectedPages, ...fallbackPages]
    .map((page) => pageTextProperty(page, 'User ID'))
    .filter(Boolean)
    .map((id) => ({ id, type: 'user', source: 'notion-auto' }));
}

async function buildReportMessage(reportType, customText) {
  if (customText) {
    return { type: 'text', text: clampLineText(customText) };
  }

  const morningBriefUrl = process.env.MORNING_BRIEF_URL || `${PUBLIC_BASE_URL}/reports/morning-brief`;
  const dailyReportUrl = process.env.DAILY_REPORT_URL || `${PUBLIC_BASE_URL}/reports/daily-control-report`;
  const followupBaseUrl = process.env.FOLLOWUP_CONFIRMATION_URL || `${PUBLIC_BASE_URL}/reports/followup-confirmation`;

  if (['morning', 'morning-brief', '早報'].includes(reportType)) {
    return {
      type: 'text',
      text: `早上 8 點半行程與待辦報告：\n${morningBriefUrl}\n\n請確認今日行程、優先工作、未完成事項與需要決策的項目。`,
    };
  }

  if (['daily', 'evening', 'night', '晚報', '每日報告'].includes(reportType)) {
    const dynamicText = await buildDynamicDailyReportText(dailyReportUrl);
    if (dynamicText) {
      return { type: 'text', text: clampLineText(dynamicText) };
    }

    return {
      type: 'text',
      text: `晚上 8 點半每日總控總確認：\n${dailyReportUrl}\n\n請先收斂今天的目標追認：哪些任務/專案已取得口述、哪些已上傳給 Codex、哪些已確認可追蹤。只有「Codex 目標確認」為已確認可追蹤或追蹤中的案件，才安排下一步與完成百分比。`,
    };
  }

  if (['followup-morning', 'followup-10', '10', '上午追蹤'].includes(reportType)) {
    return {
      type: 'text',
      text: `上午 10 點目標追認與新任務確認：\n${withFollowupSlot(followupBaseUrl, '10')}\n\n請檢查上午新增任務/專案；凡是沒有「完成目標定義」的，先用 LINE 或 Email 問負責人口述目標。口述上傳給 Codex 確認後，下一個時段再決定後續追蹤。`,
    };
  }

  if (['followup-midday', 'followup-13', '13', '中午追蹤'].includes(reportType)) {
    return {
      type: 'text',
      text: `下午 1 點目標追認與新任務確認：\n${withFollowupSlot(followupBaseUrl, '13')}\n\n請確認午間前新增項目的目標是否已被負責人口述；若尚未口述，先追問。若已口述，請上傳給 Codex 確認，確認後才排下一步。`,
    };
  }

  if (['followup-afternoon', 'followup-17', '17', '下午追蹤'].includes(reportType)) {
    return {
      type: 'text',
      text: `下午 5 點目標追認與新任務確認：\n${withFollowupSlot(followupBaseUrl, '17')}\n\n請確認下午要發出的 LINE/Email 追問；如果窗口不知道目標，請她指定真正負責人。Codex 確認完成目標後，下一個時段才告訴負責人後續要做什麼。`,
    };
  }

  throw new Error('Unknown reportType. Use morning, daily, followup-morning, followup-midday, or followup-afternoon.');
}

async function buildDynamicMorningBriefText() {
  if (!process.env.NOTION_TOKEN || !TASKS_DATA_SOURCE_ID) {
    return '';
  }

  try {
    const model = await buildMorningBriefModel();

    return [
      '# 今日行程與待辦報告',
      `2026-06-10｜08:30`,
      '',
      '## 今日行程',
      ...model.scheduleItems.map((item) => `${item.time} ${item.title}：${item.note}`),
      '',
      buildMorningTaskSection('## 昨日未完成與延續事項', model.carryoverTasks),
      '',
      buildMorningTaskSection('## 今天建議優先處理', model.priorityTasks),
      '',
      buildMorningTaskSection('## 今天需要你決策或回覆', model.decisionTasks),
      '',
      '## 今日建議工作時段',
      ...model.workBlocks.map((item) => `${item.time} ${item.note}`),
    ].join('\n');
  } catch (error) {
    console.warn(`Unable to build dynamic morning brief: ${error.message}`);
    return '';
  }
}

async function buildMorningBriefModel() {
  const tasks = await listOpenTasksForMorningBrief();
  const today = taipeiDateOnly(new Date());
  const carryoverTasks = tasks
    .filter((task) => ['等待回覆', '進行中', '待確認完成'].includes(task.status) || task.overdueStatus === '已逾期')
    .sort(compareMorningTaskPriority)
    .slice(0, 5);
  const priorityTasks = tasks
    .filter((task) => task.priority === '高' || ['待確認', '進行中', '等待回覆'].includes(task.status))
    .sort(compareMorningTaskPriority)
    .slice(0, 5);
  const decisionTasks = tasks
    .filter((task) => ['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(task.goalStatus)
      || /待確認|需決策|待主管|待回覆|待負責/.test(`${task.status} ${task.confirmation} ${task.nextStep}`))
    .sort(compareMorningTaskPriority)
    .slice(0, 4);

  return {
    today,
    tasks,
    openTaskCount: tasks.length,
    scheduleItems: buildHozoMorningScheduleItems(),
    carryoverTasks,
    priorityTasks,
    decisionTasks,
    workBlocks: buildHozoMorningWorkBlocks(priorityTasks, decisionTasks),
  };
}

function buildHozoMorningScheduleItems() {
  return [
    {
      time: '08:30',
      title: 'HOZO 早報確認',
      note: '確認今日行程、優先工作、昨日延續事項與需要決策的項目。',
      tag: '例行',
    },
    {
      time: '10:00',
      title: '上午追蹤確認',
      note: '檢查早上新增訊息、候選任務與需要負責人口述目標的項目。',
      tag: '需確認',
    },
    {
      time: '13:00 / 17:00',
      title: '午間與下午進度檢查',
      note: '更新上午進度、等待回覆、現場事項與需要追問的任務。',
      tag: '追蹤',
    },
    {
      time: '20:30',
      title: '每日總控狀態總結報告',
      note: '收斂今天完成、未完成、風險與隔日優先事項。',
      tag: '收斂',
    },
  ];
}

function buildHozoMorningWorkBlocks(priorityTasks, decisionTasks) {
  const firstProject = priorityTasks[0]?.project || '今日優先任務';
  const decisionProject = decisionTasks[0]?.project || '需決策事項';
  return [
    { time: '09:00-10:00', note: '整理昨晚到今早的新訊息，確認是否有新任務或新群組需要歸類。' },
    { time: '10:20-12:00', note: `優先推進「${firstProject}」相關任務，先處理會卡住其他人的項目。` },
    { time: '14:00-15:30', note: `處理「${decisionProject}」的目標口述、負責人確認與需要回覆的決策。` },
  ];
}

async function listOpenTasksForMorningBrief() {
  const result = await notionRequest(`/v1/data_sources/${TASKS_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 100,
      filter: {
        and: [
          { property: '狀態', select: { does_not_equal: '已完成' } },
          { property: '狀態', select: { does_not_equal: '封存' } },
        ],
      },
      sorts: [{ property: '最後更新', direction: 'descending' }],
    },
  });

  return (result.results || []).map((page) => ({
    name: pageTextProperty(page, '任務名稱'),
    project: pageSelectProperty(page, '專案') || '未分類',
    status: pageSelectProperty(page, '狀態') || '未設定',
    confirmation: pageSelectProperty(page, '確認狀態') || '未設定',
    priority: pageSelectProperty(page, '優先級') || '未設定',
    owner: pageTextProperty(page, '負責人'),
    goalStatus: pageSelectProperty(page, 'Codex 目標確認'),
    nextStep: pageTextProperty(page, '下一步給負責人') || pageTextProperty(page, '下一步'),
    overdueStatus: pageSelectProperty(page, '逾期狀態'),
    updatedAt: pageTextProperty(page, '最後更新') || page.last_edited_time || '',
  }));
}

function groupMorningTasksByStatus(tasks) {
  return tasks.reduce((groups, task) => {
    const status = task.status || '未設定';
    groups[status] = (groups[status] || 0) + 1;
    return groups;
  }, {});
}

function buildMorningTaskSection(title, tasks) {
  if (!tasks.length) {
    return `${title}\n目前沒有符合條件的任務。`;
  }

  return [
    title,
    ...tasks.map((task, index) => {
      const action = morningTaskAction(task);
      return `${index + 1}. ${conciseReportText(task.name, 46)}｜${task.project}｜${task.status}｜${action}`;
    }),
  ].join('\n');
}

function compareMorningTaskPriority(a, b) {
  return morningTaskScore(b) - morningTaskScore(a)
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function morningTaskScore(task) {
  let score = task.priority === '高' ? 30 : task.priority === '中' ? 18 : 8;
  if (['等待回覆', '進行中'].includes(task.status)) score += 14;
  if (task.status === '待確認完成') score += 12;
  if (['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(task.goalStatus)) score += 12;
  if (task.overdueStatus === '已逾期') score += 10;
  if (/公司|銀行|法務|合約|證照|稅務/.test(task.name)) score += 6;
  if (/工程|工務|設備|維修|施工/.test(task.name)) score += 5;
  return score;
}

function morningTaskAction(task) {
  if (['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(task.goalStatus)) {
    return `請 ${task.owner || '負責人'} 先口述完成目標與驗收標準。`;
  }
  if (task.status === '等待回覆') {
    return `今天先追問回覆，避免卡住「${task.project}」。`;
  }
  if (task.status === '待確認完成') {
    return '今天確認是否真的完成，補上證據或關閉條件。';
  }
  if (task.nextStep && !isDuplicateNextStep(task)) {
    return conciseReportText(task.nextStep, 54);
  }
  return '今天確認下一步與負責人，避免只停在待確認。';
}

function isDuplicateNextStep(task) {
  const name = normalizeReportComparableText(task.name);
  const next = normalizeReportComparableText(task.nextStep);
  return !next || name.includes(next) || next.includes(name);
}

function normalizeReportComparableText(value) {
  return String(value || '').replace(/[，。、：:；;\s]/g, '').slice(0, 40);
}

async function buildDynamicDailyReportText(dailyReportUrl) {
  if (!process.env.NOTION_TOKEN || !TASKS_DATA_SOURCE_ID) {
    return '';
  }

  try {
    const reportDate = taipeiDateOnly(new Date());
    const [tasks, messages, responsibilityGaps] = await Promise.all([
      listRecentTasksForDailyReport(),
      listImportantMessagesForDailyReport(),
      listResponsibilityGapsForDailyReport(),
    ]);
    const reportItems = dedupeReportItems([...tasks, ...messages])
      .sort(compareDailyReportItems);
    const events = buildSynthesizedDailyEvents(reportItems);
    const usedKeys = new Set(events.flatMap((event) => event.items.map(reportItemKey)));

    const sections = [
      '20:30 每日總控事件結論報告',
      `日期：${reportDate}`,
      `摘要：已整合 ${events.length} 件主要事件；每件事以「主題、對象、影響、結論、建議待辦」呈現。`,
      '',
      buildEventSummarySection('一、今日主要事件', events, 6),
      '',
      buildCompactDailySection('二、其他待確認線索', filterActionableRemainders(reportItems, usedKeys), 4),
      '',
      '三、目標追認提醒',
      '新增任務或專案若尚未取得負責人口述，先問完成目標；Codex 確認前不更新完成百分比。',
      '',
      buildResponsibilityGapSection(responsibilityGaps),
      '',
      `報告頁：${dailyReportUrl}`,
      '提醒：晚報第一層只放事件結論；零散訊息不直接上報，除非能形成待辦、風險或目標追認。',
    ];

    return sections.join('\n');
  } catch (error) {
    console.warn(`Unable to build dynamic daily report: ${error.message}`);
    return '';
  }
}

async function listResponsibilityGapsForDailyReport() {
  if (!RESPONSIBILITY_DATA_SOURCE_ID) {
    return [];
  }

  const result = await notionRequest(`/v1/data_sources/${RESPONSIBILITY_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 20,
      filter: {
        or: [
          { property: '選擇狀態', select: { does_not_equal: '已完成' } },
          { property: 'LINE對象ID（結果）', rich_text: { is_empty: true } },
        ],
      },
      sorts: [{ property: '更新時間', direction: 'descending' }],
    },
  });

  return (result.results || []).map((page) => ({
    title: pageTextProperty(page, '權責項目名稱'),
    project: pageSelectProperty(page, '第一層：總控專案'),
    status: pageSelectProperty(page, '選擇狀態'),
    candidateGroups: pageNumberProperty(page, '候選群組數'),
    candidateOwners: pageNumberProperty(page, '候選負責人數'),
    instruction: pageTextProperty(page, '選擇說明'),
  }));
}

function buildResponsibilityGapSection(items) {
  if (!items.length) {
    return '四、權責指派提醒\n目前沒有未完成的權責指派列。';
  }

  const lines = items.slice(0, 5).map((item, index) => {
    const project = item.project || item.title || '未分類';
    const counts = `候選群組 ${item.candidateGroups}、候選負責人 ${item.candidateOwners}`;
    return `${index + 1}. ${project}｜${item.status || '待確認'}｜${counts}\n   下一步：${conciseReportText(item.instruction || '請先確認主要 LINE 群組，再選主要負責人。', 78)}`;
  });

  return [
    '四、權責指派提醒',
    ...lines,
  ].join('\n');
}

async function listRecentTasksForDailyReport() {
  const result = await notionRequest(`/v1/data_sources/${TASKS_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 50,
      sorts: [{ property: '最後更新', direction: 'descending' }],
    },
  });

  const today = taipeiDateOnly(new Date());
  return (result.results || [])
    .map((page) => ({
      source: 'task',
      title: pageTextProperty(page, '任務名稱'),
      project: pageSelectProperty(page, '專案'),
      priority: pageSelectProperty(page, '優先級'),
      status: pageSelectProperty(page, '狀態'),
      confirmation: pageSelectProperty(page, '確認狀態'),
      goalStatus: pageSelectProperty(page, 'Codex 目標確認'),
      sourceType: pageSelectProperty(page, '來源'),
      summary: pageTextProperty(page, 'Codex 判斷摘要') || pageTextProperty(page, '完成目標定義') || pageTextProperty(page, '來源原文'),
      nextStep: pageTextProperty(page, '下一步給負責人') || pageTextProperty(page, '下一步'),
      updatedAt: pageDateProperty(page, '最後更新') || page.last_edited_time || '',
      url: page.url,
    }))
    .filter((item) => isTodayTaipei(item.updatedAt, today)
      || ['待確認', '未開始', '進行中', '等待回覆'].includes(item.status)
      || item.confirmation === '未確認'
      || ['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(item.goalStatus))
    .slice(0, 30);
}

async function listImportantMessagesForDailyReport() {
  if (!MESSAGES_DATA_SOURCE_ID) {
    return [];
  }

  const since = taipeiStartOfDayIso(new Date());
  const result = await notionRequest(`/v1/data_sources/${MESSAGES_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 80,
      filter: { property: '排序時間', date: { on_or_after: since } },
      sorts: [{ property: '排序時間', direction: 'ascending' }],
    },
  });

  const items = [];
  for (const page of result.results || []) {
    const text = pageTextProperty(page, '文字內容') || pageTextProperty(page, '原始內容');
    const score = scoreDailyMessageImportance(text);
    const conversation = await getDailyMessageConversationProject(pageRelationId(page, '對話主檔'));
    items.push({
      source: 'message',
      title: buildMessageReportTitle(text),
      project: conversation.project || inferDailyMessageProject(text),
      priority: score >= 6 ? '高' : score >= 3 ? '中' : '低',
      status: pageTextProperty(page, '發話者名稱'),
      summary: text,
      nextStep: inferMessageNextStep(text),
      updatedAt: pageDateProperty(page, '排序時間') || page.last_edited_time || '',
      url: page.url,
      tags: dailyMessageTags(text),
      score,
    });
  }

  return items.filter((item) => item.score > 0).slice(0, 30);
}

async function getDailyMessageConversationProject(pageId) {
  if (!pageId) {
    return { project: '' };
  }
  if (dailyConversationProjectCache.has(pageId)) {
    return dailyConversationProjectCache.get(pageId);
  }

  const page = await notionRequest(`/v1/pages/${pageId}`, { method: 'GET' });
  const value = { project: pageSelectProperty(page, '總控專案') || pageSelectProperty(page, '專案') };
  dailyConversationProjectCache.set(pageId, value);
  return value;
}

function buildEventSummarySection(title, events, limit) {
  const selected = events.slice(0, limit);
  if (!selected.length) {
    return `${title}\n今天沒有明確事件。`;
  }

  return [
    title,
    ...selected.map((event, index) => formatEventSummaryCard(event, index + 1)),
  ].join('\n\n');
}

function buildSynthesizedDailyEvents(reportItems) {
  const events = [];
  const addEvent = (event) => {
    if (event && event.items.length) {
      events.push(event);
    }
  };

  addEvent(buildHozoGovernanceEvent(reportItems));
  addEvent(buildHozoSiteProcurementEvent(reportItems));
  addEvent(buildHozoBrandWebsiteEvent(reportItems));
  addEvent(buildHozoOperationsEvent(reportItems));
  addEvent(buildHozoAutomationEvent(reportItems));
  addEvent(buildHozoGoalRecognitionEvent(reportItems));

  const usedKeys = new Set(events.flatMap((event) => event.items.map(reportItemKey)));
  const remainingHigh = reportItems
    .filter((item) => item.priority === '高' && !usedKeys.has(reportItemKey(item)))
    .slice(0, 3)
    .map((item) => ({
      subject: readableReportTitle(item),
      target: item.project || '未分類',
      project: item.project || '未分類',
      priority: item.priority || '高',
      impact: '尚未歸入明確事件，但內容具備高優先或待確認訊號。',
      conclusion: cleanReportSummary(item.summary),
      nextAction: item.nextStep || inferMessageNextStep(`${item.title}\n${item.summary}`),
      solution: '先確認是否成立為事件；若成立，再合併同類訊息並產生單一待辦。',
      depth: '可回任務庫查看原始訊息與判斷摘要。',
      items: [item],
    }));

  return [...events, ...remainingHigh]
    .sort((a, b) => eventPriorityScore(b) - eventPriorityScore(a))
    .slice(0, 8);
}

function buildHozoGovernanceEvent(items) {
  const matched = items.filter((item) => /公司|治理|法規|合規|銀行|開戶|驗資|股東|董事|監察人|合約|租賃|公證|用印|大小章|稅務|證照/.test(eventHaystack(item)));
  if (!matched.length) return null;
  return {
    subject: '公司治理收斂',
    target: '公司設立 / 銀行 / 合約 / 法務稅務',
    project: '公司治理',
    priority: '高',
    impact: '若公司、銀行、合約與合規沒有收斂，後續場域、通路與營收啟動都缺乏正式承接基礎。',
    conclusion: '目前需要把公司設立、銀行、合約、公證、證照與稅務整併成一個可驗收事件，而不是分散待辦。',
    nextAction: '請主辦負責人口述完成目標，列出必須完成的文件、帳戶、合約與驗收人。',
    solution: '用單一「公司治理收尾」任務追蹤，避免文件項目散落。',
    depth: `${matched.length} 則治理/合規相關訊號已合併。`,
    items: matched,
  };
}

function buildHozoSiteProcurementEvent(items) {
  const matched = items.filter((item) => /場域|工程|裝修|水電|網路|設備|備品|採購|家具|衛浴|床墊|飲水機|洗烘|門鎖|磁扣|點收|驗收|供應商|報價/.test(eventHaystack(item)));
  if (!matched.length) return null;
  return {
    subject: '工程建置可營運條件',
    target: '工程 / 設備 / 備品 / 現場驗收',
    project: '工程建置管理',
    priority: '高',
    impact: '工程與設備沒有定義可營運條件，就無法判斷是否能交付住客或進入營運。',
    conclusion: '目前應把工程、設備、備品與點收整理成可營運驗收清單。',
    nextAction: '請工程或採購窗口確認：哪些項目是營運前必須到位，誰做最後驗收。',
    solution: '用「可營運驗收清單」合併工程缺失、設備到位、備品點收與現場交付。',
    depth: `${matched.length} 則場域/採購相關訊號已合併。`,
    items: matched,
  };
}

function buildHozoBrandWebsiteEvent(items) {
  const matched = items.filter((item) => /品牌|官網|網站|網域|hozo\.com|Email|表單|FAQ|設備設施|企業合作|文案|照片|素材|官方|上線/.test(eventHaystack(item)));
  if (!matched.length) return null;
  return {
    subject: '品牌官網公開條件',
    target: '品牌 / 官網 / 表單 / 官方數位資產',
    project: '品牌官網',
    priority: '中',
    impact: '品牌與官網若沒有明確公開條件，通路與企業合作內容會反覆等待。',
    conclusion: '目前應把品牌名稱、網域、Email、官網內容與表單整理成一個可公開事件。',
    nextAction: '請品牌或網站窗口口述：什麼狀態才算可以正式公開，誰驗收。',
    solution: '用「官網可公開清單」整併頁面、FAQ、設備設施、表單與官方資訊一致性。',
    depth: `${matched.length} 則品牌/官網相關訊號已合併。`,
    items: matched,
  };
}

function buildHozoOperationsEvent(items) {
  const matched = items.filter((item) => /營運|通路|營收|上架|月租|招租|帶看|交接|房務|維運|清潔|SOP|櫻桃|商務會館|財務移轉|房客|入住|退房/.test(eventHaystack(item)));
  if (!matched.length) return null;
  return {
    subject: '營運啟動與交接維運',
    target: '通路 / 收客 / 交接 / 房務維運',
    project: '營運和資料交接',
    priority: '高',
    impact: '通路收客與現場維運若不同步，會出現可銷售但不可交付、或可交付但不可收客的落差。',
    conclusion: '目前應把通路營收啟動和交接房務維運合併為營運啟動事件。',
    nextAction: '請營運窗口分別確認通路可收客、交接可接手、房務可維持的驗收標準。',
    solution: '用一個營運啟動看板追蹤通路、定價、素材、交接、SOP 與維修窗口。',
    depth: `${matched.length} 則營運相關訊號已合併。`,
    items: matched,
  };
}

function buildHozoAutomationEvent(items) {
  const matched = items.filter((item) => /LINE|Notion|PMS|webhook|自動化|同步|每日報告|早報|晚報|任務庫|目標定義|點收|OCR|附件|Codex|HOZO Jr|資料治理/.test(eventHaystack(item)));
  if (!matched.length) return null;
  return {
    subject: '自動化與資料治理驗收',
    target: 'LINE / Notion / PMS / 報告 / 點收',
    project: '自動化',
    priority: '高',
    impact: '系統若只收資料但不能產生可追蹤結論，管理仍會回到人工整理。',
    conclusion: '目前應把 LINE webhook、Notion 同步、報告追認、PMS 與點收整理成可驗收功能組。',
    nextAction: '請系統 owner 確認每個功能的驗收條件，並把未定義目標先送 Codex 確認。',
    solution: '用「自動化驗收清單」追蹤收訊、同步、報告、點收與資料治理。',
    depth: `${matched.length} 則系統/自動化相關訊號已合併。`,
    items: matched,
  };
}

function buildHozoGoalRecognitionEvent(items) {
  const matched = items.filter((item) => /完成目標|目標口述|Codex 目標確認|待負責人口述|待上傳給 Codex|追認|驗收|怎樣叫完成|完成百分比/.test(eventHaystack(item)));
  if (!matched.length) return null;
  return {
    subject: '目標追認缺口',
    target: '所有新增任務與專案負責人',
    project: '跨專案',
    priority: '高',
    impact: '沒有完成目標定義，就不能合理判斷完成百分比，也無法知道下一步是否正確。',
    conclusion: '目前最重要的管理動作是取得負責人口述，並讓 Codex 確認能否追蹤。',
    nextAction: '每個報告時段檢查新增項目：缺目標先問，已口述就上傳給 Codex，確認後才追蹤。',
    solution: '使用「Codex 目標確認、目標口述原文、對外詢問草稿、下一步給負責人」四個欄位收斂。',
    depth: `${matched.length} 則目標追認相關訊號已合併。`,
    items: matched,
  };
}

function formatEventSummaryCard(event, index) {
  const project = event.project ? `｜${event.project}` : '';
  const priority = event.priority ? `｜${event.priority}` : '';
  return [
    `${index}. ${event.subject}${project}${priority}`,
    `   主題：${conciseReportText(event.subject, 48)}`,
    `   對象：${conciseReportText(event.target || event.project || '未分類', 48)}`,
    `   影響：${conciseReportText(event.impact, 76)}`,
    `   結論：${conciseReportText(event.conclusion, 92)}`,
    `   建議待辦：${conciseReportText(event.nextAction, 86)}`,
    event.solution ? `   解法：${conciseReportText(event.solution, 74)}` : '',
    `   深看：${conciseReportText(event.depth, 58)}`,
  ].filter(Boolean).join('\n');
}

function eventPriorityScore(event) {
  let score = event.priority === '高' ? 100 : event.priority === '中' ? 60 : 30;
  score += Math.min(event.items.length, 10);
  if (/目標追認|系統|營運|場域|治理/.test(event.subject || '')) score += 20;
  return score;
}

function eventHaystack(item) {
  return [
    item.project,
    item.title,
    item.summary,
    item.nextStep,
    item.status,
    item.goalStatus,
    ...(item.tags || []),
  ].join('\n');
}

function buildCompactDailySection(title, items, limit) {
  const uniqueItems = dedupeReportItems(items).slice(0, limit);
  if (!uniqueItems.length) {
    return `${title}\n今天沒有明確項目。`;
  }

  return [
    title,
    ...uniqueItems.map((item, index) => `${index + 1}. ${readableReportTitle(item)}${item.project && item.project !== '未分類' ? `｜${item.project}` : ''}`),
  ].join('\n');
}

function filterActionableRemainders(items, usedKeys) {
  return items
    .filter((item) => !usedKeys.has(reportItemKey(item)))
    .filter((item) => item.priority === '高'
      || ['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(item.goalStatus)
      || /待辦|確認|追蹤|決策|卡點|處理|回覆|期限|到期|驗收|完成目標|報價|合約|通路|交接/.test(eventHaystack(item)))
    .sort(compareDailyReportItems);
}

function dedupeReportItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = reportItemKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reportItemKey(item) {
  const cleaned = normalizeReportKey(`${item.project || ''}:${readableReportTitle(item)}:${cleanReportSummary(item.summary).slice(0, 50)}`);
  return cleaned || normalizeReportKey(item.url || item.title || item.summary);
}

function normalizeReportKey(value) {
  return String(value || '').replace(/\s+/g, '').replace(/[^\p{L}\p{N}:：]/gu, '').slice(0, 120);
}

function compareDailyReportItems(a, b) {
  const aScore = reportItemImportanceScore(a);
  const bScore = reportItemImportanceScore(b);
  if (aScore !== bScore) return bScore - aScore;
  const priorityRank = { 高: 3, 中: 2, 低: 1 };
  const aRank = priorityRank[a.priority] || 0;
  const bRank = priorityRank[b.priority] || 0;
  if (aRank !== bRank) return bRank - aRank;
  return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
}

function reportItemImportanceScore(item) {
  const haystack = eventHaystack(item);
  let score = item.priority === '高' ? 10 : item.priority === '中' ? 5 : 1;
  if (['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(item.goalStatus)) score += 8;
  if (/公司|合約|銀行|稅務|證照|治理|法規/.test(haystack)) score += 7;
  if (/工程|設備|備品|採購|點收|驗收/.test(haystack)) score += 7;
  if (/通路|營收|交接|房務|維運|SOP/.test(haystack)) score += 7;
  if (/LINE|Notion|PMS|webhook|自動化|每日報告|目標定義/.test(haystack)) score += 6;
  if (/品牌|官網|表單|網域|Email/.test(haystack)) score += 4;
  return score + (Number(item.score) || 0);
}

function readableReportTitle(item) {
  const project = String(item.project || '');
  let title = String(item.title || item.summary || '').replace(/\s+/g, ' ').trim();
  title = title.replace(new RegExp(`^${escapeRegExp(project)}[：:]`), '');
  return conciseReportText(title || cleanReportSummary(item.summary), 36);
}

function conciseReportText(value, maxLength) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/LINE 訊息：https?:\/\/\S+/g, '')
    .replace(/同步識別碼：\S+/g, '')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function cleanReportSummary(value) {
  const text = String(value || '').trim();
  const summaryMatch = text.match(/摘要：([\s\S]+)/);
  if (summaryMatch) return summaryMatch[1].trim();
  const nextStepMatch = text.match(/建議處理：([^\n]+)/);
  if (nextStepMatch) return nextStepMatch[1].trim();
  return text;
}

function inferMessageNextStep(text) {
  const value = String(text || '');
  if (/完成目標|怎樣叫完成|驗收/.test(value)) return '補齊負責人口述與驗收人，送 Codex 確認後再追蹤。';
  if (/合約|銀行|稅務|證照|公證/.test(value)) return '確認文件、責任人、驗收條件與期限。';
  if (/工程|設備|備品|採購|報價/.test(value)) return '確認到位清單、供應商回覆、缺口與驗收窗口。';
  if (/通路|招租|帶看|房務|交接|維運/.test(value)) return '確認可營運條件、SOP、窗口與下一步。';
  if (/LINE|Notion|PMS|webhook|自動化/.test(value)) return '確認功能驗收標準、目前卡點與下一個測試。';
  return '確認是否保留為待辦，並補上完成目標定義。';
}

function scoreDailyMessageImportance(text) {
  const value = String(text || '');
  const rules = [
    [6, /完成目標|怎樣叫完成|驗收|負責人|目標口述/],
    [5, /公司|合約|銀行|稅務|證照|公證|法規|治理/],
    [5, /工程|裝修|水電|設備|備品|採購|報價|點收/],
    [5, /通路|招租|月租|帶看|交接|房務|維運|SOP|房客/],
    [5, /LINE|Notion|PMS|webhook|自動化|每日報告|附件|OCR/],
    [4, /品牌|官網|網域|Email|表單|FAQ|素材|上線/],
    [3, /進度|狀態|下一步|卡住|卡點|確認|決定|決策/],
  ];
  return rules.reduce((score, [points, pattern]) => (pattern.test(value) ? score + points : score), 0);
}

function dailyMessageTags(text) {
  const tags = [];
  if (/完成目標|怎樣叫完成|驗收|負責人|目標口述/.test(text)) tags.push('goal');
  if (/公司|合約|銀行|稅務|證照|公證|法規|治理/.test(text)) tags.push('governance');
  if (/工程|裝修|水電|設備|備品|採購|報價|點收/.test(text)) tags.push('site');
  if (/通路|招租|月租|帶看|交接|房務|維運|SOP|房客/.test(text)) tags.push('operations');
  if (/LINE|Notion|PMS|webhook|自動化|每日報告|附件|OCR/.test(text)) tags.push('automation');
  if (/品牌|官網|網域|Email|表單|FAQ|素材|上線/.test(text)) tags.push('brand');
  return tags;
}

function inferDailyMessageProject(text) {
  if (/公司|合約|銀行|稅務|證照|公證|法規|治理/.test(text)) return '公司治理';
  if (/工程|裝修|水電|設備|採購|報價|點收/.test(text)) return '工程建置管理';
  if (/備品|房務|清潔|客房/.test(text)) return '房務管理';
  if (/品牌|官網|網域|Email|表單|FAQ|素材|上線/.test(text)) return '品牌官網';
  if (/通路|招租|月租|帶看|入住|退房|房客|住客/.test(text)) return '住客服務與體驗管理';
  if (/交接|維運|SOP|營運資料|流程/.test(text)) return '營運和資料交接';
  if (/LINE|Notion|PMS|webhook|自動化|每日報告|附件|OCR|資料治理/.test(text)) return '自動化';
  return '未分類';
}

function buildMessageReportTitle(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (/完成目標|怎樣叫完成|驗收/.test(value)) return `目標追認：${value.slice(0, 34)}`;
  if (/公司|合約|銀行|稅務|證照/.test(value)) return `治理合規：${value.slice(0, 34)}`;
  if (/工程|設備|備品|採購/.test(value)) return `場域採購：${value.slice(0, 34)}`;
  if (/通路|交接|房務|維運/.test(value)) return `營運：${value.slice(0, 34)}`;
  if (/LINE|Notion|PMS|自動化/.test(value)) return `系統自動化：${value.slice(0, 34)}`;
  return value.slice(0, 46);
}

function withFollowupSlot(baseUrl, slot) {
  if (baseUrl.includes('htmlpreview.github.io/?')) {
    return `${baseUrl}#slot=${encodeURIComponent(slot)}`;
  }

  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}slot=${encodeURIComponent(slot)}`;
}

function isDailyReportType(reportType) {
  return ['daily', 'evening', 'night', '晚報', '每日報告'].includes(String(reportType || '').trim().toLowerCase());
}

function firstUrlFromText(text) {
  return String(text || '').match(/https?:\/\/\S+/)?.[0] || '';
}

async function pushLineMessages(req, body) {
  const targets = await resolvePushTargets(body);
  const messages = normalizeMessages(body.messages, body.message, body.text);
  const cronMeta = readCronMeta(req, body);

  if (!targets.length) {
    throw new Error('Missing targetId or targets.');
  }
  if (!messages.length) {
    throw new Error('Missing text, message, or messages.');
  }

  if (cronMeta) {
    console.log(JSON.stringify({
      event: 'control-line-push',
      cronMeta,
      targetCount: targets.length,
      messageCount: messages.length,
    }));
  }

  const result = await pushToTargets(targets, messages);
  return cronMeta ? { ...result, cronMeta } : result;
}

async function resolvePushTargets(body) {
  const directTargets = normalizeTargets(body.targets, body.targetId, body.targetType);
  if (directTargets.length) {
    return directTargets;
  }

  if (body.useDefaultReportTarget) {
    return resolveReportTargets({});
  }

  return [];
}

function normalizeTargets(targets, targetId, targetType) {
  if (Array.isArray(targets)) {
    return targets
      .map((target) => ({
        id: target.id || target.targetId || target.to,
        type: target.type || target.targetType || inferTargetType(target.id || target.targetId || target.to),
        name: target.name || target.targetName || target.displayName || '',
      }))
      .filter((target) => target.id);
  }

  if (targetId) {
    return [{ id: targetId, type: targetType || inferTargetType(targetId), name: '' }];
  }

  return [];
}

function normalizeMessages(messages, message, text) {
  if (Array.isArray(messages)) {
    return messages.map(normalizeMessage).filter(Boolean).slice(0, 5);
  }

  if (message) {
    return [normalizeMessage(message)].filter(Boolean);
  }

  if (text) {
    return [{ type: 'text', text: clampLineText(text) }];
  }

  return [];
}

function readCronMeta(req, body) {
  const cronMeta = body?.cronMeta && typeof body.cronMeta === 'object' ? body.cronMeta : null;
  const headerJobName = body?.cronJobName || requestHeaderValue(req, 'x-hozo-cron-job');
  const headerRunId = body?.cronRunId || requestHeaderValue(req, 'x-hozo-cron-run-id');
  const headerReportType = body?.cronReportType || requestHeaderValue(req, 'x-hozo-cron-scheduled-report');

  const merged = {
    jobName: cronMeta?.jobName || headerJobName || '',
    runId: cronMeta?.runId || headerRunId || '',
    reportType: cronMeta?.reportType || headerReportType || '',
    startedAt: cronMeta?.startedAt || '',
    source: cronMeta?.source || 'control-api',
  };

  return merged.jobName || merged.runId || merged.reportType ? merged : null;
}

function requestHeaderValue(req, headerName) {
  const value = req?.headers?.[headerName];
  return typeof value === 'string' ? value : '';
}

function normalizeMessage(message) {
  if (typeof message === 'string') {
    return { type: 'text', text: clampLineText(message) };
  }

  if (message?.type === 'text' && message.text) {
    return { ...message, text: clampLineText(message.text) };
  }

  return message && message.type ? message : null;
}

function inferTargetType(targetId) {
  const value = String(targetId || '');
  if (value.startsWith('U')) return 'user';
  if (value.startsWith('C')) return 'group';
  if (value.startsWith('R')) return 'room';
  return 'unknown';
}

async function pushToTargets(targets, messages) {
  const results = [];
  for (const target of targets) {
    await pushLine(target.id, messages);
    const outgoingLog = await recordOutgoingMessages(target, messages);
    results.push({
      targetId: target.id,
      targetType: target.type || 'unknown',
      source: target.source || 'request',
      ok: true,
      outgoingLog,
    });
  }

  return { ok: true, sent: results.length, results };
}

async function pushLine(to, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not set.');
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, messages }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`LINE push failed: ${response.status} ${responseText}`);
  }
}

async function recordOutgoingMessages(target, messages) {
  if (!process.env.NOTION_TOKEN || !CONVERSATIONS_DATA_SOURCE_ID || !MESSAGES_DATA_SOURCE_ID) {
    return { skipped: true, reason: 'notion-message-logging-not-configured' };
  }

  try {
    const sentAt = new Date().toISOString();
    const context = resolveOutgoingTargetContext(target);
    const preview = buildOutgoingPreview(messages);
    const conversation = await findOrCreateOutgoingConversation(context, target, sentAt, preview);
    const pages = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const messageId = buildOutgoingMessageId(target, message, sentAt, index);
      const text = outgoingMessageText(message);
      const messageType = normalizeOutgoingMessageType(message.type);
      const existing = await findOutgoingMessagePage(messageId);
      if (existing) {
        pages.push({ messageId, pageId: existing.id, duplicate: true });
        continue;
      }

      const page = await createOutgoingMessagePage({
        conversationId: conversation.id,
        messageId,
        message,
        messageType,
        text,
        sentAt,
        target,
        context,
      });
      pages.push({ messageId, pageId: page.id, duplicate: false });
    }

    await appendOutgoingConversationContent({
      conversationId: conversation.id,
      target,
      messages,
      sentAt,
    });

    await updateOutgoingConversation(conversation, target, sentAt, preview, messages.length);

    return { skipped: false, conversationId: conversation.id, messagesLogged: pages.length, pages };
  } catch (error) {
    console.warn(`Unable to record outgoing LINE message for ${target.id}: ${error.message}`);
    return { skipped: true, reason: error.message };
  }
}

function resolveOutgoingTargetContext(target) {
  const type = target.type || inferTargetType(target.id);
  if (type === 'group') {
    return { identityProperty: 'Group ID', identityValue: target.id, entityType: '群組', key: `group:${target.id}` };
  }
  if (type === 'room') {
    return { identityProperty: 'Room ID', identityValue: target.id, entityType: '聊天室', key: `room:${target.id}` };
  }
  if (type === 'user') {
    return { identityProperty: 'User ID', identityValue: target.id, entityType: '個人', key: `user:${target.id}` };
  }
  return { identityProperty: '對話統一鍵', identityValue: `unknown:${target.id}`, entityType: '未知', key: `unknown:${target.id}` };
}

async function findOrCreateOutgoingConversation(context, target, sentAt, preview) {
  const existing = await findOutgoingConversation(context);
  if (existing) {
    return existing;
  }

  const name = target.name || `${context.entityType} ${target.id}`;
  const properties = {
    'LINE 對話名稱': titleProperty(name),
    自定義名稱: richTextProperty(name),
    對象類型: selectProperty(context.entityType),
    對話統一鍵: richTextProperty(context.key),
    最後訊息時間: dateProperty(sentAt),
    最新訊息預覽: richTextProperty(preview),
    '訊息數（總）': { number: 0 },
    監控狀態: selectProperty('啟用'),
  };

  if (context.identityProperty && context.identityValue) {
    properties[context.identityProperty] = richTextProperty(context.identityValue);
  }

  return notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: CONVERSATIONS_DATA_SOURCE_ID },
      properties,
    },
  });
}

async function findOutgoingConversation(context) {
  if (!context.identityProperty || !context.identityValue) {
    return null;
  }

  const result = await notionRequest(`/v1/data_sources/${CONVERSATIONS_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 1,
      filter: { property: context.identityProperty, rich_text: { equals: context.identityValue } },
    },
  });

  return result.results?.[0] || null;
}

async function updateOutgoingConversation(conversation, target, sentAt, preview, messageCount) {
  const currentCount = conversation.properties?.['訊息數（總）']?.number || 0;
  const context = resolveOutgoingTargetContext(target);
  const name = target.name || pageTextProperty(conversation, 'LINE 對話名稱') || `${context.entityType} ${target.id}`;

  await notionRequest(`/v1/pages/${conversation.id}`, {
    method: 'PATCH',
    body: {
      properties: {
        'LINE 對話名稱': titleProperty(name),
        最後訊息時間: dateProperty(sentAt),
        最新訊息預覽: richTextProperty(preview),
        '訊息數（總）': { number: currentCount + messageCount },
      },
    },
  });
}

async function findOutgoingMessagePage(messageId) {
  const result = await notionRequest(`/v1/data_sources/${MESSAGES_DATA_SOURCE_ID}/query`, {
    method: 'POST',
    body: {
      page_size: 1,
      filter: { property: '訊息 ID', title: { equals: messageId } },
    },
  });

  return result.results?.[0] || null;
}

async function createOutgoingMessagePage({ conversationId, messageId, message, messageType, text, sentAt, target, context }) {
  const payload = {
    direction: 'outgoing',
    actorName: OUTGOING_ACTOR_NAME,
    target: { id: target.id, type: target.type || inferTargetType(target.id), name: target.name || '' },
    message,
    sentAt,
  };

  return notionRequest('/v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: MESSAGES_DATA_SOURCE_ID },
      properties: {
        '訊息 ID': titleProperty(messageId),
        'LINE 事件 ID': richTextProperty('outgoing-control-api'),
        'Webhook 重送序號': { number: 0 },
        對話主檔: relationProperty(conversationId),
        訊息來源: selectProperty('ai-engine'),
        訊息類型: selectProperty(messageType),
        文字內容: richTextProperty(text),
        原始內容: richTextProperty(text),
        '原始 payload': richTextProperty(JSON.stringify(payload)),
        '發話者 ID': richTextProperty(OUTGOING_ACTOR_NAME),
        發話者名稱: richTextProperty(OUTGOING_ACTOR_NAME),
        發話者類型: selectProperty('oa'),
        群組標記: checkboxProperty(['群組', '聊天室'].includes(context.entityType)),
        排序時間: dateProperty(sentAt),
      },
      children: [
        paragraphProperty(`來源：${OUTGOING_ACTOR_NAME} 主動發送`),
        paragraphProperty(text || '(非文字訊息)'),
      ],
    },
  });
}

async function appendOutgoingConversationContent({ conversationId, target, messages, sentAt }) {
  const blocks = [];

  messages.forEach((message, index) => {
    const messageType = normalizeOutgoingMessageType(message.type);
    const text = outgoingMessageText(message);
    const typeLabel = messageType === 'text' ? '文字訊息' : messageType;
    const meta = `【${formatTaipeiDateTime(sentAt)}】${OUTGOING_ACTOR_NAME}：${typeLabel}`;
    blocks.push(coloredParagraphProperty(meta, OUTGOING_BLOCK_COLOR));
    blocks.push(paragraphProperty(text || '(非文字訊息)'));
    if (index < messages.length - 1) {
      blocks.push(paragraphProperty(''));
    }
  });

  if (!blocks.length) {
    return;
  }

  const anchorBlock = await findConversationAnchorBlock(conversationId);
  await notionRequest(`/v1/blocks/${conversationId}/children`, {
    method: 'PATCH',
    body: { ...(anchorBlock ? { after: anchorBlock.id } : {}), children: blocks },
  });
}

async function findConversationAnchorBlock(conversationId) {
  const blocks = await getBlockChildren(conversationId);
  return blocks.find((block) => isConversationAnchorBlock(block)) || null;
}

async function getBlockChildren(blockId) {
  const blocks = [];
  let startCursor;
  do {
    const query = startCursor ? `?page_size=100&start_cursor=${encodeURIComponent(startCursor)}` : '?page_size=100';
    const result = await notionRequest(`/v1/blocks/${blockId}/children${query}`, { method: 'GET' });
    blocks.push(...(result.results || []));
    startCursor = result.has_more ? result.next_cursor : null;
  } while (startCursor);
  return blocks;
}

function plainBlockText(block) {
  const richText = block?.[block.type]?.rich_text || [];
  return richText.map((item) => item.plain_text || item.text?.content || '').join('');
}

function isConversationAnchorBlock(block) {
  const text = plainBlockText(block);
  return text.includes(CONVERSATION_ANCHOR_TEXT) || CONVERSATION_ANCHOR_PATTERN.test(text);
}

function buildOutgoingPreview(messages) {
  const text = messages.map(outgoingMessageText).filter(Boolean).join('\n');
  return text || `[${messages.length} outgoing message${messages.length > 1 ? 's' : ''}]`;
}

function outgoingMessageText(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (message?.type === 'text') {
    return message.text || '';
  }
  return message ? JSON.stringify(message) : '';
}

function normalizeOutgoingMessageType(messageType) {
  return ['text', 'image', 'sticker', 'file', 'location', 'video', 'audio'].includes(messageType) ? messageType : 'unsupported';
}

function buildOutgoingMessageId(target, message, sentAt, index) {
  const hash = createHash('sha256')
    .update(JSON.stringify({ targetId: target.id, message, sentAt, index }))
    .digest('hex')
    .slice(0, 16);
  return `out:${sentAt}:${target.id}:${index}:${hash}`;
}

async function notionRequest(pathname, { method, body }) {
  await assertHozoNotionTarget(pathname, body);

  const response = await fetch(`https://api.notion.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': process.env.NOTION_VERSION || '2025-09-03',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Notion API failed: ${response.status} ${responseText}`);
  }

  return responseText ? JSON.parse(responseText) : {};
}

async function assertHozoNotionTarget(pathname, body) {
  const dataSourceIds = new Set();
  const dataSourceMatch = String(pathname || '').match(/^\/v1\/data_sources\/([^/]+)\/query(?:\?|$)/);
  if (dataSourceMatch?.[1]) {
    dataSourceIds.add(dataSourceMatch[1]);
  }

  const parent = body?.parent;
  if (parent?.type === 'data_source_id' && parent.data_source_id) {
    dataSourceIds.add(parent.data_source_id);
  }

  for (const dataSourceId of dataSourceIds) {
    await assertHozoDataSource(dataSourceId);
  }
}

async function assertHozoDataSource(dataSourceId) {
  const normalizedId = normalizeId(dataSourceId);
  if (!normalizedId) {
    throw new Error('Missing HOZO Notion data source ID.');
  }
  if (verifiedHozoDataSources.has(normalizedId)) {
    return verifiedHozoDataSources.get(normalizedId);
  }

  const dataSource = await notionFetchJson(`/v1/data_sources/${encodeURIComponent(dataSourceId)}`);
  const dataSourceTitle = notionTitleText(dataSource.title);
  const databaseId = dataSource.parent?.database_id;
  if (!databaseId) {
    throw new Error(`Notion data source ${dataSourceTitle || dataSourceId} is not attached to a database.`);
  }

  const database = await notionFetchJson(`/v1/databases/${encodeURIComponent(databaseId)}`);
  const databaseTitle = notionTitleText(database.title);
  const parentId = normalizeId(database.parent?.block_id || database.parent?.page_id || '');

  if (dataSource.archived || dataSource.in_trash || database.archived || database.in_trash) {
    throw new Error(`Refusing to write to archived or trashed Notion data source: ${dataSourceTitle || dataSourceId}.`);
  }
  if (!/^HOZO(?:\b|-| | LINE| AM|CRM|好住|總控|Automation)/i.test(dataSourceTitle)) {
    throw new Error(`Refusing to write to non-HOZO Notion data source: ${dataSourceTitle || dataSourceId}.`);
  }
  const allowedParentIds = new Set([HOZO_DATA_SOURCE_PARENT_BLOCK_ID, HOZO_DATA_SOURCE_PARENT_PAGE_ID].filter(Boolean));
  if (allowedParentIds.size && !allowedParentIds.has(parentId)) {
    throw new Error(`Refusing to write outside the HOZO Notion database area: ${databaseTitle || databaseId}.`);
  }

  const result = { dataSourceTitle, databaseTitle, databaseId };
  verifiedHozoDataSources.set(normalizedId, result);
  return result;
}

async function notionFetchJson(pathname) {
  const response = await fetch(`https://api.notion.com${pathname}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': process.env.NOTION_VERSION || '2025-09-03',
    },
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Notion API failed: ${response.status} ${responseText}`);
  }
  return responseText ? JSON.parse(responseText) : {};
}

function notionTitleText(title) {
  return (title || []).map((item) => item.plain_text || item.text?.content || '').join('');
}

function normalizeId(value) {
  return String(value || '').replace(/-/g, '').toLowerCase();
}

function pageTextProperty(page, propertyName) {
  const property = page?.properties?.[propertyName];
  if (!property) {
    return '';
  }

  if (property.type === 'title') {
    return richTextPlain(property.title);
  }

  if (property.type === 'rich_text') {
    return richTextPlain(property.rich_text);
  }

  return '';
}

function pageSelectProperty(page, propertyName) {
  const property = page?.properties?.[propertyName];
  return property?.type === 'select' ? property.select?.name || '' : '';
}

function pageDateProperty(page, propertyName) {
  const property = page?.properties?.[propertyName];
  return property?.type === 'date' ? property.date?.start || '' : '';
}

function pageNumberProperty(page, propertyName) {
  const property = page?.properties?.[propertyName];
  return property?.type === 'number' ? Number(property.number || 0) : 0;
}

function pageRelationId(page, propertyName) {
  const property = page?.properties?.[propertyName];
  return property?.type === 'relation' ? property.relation?.[0]?.id || '' : '';
}

function taipeiDateOnly(value) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value instanceof Date ? value : new Date(value));
}

function taipeiStartOfDayIso(value) {
  return `${taipeiDateOnly(value instanceof Date ? value : new Date(value))}T00:00:00+08:00`;
}

function isTodayTaipei(value, today = taipeiDateOnly(new Date())) {
  if (!value) {
    return false;
  }
  return taipeiDateOnly(value) === today;
}

function escapeRegExp(value) {
  return escapeRegex(value);
}

function richTextPlain(items) {
  return (items || []).map((item) => item.plain_text || item.text?.content || '').join('');
}

function compactProperties(properties) {
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
}

function titleProperty(value) {
  return { title: [{ text: { content: clampNotionText(value) } }] };
}

function richTextProperty(value) {
  return { rich_text: [{ text: { content: clampNotionText(value) } }] };
}

function selectProperty(name) {
  return { select: { name } };
}

function multiSelectProperty(values) {
  return {
    multi_select: normalizeMultiSelect(values).map((name) => ({ name })),
  };
}

function numberProperty(value) {
  const number = Number(value);
  return { number: Number.isFinite(number) ? number : 0 };
}

function dateProperty(value) {
  return { date: { start: value instanceof Date ? value.toISOString() : new Date(value).toISOString() } };
}

function checkboxProperty(value) {
  return { checkbox: Boolean(value) };
}

function relationProperty(id) {
  return { relation: [{ id }] };
}

function urlProperty(value) {
  return { url: value };
}

function paragraphProperty(content) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: clampNotionText(content) } }] } };
}

function coloredParagraphProperty(content, color) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: { content: clampNotionText(content) },
        annotations: { color },
      }],
    },
  };
}

async function readJsonBody(req) {
  const rawBody = await readBody(req);
  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function clampLineText(value) {
  const text = String(value || '');
  return text.length > 4900 ? `${text.slice(0, 4897)}...` : text;
}

function clampNotionText(value) {
  const text = String(value || '');
  return text.length > 1900 ? `${text.slice(0, 1897)}...` : text;
}

function formatTaipeiDateTime(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value instanceof Date ? value : new Date(value));
}

function sendNoContent(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

async function serveReportPage(res, pathname) {
  const reportFile = REPORT_ROUTES.get(pathname);
  if (!reportFile) {
    return sendJson(res, 404, { error: 'Report not found' });
  }

  if (pathname === '/reports/morning-brief') {
    const model = process.env.NOTION_TOKEN && TASKS_DATA_SOURCE_ID
      ? await buildMorningBriefModel()
      : null;
    const html = buildMorningBriefHtml(model);

    res.writeHead(200, {
      ...corsHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  const html = readFileSync(new URL(reportFile, import.meta.url), 'utf8');
  res.writeHead(200, {
    ...corsHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

function buildMorningBriefHtml(model) {
  const reportDate = model?.today || taipeiDateOnly(new Date());
  const reportContent = model ? formatMorningBriefDecisionText(model) : [
    '# 今日行程與待辦報告',
    '',
    '目前無法讀取 HOZO 總控任務庫。',
    '請檢查 Notion 連線、NOTION_TOKEN 與 HOZO_TASKS_DATA_SOURCE_ID。',
  ].join('\n');
  const scheduleItems = model?.scheduleItems || [];
  const carryoverTasks = model?.carryoverTasks || [];
  const priorityTasks = model?.priorityTasks || [];
  const decisionTasks = model?.decisionTasks || [];
  const workBlocks = model?.workBlocks || [];
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HOZO-AM 早上 8 點半任務狀態晨報</title>
  <style>
    :root{--bg:#f6f7f4;--panel:#fff;--ink:#20242a;--muted:#66706b;--line:#d9ded6;--green:#2f6f5e;--blue:#315f8c;--red:#9d3b3b;--shadow:0 10px 28px rgba(23,30,26,.08)}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font-family:"Microsoft JhengHei","PingFang TC",system-ui,sans-serif;line-height:1.6}
    .app{min-height:100vh;display:grid;grid-template-columns:260px minmax(0,1fr)}
    aside{position:sticky;top:0;height:100vh;padding:24px 18px;background:#24342f;color:#f4f7f2}
    .brand strong{display:block;font-size:20px}
    .brand span{display:block;margin-top:4px;color:#bed0c7;font-size:13px}
    nav{display:grid;gap:8px;margin-top:28px}
    nav a{color:#dce7e1;text-decoration:none;padding:9px 10px;border-radius:6px}
    nav a:hover{background:rgba(255,255,255,.08)}
    main{padding:28px}
    .top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}
    h1{margin:0;font-size:28px;line-height:1.25}
    .subtitle{margin-top:6px;color:var(--muted)}
    .date-card{min-width:180px;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;box-shadow:var(--shadow);text-align:right}
    .date-card strong{display:block;font-size:20px}
    .date-card span{display:block;color:var(--muted);font-size:13px}
    .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:20px}
    .metric{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);padding:14px}
    .metric strong{display:block;font-size:24px}
    .metric span{color:var(--muted);font-size:13px}
    section{background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);margin-bottom:20px;overflow:hidden}
    .head{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);background:#fbfcfa}
    .head h2{margin:0;font-size:18px}
    .note{color:var(--muted);font-size:13px}
    .schedule,.cards,.work{display:grid;gap:12px;padding:16px}
    .item{border:1px solid var(--line);border-radius:8px;padding:12px;background:#fff}
    .item-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
    .item-title{font-weight:700}
    .badge{display:inline-flex;align-items:center;border-radius:999px;padding:3px 8px;font-size:12px;background:#edf3ef;color:#2f6f5e;white-space:nowrap}
    .badge.red{background:#fff0f0;color:#9d3b3b}
    .badge.blue{background:#edf4fb;color:#315f8c}
    .item p{margin:8px 0 0;color:var(--muted)}
    table{width:100%;border-collapse:collapse}
    th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
    th{font-size:13px;color:var(--muted);background:#fbfcfa}
    .empty{padding:16px;color:var(--muted)}
    textarea{width:100%;min-height:170px;resize:vertical;border:1px solid var(--line);border-radius:6px;background:#fff;padding:9px 10px;color:var(--ink);font:inherit;line-height:1.6}
    .actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;margin-top:16px}
    .btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;padding:9px 14px;cursor:pointer}
    .btn.primary{border-color:var(--green);background:var(--green);color:#fff}
    .btn:disabled{opacity:.65;cursor:wait}
    .result{display:none;margin-top:16px;padding:14px 16px;border:1px solid #bfd9cd;background:#edf6f1;border-radius:8px;color:#1f4e42}
    .result.show{display:block}
    .result.error{border-color:#efc3c3;background:#fff0f0;color:#873333}
    @media(max-width:820px){.app{display:block}aside{position:static;height:auto}.top{display:block}.date-card{text-align:left;margin-top:12px}main{padding:16px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <div class="app">
    <aside>
      <div class="brand"><strong>早上 8 點半簡報</strong><span>HOZO 行程、待辦、今日優先</span></div>
      <nav><a href="#calendar">今日行程</a><a href="#carryover">昨日未完成</a><a href="#priority">今日優先</a><a href="#decisions">需要決策</a><a href="#work">建議時段</a><a href="#writeback">確認寫回</a></nav>
    </aside>
    <main>
      <div class="top">
        <div><h1>今日行程與待辦報告</h1><div class="subtitle">每天早上 8 點半，先把今天的時間、昨天留下來的事情、最該推進的工作排清楚。</div></div>
        <div class="date-card"><strong>${escapeHtml(reportDate)}</strong><span>08:30｜Asia/Taipei</span></div>
      </div>
      <div class="metrics">
        <div class="metric"><strong>${scheduleItems.length}</strong><span>今日行程</span></div>
        <div class="metric"><strong>${carryoverTasks.length}</strong><span>昨日未完成</span></div>
        <div class="metric"><strong>${priorityTasks.length}</strong><span>今日優先</span></div>
        <div class="metric"><strong>${decisionTasks.length}</strong><span>需決策</span></div>
      </div>
      <section id="calendar"><div class="head"><h2>今日行程</h2><span class="note">由 HOZO 報告時段與本案任務節奏整理</span></div><div class="schedule">${renderMorningScheduleItems(scheduleItems)}</div></section>
      <section id="carryover"><div class="head"><h2>昨日未完成與延續事項</h2><span class="note">由 HOZO 總控任務庫整理</span></div>${renderMorningTaskTable(carryoverTasks, '今日處理')}</section>
      <section id="priority"><div class="head"><h2>今天建議優先處理</h2><span class="note">3 到 7 件，避免一天被切太碎</span></div><div class="cards">${renderMorningTaskCards(priorityTasks)}</div></section>
      <section id="decisions"><div class="head"><h2>今天需要你決策或回覆</h2><span class="note">高風險或模糊事項不自動推進</span></div>${renderMorningDecisionTable(decisionTasks)}</section>
      <section id="work"><div class="head"><h2>今日建議工作時段</h2><span class="note">依 HOZO 固定報告節奏安排</span></div><div class="work">${renderMorningWorkBlocks(workBlocks)}</div></section>
      <section id="writeback"><div class="head"><h2>修改後早報內容</h2><span class="note">確認後會寫回 HOZO 風險與決策庫</span></div><div style="padding:16px"><textarea id="reportContent">${escapeHtml(reportContent)}</textarea></div></section>
      <div class="actions"><button class="btn primary js-confirm" onclick="confirmBrief()">確認並寫回</button></div><div class="result" id="result"></div>
    </main>
  </div>
  <script>
    const APPROVAL_API='/control/reports/approve';
    async function confirmBrief(){
      const result=document.getElementById('result');
      const buttons=document.querySelectorAll('.js-confirm');
      buttons.forEach(button=>{button.disabled=true;button.textContent='寫回中...'});
      result.className='result show';
      result.innerHTML='<strong>正在寫回早報確認...</strong>';
      const reportContent=document.getElementById('reportContent').value.trim();
      try{
        const response=await fetch(APPROVAL_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportType:'morning',approvedBy:'陸昱晴',submittedAt:new Date().toISOString(),reportContent,decisions:[],tasks:[],notes:'08:30 HOZO-AM 動態早報確認寫回'})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.ok){throw new Error(data.error||'寫回失敗')}
        result.className='result show';
        result.innerHTML='<strong>早報已寫回 Notion。</strong><br><span>已建立 HOZO-AM 早報確認紀錄。</span>';
      }catch(error){
        result.className='result show error';
        result.innerHTML='<strong>寫回失敗。</strong><br>'+escapeHtml(error.message||'未知錯誤');
      }finally{
        buttons.forEach(button=>{button.disabled=false;button.textContent='確認並寫回'});
        result.scrollIntoView({behavior:'smooth',block:'nearest'});
      }
    }
    function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
  </script>
</body>
</html>`;
}

function formatMorningBriefDecisionText(model) {
  return [
    '# 今日行程與待辦報告',
    '',
    `日期：${model.today}｜08:30`,
    '',
    '## 今日優先處理',
    ...model.priorityTasks.map((task, index) => `${index + 1}. ${task.name}｜${morningTaskAction(task)}`),
    '',
    '## 需要決策或回覆',
    ...model.decisionTasks.map((task, index) => `${index + 1}. ${task.name}｜建議：${morningDecisionSuggestion(task)}`),
    '',
    '## 今日建議工作時段',
    ...model.workBlocks.map((item) => `${item.time} ${item.note}`),
  ].join('\n');
}

function renderMorningScheduleItems(items) {
  if (!items.length) return '<div class="empty">目前沒有行程資料。</div>';
  return items.map((item) => `<article class="item">
    <div class="item-head"><div><div class="item-title">${escapeHtml(item.time)}　${escapeHtml(item.title)}</div><p>${escapeHtml(item.note)}</p></div><span class="badge blue">${escapeHtml(item.tag || '行程')}</span></div>
  </article>`).join('');
}

function renderMorningTaskTable(tasks, actionHeader) {
  if (!tasks.length) return '<div class="empty">目前沒有昨日延續事項。</div>';
  const rows = tasks.map((task) => `<tr>
    <td>${escapeHtml(morningTaskAction(task))}</td>
    <td>${escapeHtml(task.name)}</td>
    <td>${escapeHtml(task.project)}</td>
    <td>${escapeHtml(task.status)}</td>
    <td>${escapeHtml(task.priority)}</td>
  </tr>`).join('');
  return `<table><thead><tr><th>${escapeHtml(actionHeader)}</th><th>事項</th><th>專案</th><th>狀態</th><th>優先</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMorningTaskCards(tasks) {
  if (!tasks.length) return '<div class="empty">目前沒有建議優先處理事項。</div>';
  return tasks.map((task, index) => `<article class="item">
    <div class="item-head"><div><div class="item-title">${index + 1}. ${escapeHtml(task.name)}</div><p>${escapeHtml(morningTaskAction(task))}</p></div><span class="badge">${escapeHtml(task.project)}</span></div>
  </article>`).join('');
}

function renderMorningDecisionTable(tasks) {
  if (!tasks.length) return '<div class="empty">目前沒有需要決策或回覆的項目。</div>';
  const rows = tasks.map((task) => `<tr>
    <td>${escapeHtml(task.name)}<br><span class="note">${escapeHtml(task.project)}｜${escapeHtml(task.status)}</span></td>
    <td>${escapeHtml(morningDecisionSuggestion(task))}</td>
    <td><span class="badge red">今天確認</span></td>
  </tr>`).join('');
  return `<table><thead><tr><th>事項</th><th>建議</th><th>你的決定</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMorningWorkBlocks(items) {
  if (!items.length) return '<div class="empty">目前沒有建議工作時段。</div>';
  return items.map((item) => `<article class="item"><div class="item-title">${escapeHtml(item.time)}</div><p>${escapeHtml(item.note)}</p></article>`).join('');
}

function morningDecisionSuggestion(task) {
  if (['待負責人口述', '待上傳給 Codex', 'Codex 待確認', '需補充'].includes(task.goalStatus)) {
    return `請 ${task.owner || '負責人'} 說明完成目標、驗收標準與誰確認。`;
  }
  if (task.status === '等待回覆') return '今天先追問回覆；若仍未回覆，列入 17:00 跟催。';
  if (task.status === '待確認完成') return '請確認是否可關閉；若不可關閉，補下一步與期限。';
  return morningTaskAction(task);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...corsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, x-hozo-control-key, x-hozo-approval-key',
  };
}

function loadDotenv() {
  if (!existsSync('.env')) {
    return;
  }

  const envFile = readFileSync('.env', 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
