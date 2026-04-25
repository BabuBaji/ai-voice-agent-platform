import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, Upload, FileText, Trash2, FolderOpen, Search, Globe, Loader2,
  CheckCircle2, AlertCircle, X, Download, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatFileSize, formatDate } from '@/utils/formatters';
import {
  knowledgeApi,
  type KnowledgeBase,
  type KBDocumentApi,
  type ScrapedPage,
} from '@/services/knowledge.api';

/** Coerce any error shape (string, axios error, FastAPI 422 detail array, generic object) to a
 *  human-readable single-line string so it can render safely as a React child. */
function errMsg(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  const detail = (e as any)?.response?.data?.detail ?? (e as any)?.detail ?? (e as any)?.message;
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => (d && typeof d === 'object' ? `${(d.loc || []).join('.')}: ${d.msg || d.message || JSON.stringify(d)}` : String(d)))
      .join('; ');
  }
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return (e as any)?.message || JSON.stringify(e);
}

const typeColors: Record<string, string> = {
  pdf: 'text-red-500',
  docx: 'text-blue-500',
  txt: 'text-gray-500',
  csv: 'text-green-500',
  json: 'text-yellow-500',
  md: 'text-purple-500',
  xlsx: 'text-emerald-500',
};

function ext(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return (m?.[1] || '').toLowerCase();
}

export function KnowledgeBasePage() {
  // KB list
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [selectedKB, setSelectedKB] = useState<KnowledgeBase | null>(null);
  const [loadingKbs, setLoadingKbs] = useState(true);
  const [kbError, setKbError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Documents
  const [documents, setDocuments] = useState<KBDocumentApi[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Upload
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]); // filenames currently uploading
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create KB modal
  const [showCreateKb, setShowCreateKb] = useState(false);

  // View document (preview modal)
  const [viewing, setViewing] = useState<{ doc: KBDocumentApi; url: string; type: string } | null>(null);

  // Right-side detail panel selection
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  // Website scrape
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeMaxPages, setScrapeMaxPages] = useState(10);
  const [scrapeSameDomain, setScrapeSameDomain] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<{ pages: ScrapedPage[]; total: number; bytes: number } | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  const reloadKbs = useCallback(async () => {
    setLoadingKbs(true);
    setKbError(null);
    try {
      const list = await knowledgeApi.listKnowledgeBases();
      setKbs(list);
      // Re-pin the selection if it still exists, otherwise pick the first one
      setSelectedKB((prev) => {
        if (prev) {
          const same = list.find((k) => k.id === prev.id);
          if (same) return same;
        }
        return list[0] || null;
      });
    } catch (e: any) {
      setKbError(errMsg(e) || 'Failed to load knowledge bases');
    } finally {
      setLoadingKbs(false);
    }
  }, []);

  const reloadDocs = useCallback(async (kbId: string) => {
    setLoadingDocs(true);
    try {
      const list = await knowledgeApi.listDocuments(kbId);
      setDocuments(list);
    } catch {
      setDocuments([]);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => { reloadKbs(); }, [reloadKbs]);
  useEffect(() => {
    if (selectedKB?.id) reloadDocs(selectedKB.id);
    else setDocuments([]);
  }, [selectedKB?.id, reloadDocs]);

  // Auto-poll while any docs are still processing — quick refresh so the UI
  // reflects "processed" status without needing the user to reload.
  useEffect(() => {
    if (!selectedKB) return;
    const pending = documents.filter((d) => d.status === 'pending' || d.status === 'processing');
    if (pending.length === 0) return;
    const t = setInterval(() => reloadDocs(selectedKB.id), 4000);
    return () => clearInterval(t);
  }, [documents, selectedKB, reloadDocs]);

  // ── Upload handlers ──────────────────────────────────────────
  const uploadFiles = async (files: File[]) => {
    if (!selectedKB || files.length === 0) return;
    setUploadError(null);
    for (const f of files) {
      setUploading((p) => [...p, f.name]);
      try {
        await knowledgeApi.uploadDocument(selectedKB.id, f);
      } catch (e: any) {
        setUploadError(`Upload of ${f.name} failed: ${errMsg(e) || 'unknown'}`);
      } finally {
        setUploading((p) => p.filter((n) => n !== f.name));
      }
    }
    reloadDocs(selectedKB.id);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    void uploadFiles(Array.from(e.dataTransfer.files));
  };
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(Array.from(e.target.files || []));
    e.target.value = '';
  };

  // ── Document view ─────────────────────────────────────────────
  const openDocument = async (doc: KBDocumentApi) => {
    try {
      const { blob, contentType } = await knowledgeApi.fetchDocumentRaw(doc.id);
      const url = URL.createObjectURL(blob);
      setViewing({ doc, url, type: contentType });
    } catch (e: any) {
      setUploadError(`Couldn't open ${doc.filename}: ${errMsg(e) || 'unknown'}`);
    }
  };
  const closeViewing = () => {
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    setViewing(null);
  };

  const deleteDocument = async (doc: KBDocumentApi) => {
    if (!confirm(`Delete "${doc.filename}"? This removes all chunks + embeddings.`)) return;
    try {
      await knowledgeApi.deleteDocument(doc.id);
      if (selectedKB) reloadDocs(selectedKB.id);
    } catch (e: any) {
      setUploadError(`Delete failed: ${errMsg(e)}`);
    }
  };

  // ── Website scrape ────────────────────────────────────────────
  const handleScrape = async () => {
    if (!selectedKB) return;
    if (!scrapeUrl.trim()) { setScrapeError('Enter a URL to scrape'); return; }
    setScraping(true); setScrapeError(null); setScrapeResult(null);
    try {
      const res = await knowledgeApi.scrapeWebsite({
        knowledge_base_id: selectedKB.id,
        url: scrapeUrl.trim(),
        max_pages: scrapeMaxPages,
        same_domain_only: scrapeSameDomain,
      });
      setScrapeResult({ pages: res.pages, total: res.total_pages, bytes: res.total_bytes });
      // Refresh document list — scraped pages show up there too
      reloadDocs(selectedKB.id);
    } catch (e: any) {
      setScrapeError(errMsg(e) || 'Scrape failed');
    } finally {
      setScraping(false);
    }
  };

  // Guard against any edge case where the API briefly returns a non-array
  // (e.g. error envelope) — never let the render crash.
  const filteredKbs = (Array.isArray(kbs) ? kbs : []).filter((kb) =>
    (kb.name || '').toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || null;

  return (
    <div className="w-full space-y-4">
      {kbError && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4" /> {kbError}
        </div>
      )}

      {/* Top bar — KB selector + new KB */}
      {kbs.length > 1 && (
        <div className="flex items-center justify-between">
          <select
            value={selectedKB?.id ?? ''}
            onChange={(e) => setSelectedKB(kbs.find((k) => k.id === e.target.value) || null)}
            className="h-10 px-3 rounded-lg border border-gray-300 text-sm bg-white"
          >
            {kbs.map((k) => (
              <option key={k.id} value={k.id}>{k.name} ({k.document_count ?? 0})</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => setShowCreateKb(true)} className="rounded-xl">
            <Plus className="h-4 w-4" /> New Knowledge Base
          </Button>
        </div>
      )}

      {!selectedKB ? (
        <Card>
          <div className="text-center py-12">
            <FolderOpen className="h-10 w-10 mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium text-gray-700">No knowledge bases yet</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Create one to start uploading documents.</p>
            <Button variant="primary" size="sm" onClick={() => setShowCreateKb(true)}>
              <Plus className="h-4 w-4" /> New Knowledge Base
            </Button>
          </div>
        </Card>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${selectedDocId ? 'lg:grid-cols-3' : 'lg:grid-cols-1'}`}>
          {/* ─── Left: Upload + Files table ─── */}
          <div className={`${selectedDocId ? 'lg:col-span-2' : ''} space-y-4 min-w-0`}>
            {/* Upload PDFs card — single outer cyan-dashed border, big centered drop zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative rounded-2xl border-2 border-dashed transition-all duration-200 ${
                isDragging ? 'border-cyan-500 bg-cyan-50' : 'border-cyan-300 bg-white hover:border-cyan-400'
              }`}
            >
              <div className="px-5 pt-4 pb-1 flex items-center gap-2">
                <Upload className="h-4 w-4 text-cyan-600" />
                <h3 className="text-sm font-semibold text-gray-900">Upload Files</h3>
              </div>
              <div className="px-5 py-7 text-center">
                <div className="w-12 h-12 rounded-xl bg-cyan-100 flex items-center justify-center mx-auto mb-3">
                  <Upload className="h-6 w-6 text-cyan-600" />
                </div>
                <p className="text-sm font-semibold text-gray-900">
                  Drag and drop a file here, or{' '}
                  <button onClick={() => fileInputRef.current?.click()} className="text-cyan-700 hover:text-cyan-800 underline underline-offset-2">
                    click to select
                  </button>
                </p>
                <p className="text-xs text-gray-500 mt-1.5">Supported formats: PDF, DOCX, TXT, CSV, JSON, MD, XLSX (max 50 MB)</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,.csv,.json,.md,.xlsx"
                  className="hidden"
                  onChange={onPickFile}
                />
                {uploading.length > 0 && (
                  <div className="mt-5 inline-flex items-center gap-2 text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 px-3 py-1.5 rounded-lg">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading: {uploading.join(', ')}
                  </div>
                )}
              </div>
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-danger-50 border border-danger-200 text-sm text-danger-700">
                <AlertCircle className="h-4 w-4" /> {uploadError}
              </div>
            )}

            {/* Uploaded Files table */}
            <Card padding={false} className="overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-cyan-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Uploaded Files</h3>
                  <span className="text-xs text-gray-500">· {documents.length}</span>
                </div>
                <Button variant="outline" size="sm" onClick={() => reloadDocs(selectedKB.id)} disabled={loadingDocs} className="rounded-lg">
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingDocs ? 'animate-spin' : ''}`} /> Refresh
                </Button>
              </div>
              {loadingDocs && documents.length === 0 ? (
                <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading documents…</div>
              ) : documents.length === 0 ? (
                <div className="text-center py-12 text-sm text-gray-400">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  No files yet. Drop one above to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs table-fixed">
                    <thead className="bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-5 py-2 font-medium">Name</th>
                        <th className="text-left px-3 py-2 font-medium w-20">Type</th>
                        <th className="text-left px-3 py-2 font-medium w-24">Size</th>
                        <th className="text-left px-3 py-2 font-medium w-44">Date</th>
                        <th className="text-right px-5 py-2 font-medium w-32">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => {
                        const e = ext(doc.filename);
                        const colorClass = typeColors[e] || 'text-gray-400';
                        const clickable = doc.status === 'processed' || doc.status === 'completed';
                        const isSelected = selectedDocId === doc.id;
                        return (
                          <tr
                            key={doc.id}
                            onClick={() => setSelectedDocId(doc.id)}
                            className={`border-t border-gray-100 transition-colors cursor-pointer ${
                              isSelected ? 'bg-cyan-50/40' : 'hover:bg-gray-50/60'
                            }`}
                          >
                            <td className="px-5 py-2">
                              <div className="flex items-center gap-2 min-w-0" title={doc.filename}>
                                <FileText className={`h-3.5 w-3.5 flex-shrink-0 ${colorClass}`} />
                                <span className="font-medium text-gray-900 truncate">{doc.filename}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                                e === 'pdf' ? 'bg-red-50 text-red-700'
                                : e === 'docx' ? 'bg-blue-50 text-blue-700'
                                : e === 'csv' ? 'bg-green-50 text-green-700'
                                : 'bg-gray-100 text-gray-700'
                              }`}>{e || 'file'}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                              {doc.file_size && doc.file_size > 0 ? formatFileSize(doc.file_size) : `${doc.chunk_count} chunks`}
                            </td>
                            <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{formatDate(doc.created_at)}</td>
                            <td className="px-5 py-2">
                              <div className="flex items-center justify-end gap-1.5">
                                <StatusBadge status={doc.status} />
                                {clickable && (
                                  <button
                                    onClick={(ev) => { ev.stopPropagation(); openDocument(doc); }}
                                    className="p-1.5 rounded-md text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                                    title="View"
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                )}
                                <button
                                  onClick={(ev) => { ev.stopPropagation(); deleteDocument(doc); }}
                                  className="p-1.5 rounded-md text-gray-400 hover:text-danger-600 hover:bg-danger-50"
                                  title="Delete"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Optional: website scrape — collapsed below main view */}
            <details className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <summary className="px-5 py-3 cursor-pointer flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Globe className="h-4 w-4 text-primary-500" />
                Import from website (advanced)
              </summary>
              <div className="px-5 py-4 border-t border-gray-100 space-y-3">
                <p className="text-xs text-gray-500">
                  Paste a URL — we'll crawl the site (BFS, same-domain by default), extract clean text, and ingest the pages.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input type="url" value={scrapeUrl} onChange={(e) => setScrapeUrl(e.target.value)}
                    placeholder="https://your-company.com"
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-100" />
                  <input type="number" value={scrapeMaxPages} min={1} max={50}
                    onChange={(e) => setScrapeMaxPages(parseInt(e.target.value) || 10)}
                    className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-2" title="Max pages" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={scrapeSameDomain} onChange={(e) => setScrapeSameDomain(e.target.checked)} className="accent-primary-600" />
                    Same-domain only
                  </label>
                  <Button onClick={handleScrape} disabled={scraping} className="rounded-lg">
                    {scraping ? <><Loader2 className="h-4 w-4 animate-spin" /> Scraping…</> : <><Globe className="h-4 w-4" /> Scrape</>}
                  </Button>
                </div>
                {scrapeError && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span className="font-mono break-all">{scrapeError}</span>
                  </div>
                )}
                {scrapeResult && (
                  <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 rounded-lg p-3">
                    <CheckCircle2 className="h-4 w-4" />
                    Ingested <strong>{scrapeResult.total}</strong> pages ({formatFileSize(scrapeResult.bytes)}).
                  </div>
                )}
              </div>
            </details>
          </div>

          {/* ─── Right: File detail panel — only shown when a file is selected ─── */}
          {selectedDoc && (
          <div className="lg:col-span-1">
            <div className="rounded-2xl bg-white border border-gray-200 p-6 sticky top-20">
              <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 ${typeColors[ext(selectedDoc.filename)] || 'text-gray-400'}`}>
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-gray-900 truncate">{selectedDoc.filename}</h4>
                        <p className="text-[11px] text-gray-500 mt-0.5 uppercase tracking-wide">{ext(selectedDoc.filename) || 'file'}</p>
                      </div>
                    </div>
                    <button onClick={() => setSelectedDocId(null)} className="p-1 rounded text-gray-400 hover:text-gray-700">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <dl className="space-y-3 text-sm border-t border-gray-100 pt-4">
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Size</dt>
                      <dd className="text-gray-900 font-medium">{selectedDoc.file_size && selectedDoc.file_size > 0 ? formatFileSize(selectedDoc.file_size) : `${selectedDoc.chunk_count} chunks`}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Status</dt>
                      <dd><StatusBadge status={selectedDoc.status} /></dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Chunks</dt>
                      <dd className="text-gray-900 font-medium">{selectedDoc.chunk_count ?? 0}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500">Uploaded</dt>
                      <dd className="text-gray-900 font-medium text-xs">{formatDate(selectedDoc.created_at)}</dd>
                    </div>
                  </dl>

                  <div className="flex flex-col gap-2 mt-5 pt-4 border-t border-gray-100">
                    {(selectedDoc.status === 'processed' || selectedDoc.status === 'completed') && (
                      <Button variant="outline" size="sm" onClick={() => openDocument(selectedDoc)} className="rounded-lg w-full">
                        <Download className="h-3.5 w-3.5" /> View / Download
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteDocument(selectedDoc)}
                      className="rounded-lg w-full !text-danger-600 !border-danger-200 hover:!bg-danger-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete file
                    </Button>
                  </div>
                </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* ─── Create KB modal ─── */}
      {showCreateKb && (
        <CreateKbModal
          onClose={() => setShowCreateKb(false)}
          onCreated={(kb) => {
            setShowCreateKb(false);
            setSelectedKB(kb);
            reloadKbs();
          }}
        />
      )}

      {/* ─── Document viewer modal ─── */}
      {viewing && (
        <DocumentViewerModal viewing={viewing} onClose={closeViewing} />
      )}
    </div>
  );
}

/* ---------- Create Knowledge Base modal ---------- */

function CreateKbModal({ onClose, onCreated }: { onClose: () => void; onCreated: (kb: KnowledgeBase) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const kb = await knowledgeApi.createKnowledgeBase({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreated(kb);
    } catch (e: any) {
      setErr(errMsg(e) || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New Knowledge Base">
      <div className="space-y-4">
        {err && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-danger-50 border border-danger-200 text-xs text-danger-700">
            <AlertCircle className="h-3.5 w-3.5" /> {err}
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Product Documentation"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            placeholder="What's in this KB? (optional)"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none" />
        </div>
      </div>
      <div className="mt-6 flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create
        </Button>
      </div>
    </Modal>
  );
}

/* ---------- Document viewer ---------- */

function DocumentViewerModal({ viewing, onClose }: { viewing: { doc: KBDocumentApi; url: string; type: string }; onClose: () => void }) {
  const { doc, url, type } = viewing;
  const isPdf = type.includes('pdf');
  const isImage = type.startsWith('image/');
  const isText = type.startsWith('text/') || type.includes('json') || type.includes('csv') || type.includes('markdown');

  const [textContent, setTextContent] = useState<string | null>(null);
  useEffect(() => {
    if (!isText) return;
    fetch(url).then((r) => r.text()).then(setTextContent).catch(() => setTextContent(null));
  }, [isText, url]);

  return (
    <Modal isOpen onClose={onClose} title="" size="xl">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="h-5 w-5 text-primary-500 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{doc.filename}</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{doc.chunk_count} chunks · {type}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={url} download={doc.filename} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
            <Download className="h-3.5 w-3.5" /> Download
          </a>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden" style={{ height: '70vh' }}>
        {isPdf ? (
          <iframe src={url} title={doc.filename} className="w-full h-full" />
        ) : isImage ? (
          <div className="w-full h-full flex items-center justify-center p-4">
            <img src={url} alt={doc.filename} className="max-w-full max-h-full object-contain" />
          </div>
        ) : isText ? (
          <pre className="p-4 text-xs font-mono text-gray-800 overflow-auto h-full whitespace-pre-wrap">
            {textContent ?? 'Loading…'}
          </pre>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-gray-500 p-8">
            Inline preview isn't available for <strong>&nbsp;{type}&nbsp;</strong> files.
            <a href={url} download={doc.filename} className="ml-2 text-primary-600 underline">Download</a> to open it locally.
          </div>
        )}
      </div>
    </Modal>
  );
}
