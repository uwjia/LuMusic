// Centered placeholder for empty lists.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      {hint ? <div className="empty-state-hint">{hint}</div> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
