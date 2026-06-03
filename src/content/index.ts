import type { ExtMessage, ElementFingerprint, RecordedAction, RecordingStatus } from '../shared/types';
import { STORAGE_KEYS } from '../shared/types';
import { buildElementFingerprint, primarySelector, resolveByFingerprint } from './fingerprint';

let recording = false;
let lastActionTime = Date.now();
let replayRunToken = 0;

// Debounced "type" buffering: we collapse a burst of keystrokes in one field
// into a single type action when focus leaves or another action happens.
let pendingInput: {
  el: HTMLInputElement | HTMLTextAreaElement;
  fingerprint: ElementFingerprint | null;
} | null = null;
let pendingInputTimer: number | null = null;

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function nextDelay(): number {
  const now = Date.now();
  const delay = Math.min(now - lastActionTime, 10_000);
  lastActionTime = now;
  return delay;
}

function describeRecordedAction(
  type: RecordedAction['type'],
  fp: ElementFingerprint | null,
  value?: string,
): string {
  const target = fp?.text || fp?.ariaLabel || fp?.placeholder || fp?.tag || 'element';
  switch (type) {
    case 'click':
      return `Click on "${target}"`;
    case 'type':
      return `Type "${value ?? ''}" in "${fp?.placeholder || fp?.ariaLabel || target}"`;
    case 'select':
      return `Select "${value ?? ''}" in "${target}"`;
    case 'submit':
      return `Submit "${target}"`;
    case 'key':
      return `Press ${value} on "${target}"`;
    case 'navigate':
      return `Go to ${value ?? ''}`;
    default:
      return `${type} on "${target}"`;
  }
}

function emit(partial: {
  type: RecordedAction['type'];
  fingerprint: ElementFingerprint | null;
  value?: string;
  key?: string;
  isParam?: boolean;
}): void {
  const action: RecordedAction = {
    id: uid(),
    type: partial.type,
    fingerprint: partial.fingerprint,
    selector: primarySelector(partial.fingerprint),
    label: describeRecordedAction(partial.type, partial.fingerprint, partial.value),
    value: partial.value,
    key: partial.key,
    isParam: partial.isParam,
    url: location.href,
    pageTitle: document.title,
    delay: nextDelay(),
    timestamp: Date.now(),
  };
  const msg: ExtMessage = { type: 'ACTION_RECORDED', action };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

// --- Recording listeners (capture phase so we see events before the page) ---

function flushPendingInput(): void {
  if (pendingInputTimer != null) {
    clearTimeout(pendingInputTimer);
    pendingInputTimer = null;
  }
  if (!pendingInput) return;
  const { el, fingerprint } = pendingInput;
  pendingInput = null;
  emit({ type: 'type', fingerprint, value: el.value, isParam: true });
}

function onClick(e: MouseEvent): void {
  const target = e.target as Element | null;
  if (!target) return;
  // Commit any buffered typing before recording the click.
  flushPendingInput();
  emit({ type: 'click', fingerprint: buildElementFingerprint(target) });
}

function onInput(e: Event): void {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  if (target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio'))
    return; // handled by change/click

  // If focus moved to a different element, flush the previous one first.
  if (pendingInput && pendingInput.el !== target) flushPendingInput();

  pendingInput = { el: target, fingerprint: buildElementFingerprint(target) };
  if (pendingInputTimer != null) clearTimeout(pendingInputTimer);
  pendingInputTimer = window.setTimeout(flushPendingInput, 600);
}

function onChange(e: Event): void {
  const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!target) return;
  if (target instanceof HTMLSelectElement) {
    flushPendingInput();
    emit({ type: 'select', fingerprint: buildElementFingerprint(target), value: target.value });
  } else if (
    target instanceof HTMLInputElement &&
    (target.type === 'checkbox' || target.type === 'radio')
  ) {
    flushPendingInput();
    emit({
      type: 'click',
      fingerprint: buildElementFingerprint(target),
      value: String(target.checked),
    });
  }
}

function onSubmit(e: Event): void {
  const target = e.target as Element | null;
  if (!target) return;
  flushPendingInput();
  emit({ type: 'submit', fingerprint: buildElementFingerprint(target) });
}

function onKeydown(e: KeyboardEvent): void {
  // Only record meaningful keys to avoid noise from every keystroke.
  if (!['Enter', 'Tab', 'Escape'].includes(e.key)) return;
  const target = e.target as Element | null;
  // Enter inside a text field usually submits; flush the typed value first.
  flushPendingInput();
  emit({
    type: 'key',
    fingerprint: target ? buildElementFingerprint(target) : null,
    key: e.key,
    value: e.key,
  });
}

// SPA navigation detection: many sites change the URL without a full reload.
let lastUrl = location.href;
let urlPoll: number | null = null;

function pollUrl(): void {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    flushPendingInput();
    emit({ type: 'navigate', fingerprint: null, value: location.href });
  }
}

function startRecording(): void {
  if (recording) return;
  recording = true;
  lastActionTime = Date.now();
  lastUrl = location.href;
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('keydown', onKeydown, true);
  urlPoll = window.setInterval(pollUrl, 500);
}

function stopRecording(): void {
  if (!recording) return;
  flushPendingInput();
  recording = false;
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('change', onChange, true);
  document.removeEventListener('input', onInput, true);
  document.removeEventListener('submit', onSubmit, true);
  document.removeEventListener('keydown', onKeydown, true);
  if (urlPoll != null) {
    clearInterval(urlPoll);
    urlPoll = null;
  }
}

function stopReplay(): void {
  replayRunToken += 1;
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

// Resolve an action's target: try the primary selector first, then fall back
// to fuzzy fingerprint scoring (survives DOM re-renders / changed selectors).
async function resolveTarget(action: RecordedAction): Promise<HTMLElement | null> {
  if (action.selector) {
    const el = (await waitForElement(action.selector)) as HTMLElement | null;
    if (el) return el;
  }
  if (action.fingerprint) {
    const fuzzy = resolveByFingerprint(action.fingerprint);
    if (fuzzy) return fuzzy;
    // Give a re-rendering page a moment, then retry fuzzy once.
    await sleep(400);
    return resolveByFingerprint(action.fingerprint);
  }
  return null;
}

async function performAction(action: RecordedAction): Promise<void> {
  if (action.type === 'navigate') {
    if (action.value && action.value !== location.href) location.href = action.value;
    return;
  }

  const el = await resolveTarget(action);
  if (!el) {
    console.warn('[jidouka] replay: element not found for', action.label);
    return;
  }
  el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });

  switch (action.type) {
    case 'click':
      if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
        const want = action.value === 'true';
        if (el.checked !== want) el.click();
      } else {
        el.click();
      }
      break;
    case 'type':
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        setNativeValue(el, action.value ?? '');
      } else if ((el as HTMLElement).isContentEditable) {
        (el as HTMLElement).textContent = action.value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      break;
    case 'select':
      if (el instanceof HTMLSelectElement) {
        el.value = action.value ?? '';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      break;
    case 'submit':
      if (el instanceof HTMLFormElement) el.requestSubmit();
      else el.closest('form')?.requestSubmit();
      break;
    case 'key':
      el.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: action.key, bubbles: true }));
      break;
  }
}

async function runReplay(actions: RecordedAction[]): Promise<void> {
  const runToken = ++replayRunToken;
  let cursor = await getCursor();
  for (; cursor < actions.length; cursor++) {
    if (runToken !== replayRunToken) return;
    const action = actions[cursor];
    await sleep(Math.min(action.delay, 3000));
    if (runToken !== replayRunToken) return;
    // Persist the next step before firing the action so full-page navigations
    // caused by clicks/submits can resume on the new document.
    await setCursor(cursor + 1);
    const willNavigate = action.type === 'navigate' && action.value !== location.href;
    if (willNavigate) {
      await performAction(action);
      return; // page unloads here
    }
    await performAction(action);
  }
  if (runToken !== replayRunToken) return;
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

type ContentSessionState = {
  status: RecordingStatus;
  shouldRecord: boolean;
  shouldReplay: boolean;
  actions: RecordedAction[];
};

async function getContentSessionState(): Promise<ContentSessionState> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'GET_CONTENT_SESSION_STATE',
    } satisfies ExtMessage)) as ContentSessionState | undefined;

    return (
      response ?? {
        status: 'idle',
        shouldRecord: false,
        shouldReplay: false,
        actions: [],
      }
    );
  } catch {
    return {
      status: 'idle',
      shouldRecord: false,
      shouldReplay: false,
      actions: [],
    };
  }
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
    case 'CONTENT_STOP_REPLAY':
      stopReplay();
      break;
    case 'CONTENT_REPLAY':
      void runReplay(message.actions);
      break;
  }
});

// On (re)load, resume whatever the extension was doing on this tab.
async function init(): Promise<void> {
  const session = await getContentSessionState();
  if (session.shouldRecord) {
    startRecording();
  } else if (session.shouldReplay && session.actions.length) {
    void runReplay(session.actions);
  }
}

void init();
