import type { ActionType, RecordedAction } from '../shared/types';

const ICONS: Record<ActionType, string> = {
  click: '👆',
  type: '⌨️',
  select: '🔽',
  submit: '📤',
  key: '🔑',
  navigate: '🧭',
  scroll: '🖱️',
};

export function ActionList({
  actions,
}: {
  actions: RecordedAction[];
}) {
  if (actions.length === 0) {
    return (
      <div className="empty">
        <p>No actions recorded yet.</p>
        <p className="empty__hint">
          Press <strong>Record</strong>, then interact with the page. Your clicks and inputs will
          appear here.
        </p>
      </div>
    );
  }

  return (
    <ol className="action-list">
      {actions.map((action, i) => (
        <li className="action" key={action.id}>
          <span className="action__index">{i + 1}</span>
          <span className="action__icon" title={action.type}>
            {ICONS[action.type]}
          </span>
          <div className="action__body">
            <span className="action__label">{action.label}</span>
            {action.value != null && action.value !== '' && (
              <span className="action__value">"{truncate(action.value)}"</span>
            )}
          </div>
          <span className="action__type">{action.type}</span>
        </li>
      ))}
    </ol>
  );
}

function truncate(value: string, max = 30): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
