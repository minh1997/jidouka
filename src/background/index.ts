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

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_STATE': {
        await broadcastState();
        break;
      }
      case 'START_RECORDING': {
        await setStatus('recording');
        await sendToActiveTab({ type: 'CONTENT_START_RECORDING' });
        await broadcastState();
        break;
      }
      case 'STOP_RECORDING': {
        await setStatus('idle');
        await sendToActiveTab({ type: 'CONTENT_STOP_RECORDING' });
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
        const actions = await getActions();
        actions.push(message.action);
        await setActions(actions);
        await broadcastState();
        break;
      }
    }
  })();
  // We respond asynchronously; keep the channel open.
  sendResponse?.(undefined);
  return false;
});
