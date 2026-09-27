import type { ButtonHTMLAttributes } from 'react';

type Tone = 'default' | 'primary' | 'danger' | 'live' | 'ghost';

const tones: Record<Tone, string> = {
  default: 'bg-panel-2 hover:bg-line text-white border border-line',
  primary: 'bg-accent text-black hover:brightness-110 border border-accent',
  danger: 'bg-transparent text-red-300 hover:bg-red-950 border border-red-900',
  live: 'bg-live text-white hover:brightness-110 border border-live',
  ghost: 'bg-transparent text-muted hover:text-white hover:bg-panel-2 border border-transparent',
};

export function Button({
  tone = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  return (
    <button
      type="button"
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
