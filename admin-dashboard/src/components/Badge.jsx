import clsx from 'clsx';

const VARIANTS = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-surface-overlay text-textsecondary',
  accent: 'bg-accent-muted text-accent',
};

export default function Badge({ children, variant = 'neutral' }) {
  return <span className={clsx('badge', VARIANTS[variant])}>{children}</span>;
}
