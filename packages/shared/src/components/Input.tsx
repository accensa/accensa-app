import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className={`accensa-input-wrapper ${className || ''}`}>
        {label && <label>{label}</label>}
        <input ref={ref} {...props} />
        {error && <span style={{ color: 'red' }}>{error}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';
