// Square icon button (player controls, row actions).

import type { ButtonHTMLAttributes, Ref } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Marks the control as active (shuffle on, current sort column, ...). */
  active?: boolean;
  label: string;
  /** React 19 passes refs as plain props; overlays use it as their anchor. */
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ active = false, label, className = '', ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${active ? 'is-active' : ''} ${className}`}
      {...rest}
    />
  );
}
