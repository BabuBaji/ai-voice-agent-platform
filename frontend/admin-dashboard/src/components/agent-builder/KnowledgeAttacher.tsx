import { useEffect, useState } from 'react';
import { BookOpen, Plus, X, Loader2, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { knowledgeApi, type KnowledgeBase } from '@/services/knowledge.api';

interface KnowledgeAttacherProps {
  attachedIds: string[];
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  /** Suggested KB name when the user clicks "Create new" — usually agent.name. */
  suggestedName?: string;
}

/**
 * Real-data knowledge-base attacher. Loads the tenant's knowledge bases from
 * the knowledge-service, lets the user attach/detach by id, and supports
 * inline KB creation so an agent can have a fresh KB without leaving the page.
 */
export function KnowledgeAttacher({ attachedIds, onAttach, onDetach, suggestedName }: KnowledgeAttacherProps) {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await knowledgeApi.listKnowledgeBases();
      setKbs(list);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to load knowledge bases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const openCreate = () => {
    setNewName(suggestedName ? `${suggestedName} — Knowledge` : '');
    setNewDescription('');
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const created = await knowledgeApi.createKnowledgeBase({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
      });
      setKbs((prev) => [created, ...prev]);
      onAttach(created.id); // auto-attach so the agent picks it up immediately
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Failed to create knowledge base');
    } finally {
      setCreating(false);
    }
  };

  const attached = kbs.filter((kb) => attachedIds.includes(kb.id));
  const available = kbs.filter((kb) => !attachedIds.includes(kb.id));

  return (
    <div className="space-y-6">
      {err && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-700">Attached Knowledge Bases</h4>
          <Button type="button" variant="outline" size="sm" onClick={openCreate} className="rounded-lg">
            <Plus className="h-3.5 w-3.5" /> New KB
          </Button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading knowledge bases…
          </div>
        ) : attached.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-gray-200 rounded-xl">
            No knowledge bases attached yet. Attach an existing one below, or click <span className="font-medium text-gray-600">New KB</span> to create one.
          </p>
        ) : (
          <div className="space-y-2">
            {attached.map((kb) => (
              <div key={kb.id} className="flex items-center justify-between p-3.5 rounded-xl bg-primary-50/50 border border-primary-200">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-4 w-4 text-primary-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{kb.name}</p>
                    <p className="text-xs text-gray-500">
                      {kb.document_count != null ? `${kb.document_count} document${kb.document_count === 1 ? '' : 's'}` : 'Ready'}
                      {kb.description ? ` · ${kb.description}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDetach(kb.id)}
                  className="p-1.5 text-gray-400 hover:text-danger-600 rounded-lg hover:bg-danger-50 transition-colors flex-shrink-0"
                  title="Detach"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-800">Create Knowledge Base</h4>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Admission FAQs"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-100"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="One-line summary of what this KB covers"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCreate(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Create & attach
            </Button>
          </div>
        </div>
      )}

      {!loading && available.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-3">Available Knowledge Bases</h4>
          <div className="space-y-2">
            {available.map((kb) => (
              <div key={kb.id} className="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 hover:border-gray-200 transition-all shadow-card">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-4 w-4 text-gray-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{kb.name}</p>
                    <p className="text-xs text-gray-500">
                      {kb.document_count != null ? `${kb.document_count} document${kb.document_count === 1 ? '' : 's'}` : 'Empty'}
                      {kb.description ? ` · ${kb.description}` : ''}
                    </p>
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => onAttach(kb.id)} className="rounded-lg flex-shrink-0">
                  <Plus className="h-3.5 w-3.5" /> Attach
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
