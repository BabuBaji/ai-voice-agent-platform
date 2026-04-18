import { useState, useRef } from 'react';
import { Plus, Upload, FileText, Trash2, RotateCcw, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { formatFileSize, formatDate } from '@/utils/formatters';
import type { KnowledgeBase, KBDocument } from '@/types';

const mockKBs: KnowledgeBase[] = [
  {
    id: 'kb-1', name: 'Product Documentation', description: 'Complete product docs including features, pricing, and FAQs',
    documentCount: 24, status: 'ready',
    documents: [
      { id: 'd1', name: 'Product Overview.pdf', size: 2456000, type: 'pdf', status: 'processed', uploadedAt: '2026-04-10T00:00:00Z' },
      { id: 'd2', name: 'Pricing Guide.docx', size: 184000, type: 'docx', status: 'processed', uploadedAt: '2026-04-10T00:00:00Z' },
      { id: 'd3', name: 'API Reference.md', size: 890000, type: 'md', status: 'processed', uploadedAt: '2026-04-11T00:00:00Z' },
      { id: 'd4', name: 'Integration Guide.pdf', size: 1200000, type: 'pdf', status: 'processing', uploadedAt: '2026-04-18T00:00:00Z' },
    ],
    createdAt: '2026-03-15T00:00:00Z',
  },
  {
    id: 'kb-2', name: 'FAQ Database', description: 'Frequently asked questions and answers',
    documentCount: 156, status: 'ready',
    documents: [
      { id: 'd5', name: 'General FAQ.csv', size: 456000, type: 'csv', status: 'processed', uploadedAt: '2026-04-05T00:00:00Z' },
      { id: 'd6', name: 'Technical FAQ.json', size: 320000, type: 'json', status: 'processed', uploadedAt: '2026-04-05T00:00:00Z' },
    ],
    createdAt: '2026-02-20T00:00:00Z',
  },
  {
    id: 'kb-3', name: 'Company Policies', description: 'Internal policies, returns, shipping, and terms',
    documentCount: 12, status: 'ready',
    documents: [
      { id: 'd7', name: 'Return Policy.pdf', size: 95000, type: 'pdf', status: 'processed', uploadedAt: '2026-03-01T00:00:00Z' },
      { id: 'd8', name: 'Terms of Service.pdf', size: 210000, type: 'pdf', status: 'processed', uploadedAt: '2026-03-01T00:00:00Z' },
    ],
    createdAt: '2026-01-10T00:00:00Z',
  },
  {
    id: 'kb-4', name: 'Pricing Information', description: 'Current pricing tiers, discounts, and promotions',
    documentCount: 8, status: 'processing',
    documents: [
      { id: 'd9', name: 'Pricing Matrix.xlsx', size: 145000, type: 'xlsx', status: 'processing', uploadedAt: '2026-04-18T00:00:00Z' },
    ],
    createdAt: '2026-04-15T00:00:00Z',
  },
];

export function KnowledgeBasePage() {
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Handle files
    const files = Array.from(e.dataTransfer.files);
    console.log('Dropped files:', files.map((f) => f.name));
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="text-sm text-gray-500 mt-1">Manage documents and data sources for your agents</p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="h-4 w-4" />
          New Knowledge Base
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* KB List */}
        <div className="space-y-3">
          {mockKBs.map((kb) => (
            <div
              key={kb.id}
              onClick={() => setSelectedKB(kb)}
              className={`p-4 rounded-xl border cursor-pointer transition-all ${
                selectedKB?.id === kb.id
                  ? 'border-primary-300 bg-primary-50 shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <FolderOpen className={`h-5 w-5 ${selectedKB?.id === kb.id ? 'text-primary-600' : 'text-gray-400'}`} />
                  <h3 className="font-semibold text-gray-900 text-sm">{kb.name}</h3>
                </div>
                <StatusBadge status={kb.status} />
              </div>
              <p className="text-xs text-gray-500 mb-2 ml-7">{kb.description}</p>
              <p className="text-xs text-gray-400 ml-7">{kb.documentCount} documents</p>
            </div>
          ))}
        </div>

        {/* KB Detail / Upload */}
        <div className="lg:col-span-2 space-y-4">
          {selectedKB ? (
            <>
              {/* Upload area */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                  isDragging ? 'border-primary-400 bg-primary-50' : 'border-gray-300 bg-gray-50'
                }`}
              >
                <Upload className="h-8 w-8 text-gray-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Drag and drop files here, or{' '}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-primary-600 hover:text-primary-700 font-semibold"
                  >
                    browse
                  </button>
                </p>
                <p className="text-xs text-gray-400">PDF, DOCX, TXT, CSV, JSON (max 50MB)</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.csv,.json,.md,.xlsx"
                  className="hidden"
                />
              </div>

              {/* Document list */}
              <Card>
                <CardHeader
                  title={selectedKB.name}
                  subtitle={`${selectedKB.documents.length} documents`}
                />
                <div className="space-y-2">
                  {selectedKB.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{doc.name}</p>
                          <p className="text-xs text-gray-400">
                            {formatFileSize(doc.size)} -- {formatDate(doc.uploadedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={doc.status} />
                        {doc.status === 'failed' && (
                          <button className="p-1 text-gray-400 hover:text-primary-600">
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        <button className="p-1 text-gray-400 hover:text-danger-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-400 text-sm bg-white rounded-xl border border-gray-200">
              Select a knowledge base to view its documents
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Knowledge Base"
      >
        <div className="space-y-4">
          <Input label="Name" placeholder="e.g., Product Documentation" />
          <Input label="Description" placeholder="Brief description of this knowledge base" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={() => setShowCreateModal(false)}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
