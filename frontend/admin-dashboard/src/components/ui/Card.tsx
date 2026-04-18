import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
  glass?: boolean;
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, padding = true, glass = false, hover = false, onClick }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={twMerge(
        clsx(
          'rounded-xl border transition-all duration-300',
          glass
            ? 'bg-white/5 backdrop-blur-xl border-white/10'
            : 'bg-white border-gray-100 shadow-card',
          padding && 'p-6',
          hover && 'hover:shadow-card-hover hover:-translate-y-0.5',
          onClick && 'cursor-pointer',
          className,
        )
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, action, className }: CardHeaderProps) {
  return (
    <div className={twMerge('flex items-center justify-between mb-4', className)}>
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  className?: string;
}

export function StatCard({ title, value, change, changeType = 'neutral', icon, className }: StatCardProps) {
  const changeColors = {
    positive: 'text-success-600 bg-success-50',
    negative: 'text-danger-600 bg-danger-50',
    neutral: 'text-gray-600 bg-gray-50',
  };

  return (
    <div className={twMerge('relative bg-white rounded-xl border border-gray-100 p-6 shadow-card hover:shadow-stat transition-all duration-300 group overflow-hidden', className)}>
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-600/5 to-accent-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl" />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-500">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 tracking-tight">{value}</p>
            {change && (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-2 ${changeColors[changeType]}`}
              >
                {change}
              </span>
            )}
          </div>
          <div className="p-3 rounded-xl bg-gradient-to-br from-primary-50 to-accent-50 text-primary-600 group-hover:from-primary-100 group-hover:to-accent-100 transition-colors duration-300">
            {icon}
          </div>
        </div>
      </div>
    </div>
  );
}
