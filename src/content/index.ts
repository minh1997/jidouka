import type { ExtMessage, RecordedAction, RecordingStatus } from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';
import { buildSelector } from './selector';

let recording = false;
let lastActionTime = Date.now();

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nextDelay(): number {
  const now = Date.now();
  const delay = Math.min(now - lastActionTime, 10_000);
  lastActionTime = now;
  return delay;
}

function emit(partial: Omit<RecordedAction, 'id' | 'url' | 'delay' | 'timestamp'>): void {
  const action: RecordedAction = {
    id: uid(),
    url: location.href,
    delay: nextDelay(),
    timestamp: Date.now(),
    ...partial,
  };
  const msg: ExtMessage = { type: 'ACTION_RECORDED', action };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const aria = el.getAttribute('aria-label');
  const name = (el as HTMLInputElement).name;
  return aria || text || name || tag;
}

// --- Recording listeners (capture phase so we see events before the page) ---

function onClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (!target) return;
  emit({ type: 'click', selector: buildSelector(target), label: elementLabel(target) });
}

function onChange(e: Event): void {
  const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!target) return;
  const isCheckable =
    target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio');
  emit({
    type: 'change',
    selector: buildSelector(target),
    label: elementLabel(target),
    value: isCheckable ? String((target as HTMLInputElement).checked) : target.value,
  });
}

function onInput(e: Event): void {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  // Skip checkboxes/radios; those are handled by 'change'.
  if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio'))
    return;
  emit({
    type: 'input',
    selector: buildSelector(target),
    label: elementLabel(target),
    value: target.value,
  });
}

function onSubmit(e: Event): void {
  const target = e.target as Element | null;
  if (!target) return;
  emit({ type: 'submit', selector: buildSelector(target), label: elementLabel(target) });
}

function onKeydown(e: KeyboardEvent): void {
  // Only record meaningful keys to avoid noise from every keystroke.
  if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;
  const target = e.target as Element | null;
  emit({
    type: 'keydown',
    selector: target ? buildSelector(target) : '',
    label: `Key: ${e.key}`,
    key: e.key,
  });
}

function startRecording(): void {
  if (recording) return;
  recording = true;
  lastActionTime = Date.now();
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('keydown', onKeydown, true);
}

function stopRecording(): void {
  if (!recording) return;
  recording = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('change', onChange, true);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('submit', onSubmit, true);
  document.removeEventListener('keydown', onKeydown, true);
}

// --- Replay -----------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForElement(selector: string, timeout = 5000): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);
    const start = Date.now();
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      } else if (Date.now() - start > timeout) {
        observer.disconnect();
        resolve(null);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector(selector));
    }, timeout);
  });
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  desc?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function performAction(action: RecordedAction): Promise<void> {
  if (action.type === 'navigate') {
    if (action.value && action.value !== location.href) location.href = action.value;
    return;
  }
  const el = (await waitForElement(action.selector)) as HTMLElement | null;
  if (!el) {
    console.warn('[jidouka] replay: element not found for', action.selector);
    return;
  }
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });

  switch (action.type) {
    case 'click':
      el.click();
      break;
    case 'input':
    case 'change':
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        el.checked = action.value === 'true';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        setNativeValue(el, action.value ?? '');
      } else if (el instanceof HTMLSelectElement) {
        el.value = action.value ?? '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      break;
    case 'submit':
      if (el instanceof HTMLFormElement) el.requestSubmit();
      break;
    case 'keydown':
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: action.key, bubbles: true }),
      );
      break;
  }
}

async function runReplay(actions: RecordedAction[]): Promise<void> {
  let cursor = await getCursor();
  for (; cursor < actions.length; cursor++) {
    const action = actions[cursor];
    await sleep(Math.min(action.delay, 3000));
    const willNavigate = action.type === 'navigate' && action.value !== location.href;
    if (willNavigate) {
      // Persist progress so replay resumes after the page reloads.
      await setCursor(cursor + 1);
      await performAction(action);
      return; // page unloads here
    }
    await performAction(action);
  }
  await setCursor(0);
  chrome.runtime.sendMessage({ type: 'REPLAY_FINISHED' } satisfies ExtMessage).catch(() => {});
}

async function getCursor(): Promise<number> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.replayCursor);
  return (data[STORAGE_KEYS.replayCursor] as number) ?? 0;
}

async function setCursor(value: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.replayCursor]: value });
}

async function getStatus(): Promise<RecordingStatus> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.status);
  return (data[STORAGE_KEYS.status] as RecordingStatus) ?? 'idle';
}

async function getActions(): Promise<RecordedAction[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.actions);
  return (data[STORAGE_KEYS.actions] as RecordedAction[]) ?? [];
}

// --- Message handling -------------------------------------------------------

chrome.runtime.onMessage.addListener((message: ExtMessage) => {
  switch (message.type) {
    case 'CONTENT_START_RECORDING':
      startRecording();
      break;
    case 'CONTENT_STOP_RECORDING':
      stopRecording();
      break;
    case 'CONTENT_REPLAY':
      void runReplay(message.actions);
      break;
  }
});

// On (re)load, resume whatever the extension was doing on this tab.
async function init(): Promise<void> {
  const status = await getStatus();
  if (status === 'recording') {
    startRecording();
  } else if (status === 'replaying') {
    const actions = await getActions();
    if (actions.length) void runReplay(actions);
  }
}

void init();
