import type { ExtMessage, RecordedAction, RecordingStatus, Workflow } from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';

const MAX_WORKFLOWS = 20;

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[jidouka] setPanelBehavior failed', err));
});

async function getActions(): Promise<RecordedAction[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.actions);
  return (data[STORAGE_KEYS.actions] as RecordedAction[]) ?? [];
}

async function setActions(actions: RecordedAction[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.actions]: actions });
}

async function getWorkflows(): Promise<Workflow[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.workflows);
  return (data[STORAGE_KEYS.workflows] as Workflow[]) ?? [];
}

async function setWorkflows(workflows: Workflow[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.workflows]: workflows });
}

async function getStatus(): Promise<RecordingStatus> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.status);
  return (data[STORAGE_KEYS.status] as RecordingStatus) ?? 'idle';
}

async function setStatus(status: RecordingStatus): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.status]: status });
}

async function getStoredTabId(key: string): Promise<number | null> {
  const data = await chrome.storage.local.get(key);
  const value = data[key];
  return typeof value === 'number' ? value : null;
}

async function setStoredTabId(key: string, tabId: number | null): Promise<void> {
  await chrome.storage.local.set({ [key]: tabId });
}

async function getRecordingTabId(): Promise<number | null> {
  return getStoredTabId(STORAGE_KEYS.recordingTabId);
}

async function setRecordingTabId(tabId: number | null): Promise<void> {
  await setStoredTabId(STORAGE_KEYS.recordingTabId, tabId);
}

async function getReplayTabId(): Promise<number | null> {
  return getStoredTabId(STORAGE_KEYS.replayTabId);
}

async function setReplayTabId(tabId: number | null): Promise<void> {
  await setStoredTabId(STORAGE_KEYS.replayTabId, tabId);
}

async function broadcastState(): Promise<void> {
  const [status, currentRecording, workflows] = await Promise.all([
    getStatus(),
    getActions(),
    getWorkflows(),
  ]);
  const msg: ExtMessage = { type: 'STATE', status, currentRecording, workflows };
  // Sent to the side panel. Ignore errors when no receiver is listening.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function sendToTab(tabId: number | null | undefined, msg: ExtMessage): Promise<void> {
  if (tabId != null) {
    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
  }
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: 'PING' } satisfies ExtMessage)) as
      | { alive?: boolean }
      | undefined;
    return response?.alive === true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<boolean> {
  if (await pingContentScript(tabId)) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });
    await sleep(100);
    return await pingContentScript(tabId);
  } catch (err) {
    console.warn('[jidouka] content script injection failed', err);
    return false;
  }
}

async function getContentSessionState(tabId: number | undefined): Promise<{ shouldRecord: boolean }> {
  const [status, recordingTabId] = await Promise.all([
    getStatus(),
    getRecordingTabId(),
  ]);

  return {
    shouldRecord: status === 'recording' && tabId != null && recordingTabId === tabId,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNavigateAction(url: string, pageTitle?: string): RecordedAction {
  return {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    type: 'navigate',
    selector: '',
    label: `Go to ${url}`,
    value: url,
    fingerprint: null,
    url,
    pageTitle: pageTitle || '',
    delay: 0,
    timestamp: Date.now(),
  };
}

function buildWorkflow(actions: RecordedAction[]): Workflow {
  const now = new Date();
  const createdAt = now.toISOString();
  const startUrl =
    actions.find((action) => action.type === 'navigate' && action.value)?.value || actions[0]?.url || '';

  return {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    name: `Workflow ${now.toLocaleString()}`,
    createdAt,
    updatedAt: createdAt,
    startUrl,
    steps: actions.map((action) => ({ ...action })),
  };
}

async function beginReplay(tabId: number): Promise<void> {
  await Promise.all([
    setStatus('replaying'),
    setReplayTabId(tabId),
    setRecordingTabId(null),
  ]);
  await broadcastState();
}

async function waitForTabComplete(tabId: number, timeout = 15_000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, timeout);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || info.status !== 'complete' || settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(true);
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitForNavigationOrTimeout(tabId: number, timeout = 800): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    const listener = (updatedTabId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId !== tabId || info.status !== 'complete' || settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function executeWorkflowStep(tabId: number, step: RecordedAction): Promise<void> {
  if (step.type === 'navigate') {
    const nextUrl = step.value || step.url;
    const currentTab = await chrome.tabs.get(tabId);
    if (!nextUrl || currentTab.url === nextUrl) return;
    await chrome.tabs.update(tabId, { url: nextUrl });
    await waitForTabComplete(tabId);
    await ensureContentScript(tabId);
    return;
  }

  if (!(await ensureContentScript(tabId))) return;

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'CONTENT_EXECUTE_ACTION',
      action: step,
    } satisfies ExtMessage);
  } catch {
    // Clicks or submits that unload the page can close the message channel.
  }

  await waitForNavigationOrTimeout(tabId);
}

async function replayWorkflowSteps(tabId: number, workflow: Workflow): Promise<void> {
  try {
    if (workflow.startUrl) {
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab.url !== workflow.startUrl) {
        await chrome.tabs.update(tabId, { url: workflow.startUrl });
        await waitForTabComplete(tabId);
      }
      await ensureContentScript(tabId);
    }

    for (const step of workflow.steps) {
      const [status, replayTabId] = await Promise.all([getStatus(), getReplayTabId()]);
      if (status !== 'replaying' || replayTabId !== tabId) return;
      await sleep(Math.min(step.delay, 3000));
      await executeWorkflowStep(tabId, step);
    }
  } finally {
    await Promise.all([
      setStatus('idle'),
      setReplayTabId(null),
    ]);
    await broadcastState();
  }
}

function isSameTarget(a: RecordedAction, b: RecordedAction): boolean {
  const fa = a.fingerprint?.selectors;
  const fb = b.fingerprint?.selectors;
  if (fa && fb) {
    if (fa.id && fb.id) return fa.id === fb.id;
    if (fa.cssPath && fb.cssPath) return fa.cssPath === fb.cssPath;
  }
  return a.selector !== '' && a.selector === b.selector;
}

// Append an action with WebWright-style de-duplication:
//  - consecutive "type" into the same field → replace the previous value
//  - consecutive "navigate" to the same URL → ignore
async function appendAction(action: RecordedAction): Promise<void> {
  const actions = await getActions();
  const last = actions[actions.length - 1];

  if (last) {
    if (action.type === 'type' && last.type === 'type' && isSameTarget(last, action)) {
      actions[actions.length - 1] = { ...action, id: last.id, delay: last.delay };
      await setActions(actions);
      await broadcastState();
      return;
    }
    if (action.type === 'navigate' && last.type === 'navigate' && last.value === action.value) {
      return; // duplicate navigation, skip
    }
  }

  actions.push(action);
  await setActions(actions);
  await broadcastState();
}

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  void (async () => {
    let response:
      | { shouldRecord: boolean }
      | undefined;

    try {
      switch (message.type) {
        case 'GET_STATE': {
          await broadcastState();
          break;
        }
        case 'GET_CONTENT_SESSION_STATE': {
          response = await getContentSessionState(_sender.tab?.id);
          break;
        }
        case 'START_RECORDING': {
          const tab = await getActiveTab();
          if (tab?.id == null) break;
          if (!(await ensureContentScript(tab.id))) break;
          await Promise.all([
            setStatus('recording'),
            setRecordingTabId(tab.id),
            setReplayTabId(null),
            setActions([]),
          ]);
          if (tab.url) {
            await appendAction(buildNavigateAction(tab.url, tab.title));
          }
          await sendToTab(tab.id, { type: 'CONTENT_START_RECORDING' });
          await broadcastState();
          break;
        }
        case 'STOP_RECORDING': {
          const [recordingTabId, currentRecording, workflows] = await Promise.all([
            getRecordingTabId(),
            getActions(),
            getWorkflows(),
          ]);
          await Promise.all([
            setStatus('idle'),
            setRecordingTabId(null),
            setActions([]),
          ]);
          await sendToTab(recordingTabId, { type: 'CONTENT_STOP_RECORDING' });
          if (currentRecording.length > 0) {
            await setWorkflows([buildWorkflow(currentRecording), ...workflows].slice(0, MAX_WORKFLOWS));
          }
          await broadcastState();
          break;
        }
        case 'REPLAY_WORKFLOW': {
          const [workflows, tab] = await Promise.all([getWorkflows(), getActiveTab()]);
          if (tab?.id == null) break;
          if (!(await ensureContentScript(tab.id))) break;
          const workflow = workflows.find((item) => item.id === message.workflowId);
          if (!workflow) break;
          await beginReplay(tab.id);
          void replayWorkflowSteps(tab.id, workflow);
          break;
        }
        case 'DELETE_WORKFLOW': {
          const workflows = await getWorkflows();
          await setWorkflows(workflows.filter((workflow) => workflow.id !== message.workflowId));
          await broadcastState();
          break;
        }
        case 'STOP_REPLAY': {
          await Promise.all([
            setStatus('idle'),
            setReplayTabId(null),
          ]);
          await broadcastState();
          break;
        }
        case 'ACTION_RECORDED': {
          const recordingTabId = await getRecordingTabId();
          if (_sender.tab?.id === recordingTabId) {
            await appendAction(message.action);
          }
          break;
        }
      }
    } catch (err) {
      console.error('[jidouka] message handling failed', err);
    }

    sendResponse(response);
  })();
  return true;
});

// Record full-page navigations while recording (the SPA URL poll in the
// content script only catches same-document history changes).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void (async () => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    if ((await getStatus()) !== 'recording') return;
    if (tabId !== (await getRecordingTabId())) return;
    await appendAction(buildNavigateAction(tab.url, tab.title));

    // Re-arm recording on the new page so the recording session stays scoped
    // to the workflow tab across full navigations.
    if (!(await ensureContentScript(tabId))) return;
    await sendToTab(tabId, { type: 'CONTENT_START_RECORDING' });
  })();
});
