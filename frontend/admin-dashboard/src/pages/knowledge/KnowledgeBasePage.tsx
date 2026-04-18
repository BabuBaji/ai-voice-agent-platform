import { useState, useRef } from 'react';
import { Plus, Upload, FileText, Trash2, RotateCcw, FolderOpen, Search, File } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { formatFileSize, formatDate } from '@/utils/formatters';
import type { KnowledgeBase, KBDocument } from '@/types';

const typeIcons: Record<string, string> = {
  pdf: 'text-red-500',
  docx: 'text-blue-500',
  txt: 'text-gray-500',
  csv: 'text-green-500',
  json: 'text-yellow-500',
  md: 'text-purple-500',
  xlsx: 'text-emerald-500',
};

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
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
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
        <Button variant="gradient" onClick={() => setShowCreateModal(true)} className="rounded-xl">
          <Plus className="h-4 w-4" />
          New Knowledge Base
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* KB List */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search knowledge bases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 focus:outline-none transition-all"
            />
          </div>

          {mockKBs
            .filter((kb) => kb.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .map((kb) => (
            <div
              key={kb.id}
              onClick={() => setSelectedKB(kb)}
              className={`p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                selectedKB?.id === kb.id
                  ? 'border-primary-300 bg-primary-50/50 shadow-sm'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-card shadow-card'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    selectedKB?.id === kb.id ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-400'
                  }`}>
                    <FolderOpen className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{kb.name}</h3>
                    <p className="text-xs text-gray-400">{kb.documentCount} documents</p>
                  </div>
                </div>
                <StatusBadge status={kb.status} />
              </div>
              <p className="text-xs text-gray-500 ml-[46px]">{kb.description}</p>
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
                className={`border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200 ${
                  isDragging
                    ? 'border-primary-400 bg-primary-50/50 scale-[1.01]'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-50 to-accent-50 flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-7 w-7 text-primary-500" />
                </div>
                <p className="text-sm font-medium text-gray-700 mb-1">
                  Drag and drop files here, or{' '}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-primary-600 hover:text-primary-700 font-semibold"
                  >
                    browse
                  </button>
                </p>
                <p className="text-xs text-gray-400">PDF, DOCX, TXT, CSV, JSON, MD, XLSX (max 50MB)</p>
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
                      className="flex items-center justify-between p-3.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center ${typeIcons[doc.type] || 'text-gray-400'}`}>
                          <FileText className="h-5 w-5" />
                        </div>
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
                          <button className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors">
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        <button className="p-1.5 text-gray-400 hover:text-danger-600 rounded-lg hover:bg-danger-50 transition-colors opacity-0 group-hover:opacity-100">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 text-gray-400 bg-white rounded-2xl border border-gray-100 shadow-card">
              <FolderOpen className="h-12 w-12 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-500">Select a knowledge base</p>
              <p className="text-xs text-gray-400 mt-1">Choose from the left panel to view documents</p>
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
            <Button variant="outline" onClick={() => setShowCreateModal(false)} className="rounded-xl">Cancel</Button>
            <Button variant="gradient" onClick={() => setShowCreateModal(false)} className="rounded-xl">Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
