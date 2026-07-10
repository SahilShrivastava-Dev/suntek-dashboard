import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Password field with a show/hide eye toggle — the same affordance the Login page
 * has, extracted so every password field (User Management, etc.) is consistent.
 *
 * Tailwind-styled to match the auth + admin forms. Pass `className` to override the
 * input styling per-context; the toggle button is positioned inside a relative wrapper.
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  className,
  autoComplete = 'new-password',
  required,
  disabled,
  id,
  name,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  'aria-label'?: string;
}) {
  const [show, setShow] = useState(false);
  const base =
    'w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-400 bg-gray-50';
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className ?? base}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
