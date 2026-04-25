import axios from 'axios';
import { API_URL } from '@/utils/constants';

/**
 * Docs is public content — use a dedicated axios instance with no auth
 * interceptors so unauthenticated visitors can browse /docs without
 * getting bounced to /login.
 */
const docsClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

export interface DocNavItem {
  slug: string;
  title: string;
  link_to: string | null;
  is_new: boolean;
  icon: string | null;
}

export interface DocNavSection {
  slug: string;
  title: string;
  items: DocNavItem[];
}

export interface DocFeaturedCard {
  slug: string;
  title: string;
  excerpt: string;
  icon: string | null;
  color: string | null;
  link_to: string | null;
  is_new: boolean;
  sort_order: number;
}

export interface DocArticle {
  slug: string;
  title: string;
  excerpt: string;
  body_md: string;
  icon: string | null;
  color: string | null;
  link_to: string | null;
  is_new: boolean;
  updated_at: string;
  section_slug: string | null;
  section_title: string | null;
}

export interface DocSearchHit {
  slug: string;
  title: string;
  excerpt: string;
  icon: string | null;
  color: string | null;
  rank: number;
}

export const docsApi = {
  nav: async (): Promise<DocNavSection[]> => {
    const r = await docsClient.get('/docs/nav');
    return r.data.data ?? r.data;
  },

  featured: async (): Promise<DocFeaturedCard[]> => {
    const r = await docsClient.get('/docs/featured');
    return r.data.data ?? r.data;
  },

  article: async (slug: string): Promise<DocArticle> => {
    const r = await docsClient.get(`/docs/articles/${encodeURIComponent(slug)}`);
    return r.data.data ?? r.data;
  },

  search: async (q: string): Promise<DocSearchHit[]> => {
    const r = await docsClient.get('/docs/search', { params: { q } });
    return r.data.data ?? r.data;
  },
};
