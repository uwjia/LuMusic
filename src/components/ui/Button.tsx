// Small styled button used across the app.

import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
}

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonProps) {
  return <button type="button" className={`btn btn-${variant} ${className}`} {...rest} />;
}
