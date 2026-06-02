import type { ExtMessage, RecordedAction, RecordingStatus } from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';

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

async function getStatus(): Promise<RecordingStatus> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.status);
  return (data[STORAGE_KEYS.status] as RecordingStatus) ?? 'idle';
}

async function setStatus(status: RecordingStatus): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.status]: status });
}

async function broadcastState(): Promise<void> {
  const [status, actions] = await Promise.all([getStatus(), getActions()]);
  const msg: ExtMessage = { type: 'STATE', status, actions };
  // Sent to the side panel. Ignore errors when no receiver is listening.
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function sendToActiveTab(msg: ExtMessage): Promise<void> {
  const tab = await getActiveTab();
  if (tab?.id != null) {
    chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
  }
}

// The tab we are currently recording, so navigation in other tabs is ignored.
let recordingTabId: number | null = null;

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
  (async () => {
    switch (message.type) {
      case 'GET_STATE': {
        await broadcastState();
        break;
      }
      case 'START_RECORDING': {
        await setStatus('recording');
        const tab = await getActiveTab();
        recordingTabId = tab?.id ?? null;
        await sendToActiveTab({ type: 'CONTENT_START_RECORDING' });
        await broadcastState();
        break;
      }
      case 'STOP_RECORDING': {
        await setStatus('idle');
        await sendToActiveTab({ type: 'CONTENT_STOP_RECORDING' });
        recordingTabId = null;
        await broadcastState();
        break;
      }
      case 'CLEAR_RECORDING': {
        await setActions([]);
        await broadcastState();
        break;
      }
      case 'START_REPLAY': {
        const actions = await getActions();
        if (actions.length === 0) break;
        await setStatus('replaying');
        await broadcastState();
        await sendToActiveTab({ type: 'CONTENT_REPLAY', actions });
        break;
      }
      case 'STOP_REPLAY':
      case 'REPLAY_FINISHED': {
        await setStatus('idle');
        await broadcastState();
        break;
      }
      case 'ACTION_RECORDED': {
        await appendAction(message.action);
        break;
      }
    }
  })();
  // We respond asynchronously; keep the channel open.
  sendResponse?.(undefined);
  return false;
});

// Record full-page navigations while recording (the SPA URL poll in the
// content script only catches same-document history changes).
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== recordingTabId || !changeInfo.url) return;
  void (async () => {
    if ((await getStatus()) !== 'recording') return;
    await appendAction({
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      type: 'navigate',
      selector: '',
      label: `Go to ${changeInfo.url}`,
      value: changeInfo.url,
      fingerprint: null,
      url: changeInfo.url!,
      delay: 0,
      timestamp: Date.now(),
    });
  })();
});
