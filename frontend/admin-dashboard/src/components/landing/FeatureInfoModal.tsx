import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X, ArrowRight, Check, Bot, MessageSquare, Phone, BookOpen, Users,
  BarChart3, Mic, Workflow, Megaphone, Sparkles,
} from 'lucide-react';

const ICONS: Record<string, any> = {
  Bot, MessageSquare, Phone, BookOpen, Users, BarChart3, Mic, Workflow, Megaphone,
};

type Cta = { label: string; href: string };
type Detail = {
  id: string;
  icon: string;
  title: string;
  tagline: string;
  description: string;
  capabilities: string[];
  metrics: { value: string; label: string }[];
  primary_cta: Cta;
  secondary_cta: Cta;
  accent: string;
};

interface Props {
  featureId: string | null;
  onClose: () => void;
}

export function FeatureInfoModal({ featureId, onClose }: Props) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!featureId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetch(`/api/v1/landing/features/${encodeURIComponent(featureId)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Detail) => {
        if (!cancelled) setDetail(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [featureId]);

  useEffect(() => {
    if (!featureId) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = '';
    };
  }, [featureId, onClose]);

  if (!featureId) return null;

  const Icon = detail ? ICONS[detail.icon] || Sparkles : Sparkles;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" />

      {/* Drawer panel */}
      <div
        className="relative w-full max-w-xl bg-white shadow-2xl shadow-slate-900/30 overflow-y-auto animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors z-10"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {loading && (
          <div className="bg-gradient-to-br from-amber-500 to-rose-500 h-48 animate-pulse" />
        )}

        {error && !loading && (
          <div className="p-12 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
              <X className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Couldn't load this feature</p>
            <p className="text-xs text-slate-500 mt-1">{error}</p>
            <button
              onClick={onClose}
              className="mt-6 px-4 py-2 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        )}

        {detail && !loading && (
          <>
            {/* Hero */}
            <div className={`relative bg-gradient-to-br ${detail.accent} text-white p-8 lg:p-10 overflow-hidden`}>
              <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center mb-5">
                  <Icon className="h-6 w-6 text-white" />
                </div>
                <h2 className="text-2xl lg:text-3xl font-bold tracking-tight">{detail.title}</h2>
                <p className="text-base text-white/90 mt-2 leading-relaxed">{detail.tagline}</p>
              </div>
            </div>

            {/* Body */}
            <div className="p-8 lg:p-10 space-y-7">
              <p className="text-base text-slate-700 leading-relaxed">{detail.description}</p>

              {/* Metrics row */}
              {detail.metrics?.length > 0 && (
                <div className="grid grid-cols-3 gap-3 py-2">
                  {detail.metrics.map((m) => (
                    <div key={m.label} className="text-center rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <div className="text-xl font-bold text-slate-900">{m.value}</div>
                      <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-0.5">{m.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Capabilities */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 mb-3">
                  What you get
                </p>
                <ul className="space-y-2.5">
                  {detail.capabilities.map((c) => (
                    <li key={c} className="flex items-start gap-2.5 text-sm text-slate-700">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                      <span className="leading-relaxed">{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* CTAs */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
                <Link
                  to={detail.primary_cta.href}
                  onClick={onClose}
                  className={`flex-1 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all bg-gradient-to-r ${detail.accent} hover:opacity-95`}
                >
                  {detail.primary_cta.label} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to={detail.secondary_cta.href}
                  onClick={onClose}
                  className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold text-slate-700 border border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition-all"
                >
                  {detail.secondary_cta.label}
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
