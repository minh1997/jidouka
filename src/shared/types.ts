// Shared types used across the side panel, background worker and content script.

export type ActionType = 'click' | 'type' | 'select' | 'submit' | 'key' | 'navigate' | 'scroll';

export type RecordingStatus = 'idle' | 'recording' | 'replaying';

// A multi-strategy fingerprint of a DOM element, captured at record time.
// Replay uses these strategies in order (id → cssPath → data-attrs → fuzzy
// scoring on text/aria/placeholder) so a recording keeps working even when the
// page re-renders and the original selector goes stale.
export interface ElementFingerprint {
  selectors: {
    id: string | null;
    cssPath: string;
    dataAttributes: Record<string, string>;
  };
  tag: string;
  text: string;
  ariaLabel: string | null;
  placeholder: string | null;
  role: string | null;
  type: string | null;
  href: string | null;
  bounds: { x: number; y: number; w: number; h: number };
  parentText: string;
  siblingTexts: string[];
  inputValue: string | null;
}

export interface RecordedAction {
  id: string;
  type: ActionType;
  /** Best-effort primary CSS selector derived from the fingerprint. */
  selector: string;
  /** Human readable description shown in the side panel. */
  label: string;
  /** Typed/selected text, or the URL for navigate actions. */
  value?: string;
  /** Key for key actions. */
  key?: string;
  /** Submit the form after typing (then_submit). */
  thenSubmit?: boolean;
  /** Page URL where the action happened. */
  url: string;
  /** Page title where the action happened. */
  pageTitle?: string;
  /** Robust element fingerprint used during replay. */
  fingerprint?: ElementFingerprint | null;
  /** True for type actions — value can be overridden when replaying. */
  isParam?: boolean;
  /** Milliseconds since the previous action (used to pace replay). */
  delay: number;
  timestamp: number;
}

// Messages exchanged between the parts of the extension.
export type ExtMessage =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'CLEAR_RECORDING' }
  | { type: 'START_REPLAY' }
  | { type: 'STOP_REPLAY' }
  | { type: 'GET_STATE' }
  | { type: 'ACTION_RECORDED'; action: RecordedAction }
  | { type: 'REPLAY_FINISHED' }
  | { type: 'STATE'; status: RecordingStatus; actions: RecordedAction[] }
  // Background -> content script commands.
  | { type: 'CONTENT_START_RECORDING' }
  | { type: 'CONTENT_STOP_RECORDING' }
  | { type: 'CONTENT_REPLAY'; actions: RecordedAction[] };

export const STORAGE_KEYS = {
  actions: 'jidouka_actions',
  status: 'jidouka_status',
  replayCursor: 'jidouka_replay_cursor',
} as const;
