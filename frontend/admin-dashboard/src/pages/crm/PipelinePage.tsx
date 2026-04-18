import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PipelineKanban } from '@/components/crm/PipelineKanban';
import { formatCurrency } from '@/utils/formatters';
import type { Deal } from '@/types';

const mockDeals: Deal[] = [
  { id: '1', title: 'Health Clinics Enterprise', value: 45000, stage: 'qualification', leadId: '1', leadName: 'Sarah Johnson', probability: 60, expectedCloseDate: '2026-05-15', createdAt: '2026-04-18T10:30:00Z' },
  { id: '2', title: 'TechStart Pro Plan', value: 12000, stage: 'discovery', leadId: '2', leadName: 'Mike Chen', probability: 30, expectedCloseDate: '2026-06-01', createdAt: '2026-04-17T14:20:00Z' },
  { id: '3', title: 'RetailCo Custom Solution', value: 32000, stage: 'proposal', leadId: '3', leadName: 'Emily Davis', probability: 75, expectedCloseDate: '2026-05-01', createdAt: '2026-04-16T09:00:00Z' },
  { id: '4', title: 'BigCorp Annual Contract', value: 78000, stage: 'closed_won', leadId: '5', leadName: 'Jordan Smith', probability: 100, expectedCloseDate: '2026-04-15', createdAt: '2026-04-10T12:00:00Z' },
  { id: '5', title: 'FinServe Integration', value: 25000, stage: 'negotiation', leadId: '6', leadName: 'Lisa Wang', probability: 85, expectedCloseDate: '2026-04-30', createdAt: '2026-04-15T10:30:00Z' },
  { id: '6', title: 'EduFirst Pilot Program', value: 8000, stage: 'discovery', leadId: '4', leadName: 'Alex Rivera', probability: 20, expectedCloseDate: '2026-06-15', createdAt: '2026-04-18T08:50:00Z' },
  { id: '7', title: 'MedTech Voice System', value: 55000, stage: 'proposal', leadId: '7', leadName: 'David Kim', probability: 65, expectedCloseDate: '2026-05-20', createdAt: '2026-04-12T08:00:00Z' },
  { id: '8', title: 'GreenDesign Starter', value: 5000, stage: 'qualification', leadId: '8', leadName: 'Rachel Green', probability: 40, expectedCloseDate: '2026-05-30', createdAt: '2026-04-17T13:40:00Z' },
];

export function PipelinePage() {
  const [deals, setDeals] = useState(mockDeals);

  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);
  const weightedValue = deals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0);

  const handleMoveDeal = (dealId: string, newStage: string) => {
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d))
    );
  };

  return (
    <div className="max-w-full mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">
            {deals.length} deals -- Total: {formatCurrency(totalValue)} -- Weighted: {formatCurrency(weightedValue)}
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4" />
          Add Deal
        </Button>
      </div>

      <PipelineKanban deals={deals} onMoveDeal={handleMoveDeal} />
    </div>
  );
}
