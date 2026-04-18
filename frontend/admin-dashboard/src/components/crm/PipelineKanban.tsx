import { useState } from 'react';
import { formatCurrency, formatDateShort } from '@/utils/formatters';
import type { Deal } from '@/types';
import { PIPELINE_STAGES } from '@/utils/constants';
import { GripVertical, User, Calendar, Plus } from 'lucide-react';

interface PipelineKanbanProps {
  deals: Deal[];
  onMoveDeal?: (dealId: string, newStage: string) => void;
}

export function PipelineKanban({ deals, onMoveDeal }: PipelineKanbanProps) {
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDragStart = (dealId: string) => {
    setDraggedDeal(dealId);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(stageId);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = (stageId: string) => {
    if (draggedDeal && onMoveDeal) {
      onMoveDeal(draggedDeal, stageId);
    }
    setDraggedDeal(null);
    setDragOverStage(null);
  };

  const stageColors: Record<string, { bg: string; border: string; dot: string }> = {
    discovery: { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500' },
    qualification: { bg: 'bg-purple-50', border: 'border-purple-200', dot: 'bg-purple-500' },
    proposal: { bg: 'bg-warning-50', border: 'border-warning-200', dot: 'bg-warning-500' },
    negotiation: { bg: 'bg-orange-50', border: 'border-orange-200', dot: 'bg-orange-500' },
    closed_won: { bg: 'bg-success-50', border: 'border-success-200', dot: 'bg-success-500' },
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin">
      {PIPELINE_STAGES.map((stage) => {
        const stageDeals = deals.filter((d) => d.stage === stage.id);
        const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);
        const colors = stageColors[stage.id] || { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-400' };
        const isDragOver = dragOverStage === stage.id;

        return (
          <div
            key={stage.id}
            className="flex-shrink-0 w-72"
            onDragOver={(e) => handleDragOver(e, stage.id)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(stage.id)}
          >
            {/* Stage header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                <h3 className="text-sm font-semibold text-gray-700">{stage.name}</h3>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
                  {stageDeals.length}
                </span>
              </div>
              <button className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-xs text-gray-400 mb-3 font-medium">{formatCurrency(totalValue)}</p>

            {/* Deal cards */}
            <div className={`space-y-2 min-h-[200px] rounded-xl p-2 transition-all duration-200 ${
              isDragOver ? 'bg-primary-50/50 ring-2 ring-primary-200' : 'bg-gray-50/50'
            }`}>
              {stageDeals.map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={() => handleDragStart(deal.id)}
                  className={`bg-white p-3.5 rounded-xl border border-gray-100 shadow-card hover:shadow-card-hover transition-all cursor-grab active:cursor-grabbing group ${
                    draggedDeal === deal.id ? 'opacity-50 scale-95' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-900 flex-1 leading-snug">{deal.title}</h4>
                    <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="flex items-center gap-2 mb-2.5">
                    <User className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-gray-500">{deal.leadName}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-gray-500">{formatDateShort(deal.expectedCloseDate)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2.5 border-t border-gray-50">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(deal.value)}
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      deal.probability >= 80 ? 'bg-success-50 text-success-600' :
                      deal.probability >= 50 ? 'bg-warning-50 text-warning-600' :
                      'bg-gray-50 text-gray-500'
                    }`}>
                      {deal.probability}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
