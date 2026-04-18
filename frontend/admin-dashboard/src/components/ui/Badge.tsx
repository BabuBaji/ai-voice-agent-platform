import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-gray-100 text-gray-700',
        primary: 'bg-primary-100 text-primary-700',
        success: 'bg-success-100 text-success-700',
        warning: 'bg-warning-100 text-warning-700',
        danger: 'bg-danger-100 text-danger-700',
        info: 'bg-blue-100 text-blue-700',
        purple: 'bg-purple-100 text-purple-700',
        gradient: 'bg-gradient-to-r from-primary-100 to-accent-100 text-primary-700',
        outline: 'border border-gray-300 text-gray-600 bg-transparent',
        'outline-primary': 'border border-primary-300 text-primary-600 bg-primary-50',
        'dark': 'bg-white/10 text-white/90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ children, variant, className, dot }: BadgeProps) {
  return (
    <span className={twMerge(clsx(badgeVariants({ variant }), className))}>
      {dot && (
        <span
          className={clsx('w-1.5 h-1.5 rounded-full mr-1.5', {
            'bg-gray-500': variant === 'default' || !variant,
            'bg-primary-500': variant === 'primary',
            'bg-success-500': variant === 'success',
            'bg-warning-500': variant === 'warning',
            'bg-danger-500': variant === 'danger',
            'bg-blue-500': variant === 'info',
            'bg-purple-500': variant === 'purple',
          })}
        />
      )}
      {children}
    </span>
  );
}

const statusToBadgeVariant: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple'> = {
  active: 'success',
  published: 'success',
  inactive: 'default',
  draft: 'warning',
  archived: 'default',
  new: 'primary',
  contacted: 'info',
  qualified: 'purple',
  proposal: 'warning',
  won: 'success',
  lost: 'danger',
  completed: 'success',
  transferred: 'info',
  voicemail: 'warning',
  dropped: 'danger',
  'no-answer': 'default',
  positive: 'success',
  neutral: 'default',
  negative: 'danger',
  ready: 'success',
  processing: 'warning',
  error: 'danger',
  processed: 'success',
  failed: 'danger',
  invited: 'warning',
  disabled: 'default',
  connected: 'success',
  disconnected: 'default',
};

export function StatusBadge({ status }: { status: string }) {
  const variant = statusToBadgeVariant[status] || 'default';
  return (
    <Badge variant={variant} dot>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ').replace('_', ' ')}
    </Badge>
  );
}
