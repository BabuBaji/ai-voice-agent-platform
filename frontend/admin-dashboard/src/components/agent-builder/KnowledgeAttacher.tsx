import { BookOpen, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface KnowledgeAttacherProps {
  attachedIds: string[];
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
}

const mockKnowledgeBases = [
  { id: 'kb-1', name: 'Product Documentation', documentCount: 24, status: 'ready' as const },
  { id: 'kb-2', name: 'FAQ Database', documentCount: 156, status: 'ready' as const },
  { id: 'kb-3', name: 'Company Policies', documentCount: 12, status: 'ready' as const },
  { id: 'kb-4', name: 'Pricing Information', documentCount: 8, status: 'processing' as const },
];

export function KnowledgeAttacher({ attachedIds, onAttach, onDetach }: KnowledgeAttacherProps) {
  const attached = mockKnowledgeBases.filter((kb) => attachedIds.includes(kb.id));
  const available = mockKnowledgeBases.filter((kb) => !attachedIds.includes(kb.id));

  return (
    <div className="space-y-6">
      {/* Attached */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 mb-3">Attached Knowledge Bases</h4>
        {attached.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center border border-dashed border-gray-300 rounded-lg">
            No knowledge bases attached yet
          </p>
        ) : (
          <div className="space-y-2">
            {attached.map((kb) => (
              <div
                key={kb.id}
                className="flex items-center justify-between p-3 rounded-lg bg-primary-50 border border-primary-200"
              >
                <div className="flex items-center gap-3">
                  <BookOpen className="h-4 w-4 text-primary-600" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{kb.name}</p>
                    <p className="text-xs text-gray-500">{kb.documentCount} documents</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDetach(kb.id)}
                  className="p-1 text-gray-400 hover:text-danger-600 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available */}
      {available.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Available Knowledge Bases</h4>
          <div className="space-y-2">
            {available.map((kb) => (
              <div
                key={kb.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <BookOpen className="h-4 w-4 text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{kb.name}</p>
                    <p className="text-xs text-gray-500">{kb.documentCount} documents</p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onAttach(kb.id)}
                  disabled={kb.status !== 'ready'}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Attach
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
