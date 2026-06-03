import type { Workflow } from '../shared/types';
import { ActionList } from './ActionList';

export function WorkflowList({
  workflows,
  expandedWorkflowId,
  isBusy,
  onDeleteWorkflow,
  onReplayWorkflow,
  onToggleExpand,
}: {
  workflows: Workflow[];
  expandedWorkflowId: string | null;
  isBusy: boolean;
  onDeleteWorkflow: (workflowId: string) => void;
  onReplayWorkflow: (workflowId: string) => void;
  onToggleExpand: (workflowId: string) => void;
}) {
  if (workflows.length === 0) {
    return (
      <div className="empty">
        <p>No workflows saved yet.</p>
        <p className="empty__hint">
          Start recording, browse the page, and stop recording to save the captured steps as one
          workflow.
        </p>
      </div>
    );
  }

  return (
    <div className="workflow-list">
      {workflows.map((workflow) => {
        const expanded = workflow.id === expandedWorkflowId;
        return (
          <section
            className={`workflow-card ${expanded ? 'workflow-card--expanded' : ''}`}
            key={workflow.id}
          >
            <div className="workflow-card__top">
              <button
                className="workflow-card__summary"
                onClick={() => onToggleExpand(workflow.id)}
                type="button"
              >
                <span className="workflow-card__name">{workflow.name}</span>
                <span className="workflow-card__meta">
                  {workflow.steps.length} steps {expanded ? 'Hide steps' : 'Show steps'}
                </span>
              </button>

              <div className="workflow-card__buttons">
                <button
                  className="workflow-card__button"
                  disabled={isBusy}
                  onClick={() => onReplayWorkflow(workflow.id)}
                  title={`Replay ${workflow.name}`}
                  type="button"
                >
                  Replay
                </button>
                <button
                  className="workflow-card__button workflow-card__button--danger"
                  disabled={isBusy}
                  onClick={() => onDeleteWorkflow(workflow.id)}
                  title={`Delete ${workflow.name}`}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>

            {expanded && (
              <div className="workflow-card__steps">
                <ActionList actions={workflow.steps} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
