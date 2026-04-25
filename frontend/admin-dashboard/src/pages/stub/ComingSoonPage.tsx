import { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Lightweight placeholder for nav items we list in the sidebar to match the
 * target sidebar layout (WhatsApp, API, Docs, Contact, Support) but haven't
 * built end-to-end yet. Each route renders this with its own title + body so
 * the user gets a consistent "this is coming soon" surface instead of a 404.
 */
interface ComingSoonPageProps {
  title: string;
  subtitle?: string;
  description?: ReactNode;
  icon?: ReactNode;
  primaryAction?: { label: string; href: string };
}

export function ComingSoonPage({ title, subtitle, description, icon, primaryAction }: ComingSoonPageProps) {
  return (
    <div className="max-w-3xl mx-auto py-12">
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100 flex items-center justify-center flex-shrink-0">
            {icon || <Sparkles className="h-6 w-6 text-primary-600" />}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-gray-900">{title}</h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                Coming soon
              </span>
            </div>
            {subtitle && <p className="text-sm text-gray-500 mb-3">{subtitle}</p>}
            {description && <div className="text-sm text-gray-600 leading-relaxed mb-4">{description}</div>}
            {primaryAction && (
              <a href={primaryAction.href} target={primaryAction.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
                <Button variant="primary" size="sm">{primaryAction.label}</Button>
              </a>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
