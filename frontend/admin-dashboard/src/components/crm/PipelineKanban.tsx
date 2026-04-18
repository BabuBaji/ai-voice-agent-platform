import { useState } from 'react';
import { formatCurrency } from '@/utils/formatters';
import type { Deal } from '@/types';
import { PIPELINE_STAGES } from '@/utils/constants';
import { GripVertical, User } from 'lucide-react';

interface PipelineKanbanProps {
  deals: Deal[];
  onMoveDeal?: (dealId: string, newStage: string) => void;
}

export function PipelineKanban({ deals, onMoveDeal }: PipelineKanbanProps) {
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);

  const handleDragStart = (dealId: string) => {
    setDraggedDeal(dealId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (stageId: string) => {
    if (draggedDeal && onMoveDeal) {
      onMoveDeal(draggedDeal, stageId);
    }
    setDraggedDeal(null);
  };

  const stageColors: Record<string, string> = {
    discovery: 'bg-blue-500',
    qualification: 'bg-purple-500',
    proposal: 'bg-warning-500',
    negotiation: 'bg-orange-500',
    closed_won: 'bg-success-500',
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {PIPELINE_STAGES.map((stage) => {
        const stageDeals = deals.filter((d) => d.stage === stage.id);
        const totalValue = stageDeals.reduce((sum, d) => sum + d.value, 0);

        return (
          <div
            key={stage.id}
            className="flex-shrink-0 w-72"
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(stage.id)}
          >
            {/* Stage header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${stageColors[stage.id] || 'bg-gray-400'}`} />
                <h3 className="text-sm font-semibold text-gray-700">{stage.name}</h3>
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  {stageDeals.length}
                </span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-3">{formatCurrency(totalValue)}</p>

            {/* Deal cards */}
            <div className="space-y-2 min-h-[200px] bg-gray-50/50 rounded-lg p-2">
              {stageDeals.map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={() => handleDragStart(deal.id)}
                  className={`bg-white p-3 rounded-lg border border-gray-200 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                    draggedDeal === deal.id ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="text-sm font-medium text-gray-900 flex-1">{deal.title}</h4>
                    <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <User className="h-3 w-3 text-gray-400" />
                    <span className="text-xs text-gray-500">{deal.leadName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(deal.value)}
                    </span>
                    <span className="text-xs text-gray-400">{deal.probability}%</span>
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
