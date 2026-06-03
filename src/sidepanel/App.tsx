import { useCallback, useEffect, useState } from 'react';
import type { ExtMessage, RecordedAction, RecordingStatus, Workflow } from '../shared/types';
import { ActionList } from './ActionList';
import { WorkflowList } from './WorkflowList';

function send(message: ExtMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export function App() {
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [currentRecording, setCurrentRecording] = useState<RecordedAction[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null);

  useEffect(() => {
    const listener = (message: ExtMessage) => {
      if (message.type === 'STATE') {
        setStatus(message.status);
        setCurrentRecording(message.currentRecording);
        setWorkflows(message.workflows);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    send({ type: 'GET_STATE' });
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (expandedWorkflowId && !workflows.some((workflow) => workflow.id === expandedWorkflowId)) {
      setExpandedWorkflowId(null);
    }
  }, [expandedWorkflowId, workflows]);

  const isRecording = status === 'recording';
  const isReplaying = status === 'replaying';

  const toggleRecording = useCallback(() => {
    send({ type: isRecording ? 'STOP_RECORDING' : 'START_RECORDING' });
  }, [isRecording]);

  const stopReplay = useCallback(() => send({ type: 'STOP_REPLAY' }), []);

  const replayWorkflow = useCallback((workflowId: string) => {
    send({ type: 'REPLAY_WORKFLOW', workflowId });
  }, []);

  const deleteWorkflow = useCallback((workflowId: string) => {
    send({ type: 'DELETE_WORKFLOW', workflowId });
  }, []);

  const toggleExpand = useCallback((workflowId: string) => {
    setExpandedWorkflowId((current) => (current === workflowId ? null : workflowId));
  }, []);

  return (
    <div className="app">
      <header className="page-header">
        <div>
          <h1>Workflows</h1>
          <p className="tagline">Save each recording as a workflow with all of its steps.</p>
        </div>
        <span className={`badge badge--${status}`}>{statusLabel(status)}</span>
      </header>

      <button
        className={`record-button ${isRecording ? 'record-button--stop' : ''}`}
        onClick={toggleRecording}
        disabled={isReplaying}
        type="button"
      >
        {isRecording ? 'Stop Recording' : 'Start Recording'}
      </button>

      {isReplaying && (
        <button
          className="record-button record-button--stop"
          onClick={stopReplay}
          type="button"
        >
          Stop Replay
        </button>
      )}

      {isRecording && (
        <section className="recording-panel">
          <div className="section-header">
            <h2>Current Recording</h2>
            <span>{currentRecording.length} steps</span>
          </div>
          {currentRecording.length > 0 ? (
            <ActionList actions={currentRecording} />
          ) : (
            <p className="recording-panel__hint">Interact with the page to capture workflow steps.</p>
          )}
        </section>
      )}

      <WorkflowList
        workflows={workflows}
        expandedWorkflowId={expandedWorkflowId}
        isBusy={isRecording || isReplaying}
        onDeleteWorkflow={deleteWorkflow}
        onReplayWorkflow={replayWorkflow}
        onToggleExpand={toggleExpand}
      />
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
