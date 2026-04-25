import api from './api';

export interface KnowledgeBase {
  id: string;
  tenant_id: string;
  name: string;
  description?: string | null;
  document_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface KBDocumentApi {
  id: string;
  filename: string;
  knowledge_base_id: string;
  // Backend currently emits `completed`; older code/tests used `processed`.
  // Accept both so the UI is resilient either way.
  status: 'pending' | 'processing' | 'processed' | 'completed' | 'failed';
  chunk_count: number;
  file_size?: number;
  created_at: string;
  updated_at: string;
}

export interface ScrapedPage {
  url: string;
  title: string;
  status: 'queued' | 'fetch_failed';
  document_id: string | null;
  bytes: number;
  error: string | null;
}

export interface ScrapeResponse {
  knowledge_base_id: string;
  root_url: string;
  pages: ScrapedPage[];
  total_pages: number;
  total_bytes: number;
}

export const knowledgeApi = {
  listKnowledgeBases: async (): Promise<KnowledgeBase[]> => {
    const res = await api.get('/knowledge/knowledge-bases');
    // Backend returns { knowledge_bases: [...], total: N }; older callers may
    // have used { data: [...] } or a bare array — handle all three.
    const d = res.data;
    return d?.knowledge_bases ?? d?.data ?? (Array.isArray(d) ? d : []);
  },

  createKnowledgeBase: async (data: { name: string; description?: string }): Promise<KnowledgeBase> => {
    const res = await api.post('/knowledge/knowledge-bases', data);
    return res.data.data ?? res.data;
  },

  deleteKnowledgeBase: async (id: string): Promise<void> => {
    await api.delete(`/knowledge/knowledge-bases/${id}`);
  },

  listDocuments: async (knowledgeBaseId: string): Promise<KBDocumentApi[]> => {
    const res = await api.get(`/knowledge/documents?knowledge_base_id=${encodeURIComponent(knowledgeBaseId)}`);
    return res.data?.documents ?? res.data?.data ?? [];
  },

  uploadDocument: async (knowledgeBaseId: string, file: File): Promise<KBDocumentApi> => {
    const form = new FormData();
    form.append('file', file);
    form.append('knowledge_base_id', knowledgeBaseId);
    const res = await api.post('/knowledge/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data.data ?? res.data;
  },

  deleteDocument: async (id: string): Promise<void> => {
    await api.delete(`/knowledge/documents/${id}`);
  },

  /** Returns a blob + content-type for inline preview in the browser. */
  fetchDocumentRaw: async (id: string): Promise<{ blob: Blob; contentType: string; filename: string }> => {
    const res = await api.get(`/knowledge/documents/${id}/raw`, { responseType: 'blob' });
    const contentType = (res.headers as any)?.['content-type'] || 'application/octet-stream';
    const cd = (res.headers as any)?.['content-disposition'] || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    return { blob: res.data, contentType, filename: m?.[1] || `document-${id}` };
  },

  /**
   * Crawl a website and ingest each page's text into a knowledge base.
   */
  scrapeWebsite: async (params: {
    knowledge_base_id: string;
    url: string;
    max_pages?: number;
    same_domain_only?: boolean;
  }): Promise<ScrapeResponse> => {
    const res = await api.post('/knowledge/scrape', {
      knowledge_base_id: params.knowledge_base_id,
      url: params.url,
      max_pages: params.max_pages ?? 10,
      same_domain_only: params.same_domain_only ?? true,
    });
    return res.data;
  },
};
