import { cva, type VariantProps } from 'class-variance-authority';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
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
            'bg-gray-500': variant === 'default',
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
  inactive: 'default',
  draft: 'warning',
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
};

export function StatusBadge({ status }: { status: string }) {
  const variant = statusToBadgeVariant[status] || 'default';
  return (
    <Badge variant={variant} dot>
      {status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
    </Badge>
  );
}
