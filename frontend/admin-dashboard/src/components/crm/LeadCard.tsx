import { StatusBadge } from '@/components/ui/Badge';
import type { Lead } from '@/types';

interface LeadCardProps {
  lead: Lead;
  onClick?: () => void;
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
  const scoreColor =
    lead.score >= 80 ? 'text-success-600' : lead.score >= 50 ? 'text-warning-600' : 'text-gray-400';

  return (
    <div
      onClick={onClick}
      className="p-4 bg-white rounded-xl border border-gray-100 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-300 cursor-pointer shadow-card"
    >
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-semibold text-gray-900">{lead.name}</h4>
        <StatusBadge status={lead.status} />
      </div>
      <p className="text-xs text-gray-500 mb-3">{lead.company}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <div className={`text-sm font-bold ${scoreColor}`}>{lead.score}</div>
          <span className="text-xs text-gray-400">score</span>
        </div>
        {lead.value > 0 && (
          <span className="text-xs font-medium text-gray-600">
            ${lead.value.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
