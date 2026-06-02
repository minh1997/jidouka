// Shared types used across the side panel, background worker and content script.

export type ActionType = 'click' | 'input' | 'change' | 'submit' | 'keydown' | 'navigate';

export interface RecordedAction {
  id: string;
  type: ActionType;
  /** A CSS selector that locates the target element (empty for navigate). */
  selector: string;
  /** Human readable label for display in the UI. */
  label: string;
  /** Value for input/change actions, or the URL for navigate. */
  value?: string;
  /** Key for keydown actions. */
  key?: string;
  /** Page URL where the action happened. */
  url: string;
  /** Milliseconds since the previous action (used to pace replay). */
  delay: number;
  timestamp: number;
}

export type RecordingStatus = 'idle' | 'recording' | 'replaying';

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
