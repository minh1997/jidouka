import { useCallback, useEffect, useState } from 'react';
import type { ExtMessage, RecordedAction, RecordingStatus } from '../shared/types';
import { ActionList } from './ActionList';

function send(message: ExtMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function App() {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [actions, setActions] = useState<RecordedAction[]>([]);

  useEffect(() => {
    const listener = (message: ExtMessage) => {
      if (message.type === 'STATE') {
        setStatus(message.status);
        setActions(message.actions);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    send({ type: 'GET_STATE' });
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const isRecording = status === 'recording';
  const isReplaying = status === 'replaying';

  const toggleRecording = useCallback(() => {
    send({ type: isRecording ? 'STOP_RECORDING' : 'START_RECORDING' });
  }, [isRecording]);

  const replay = useCallback(() => {
    send({ type: isReplaying ? 'STOP_REPLAY' : 'START_REPLAY' });
  }, [isReplaying]);

  const clear = useCallback(() => send({ type: 'CLEAR_RECORDING' }), []);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(actions, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jidouka-recording-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [actions]);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="logo">⏺</span>
          <div>
            <h1>Jidouka</h1>
            <p className="tagline">Record &amp; replay browser actions</p>
          </div>
        </div>
        <span className={`badge badge--${status}`}>{statusLabel(status)}</span>
      </header>

      <div className="controls">
        <button
          className={`btn ${isRecording ? 'btn--stop' : 'btn--record'}`}
          onClick={toggleRecording}
          disabled={isReplaying}
        >
          {isRecording ? '■ Stop recording' : '⏺ Record'}
        </button>
        <button
          className={`btn ${isReplaying ? 'btn--stop' : 'btn--play'}`}
          onClick={replay}
          disabled={isRecording || actions.length === 0}
        >
          {isReplaying ? '■ Stop' : '▶ Replay'}
        </button>
      </div>

      <div className="controls controls--secondary">
        <button className="btn btn--ghost" onClick={clear} disabled={actions.length === 0}>
          Clear
        </button>
        <button className="btn btn--ghost" onClick={exportJson} disabled={actions.length === 0}>
          Export JSON
        </button>
      </div>

      <ActionList actions={actions} />
    </div>
  );
}

function statusLabel(status: RecordingStatus): string {
  switch (status) {
    case 'recording':
      return 'Recording';
    case 'replaying':
      return 'Replaying';
    default:
      return 'Idle';
  }
}
