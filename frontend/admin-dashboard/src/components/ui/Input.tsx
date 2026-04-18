import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={twMerge(
            clsx(
              'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors',
              'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0',
              error
                ? 'border-danger-300 focus:border-danger-500 focus:ring-danger-200'
                : 'border-gray-300 focus:border-primary-500 focus:ring-primary-200',
              'disabled:bg-gray-50 disabled:text-gray-500',
              className
            )
          )}
          {...props}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
        {helperText && !error && <p className="text-sm text-gray-500">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <textarea
          id={inputId}
          ref={ref}
          className={twMerge(
            clsx(
              'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors',
              'placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-0',
              error
                ? 'border-danger-300 focus:border-danger-500 focus:ring-danger-200'
                : 'border-gray-300 focus:border-primary-500 focus:ring-primary-200',
              className
            )
          )}
          {...props}
        />
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <select
          id={inputId}
          ref={ref}
          className={twMerge(
            clsx(
              'block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-offset-0',
              error
                ? 'border-danger-300 focus:border-danger-500 focus:ring-danger-200'
                : 'border-gray-300 focus:border-primary-500 focus:ring-primary-200',
              className
            )
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
