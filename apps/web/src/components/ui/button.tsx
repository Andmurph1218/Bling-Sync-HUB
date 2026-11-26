'use client';

import React, { forwardRef } from 'react';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'default' | 'icon';
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'default', className = '', type = 'button', ...props },
  ref
) {
  return <button ref={ref} type={type} data-variant={variant} data-size={size} className={`ui-button ${className}`} {...props} />;
});
