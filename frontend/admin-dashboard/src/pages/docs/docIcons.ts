import {
  BookOpen, Rocket, Sparkles, Mic2, Bot, PhoneCall, Layers, Users,
  Brain, Workflow, ScrollText, KeyRound, Webhook, ShoppingBag, Zap,
  MessageSquare, FileCode2, FolderOpen, Phone, LifeBuoy, Calendar,
  Database, Puzzle, Globe, Library, Headphones, FileText, Github,
  Video, Play, Code2, type LucideIcon,
} from 'lucide-react';

/**
 * Map icon-name strings (as stored in doc_articles.icon) to the actual
 * Lucide component. Kept in sync with icons referenced by `seedDocs.ts`.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  BookOpen, Rocket, Sparkles, Mic2, Bot, PhoneCall, Layers, Users,
  Brain, Workflow, ScrollText, KeyRound, Webhook, ShoppingBag, Zap,
  MessageSquare, FileCode2, FolderOpen, Phone, LifeBuoy, Calendar,
  Database, Puzzle, Globe, Library, Headphones, FileText, Github,
  Video, Play, Code2,
};

export function docIcon(name?: string | null): LucideIcon {
  if (!name) return BookOpen;
  return ICON_MAP[name] || BookOpen;
}

/**
 * Color key → (text color, bg pill color) pair used by the card grid.
 */
export const COLOR_PAIRS: Record<string, { text: string; bg: string }> = {
  sky:     { text: 'text-sky-400',     bg: 'bg-sky-500/10' },
  violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/10' },
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/10' },
  pink:    { text: 'text-pink-400',    bg: 'bg-pink-500/10' },
  rose:    { text: 'text-rose-400',    bg: 'bg-rose-500/10' },
  indigo:  { text: 'text-indigo-400',  bg: 'bg-indigo-500/10' },
  teal:    { text: 'text-teal-400',    bg: 'bg-teal-500/10' },
  orange:  { text: 'text-orange-400',  bg: 'bg-orange-500/10' },
  yellow:  { text: 'text-yellow-400',  bg: 'bg-yellow-500/10' },
  green:   { text: 'text-green-400',   bg: 'bg-green-500/10' },
  cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/10' },
};

export function colorFor(key?: string | null) {
  return COLOR_PAIRS[key || ''] || COLOR_PAIRS.sky;
}
