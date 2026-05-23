/**
 * templateVariables — resolve a template's variable_mapping against a
 * runtime context (lead, conversation, ...) into the positional array
 * Meta expects on its template send payload.
 *
 * Example:
 *   template.body_text       = "Hi {{1}}, your brochure: {{2}}"
 *   template.variable_mapping = { "1": "lead.name", "2": "brochure_url" }
 *   context                   = { lead: { name: "Alice" }, brochure_url: "https://…" }
 *   → resolveTemplateVariables(template, context) = ["Alice", "https://…"]
 *
 * Missing values fall back to empty string (caller decides whether to
 * reject before send).
 */
import type { WhatsAppTemplate } from './whatsappTemplateStore';

export interface TemplateContext {
  lead?: { name?: string; phone?: string; email?: string; [k: string]: any };
  agent?: { name?: string; phone?: string; [k: string]: any };
  conversation?: { id?: string; summary?: string; [k: string]: any };
  brochure_url?: string;
  callback_at?: string;
  /** Any extra ad-hoc variables the caller wants to expose. */
  extras?: Record<string, any>;
}

/** Resolve to the positional array Meta wants for template parameters.
 *  Returns { params, missing } where missing lists slot indices we couldn't
 *  fill — caller can choose to fail closed or send with empty strings. */
export function resolveTemplateVariables(
  template: Pick<WhatsAppTemplate, 'variable_count' | 'variable_mapping'>,
  context: TemplateContext,
): { params: string[]; missing: string[] } {
  const params: string[] = [];
  const missing: string[] = [];
  const mapping = template.variable_mapping || {};
  for (let i = 1; i <= template.variable_count; i++) {
    const key = String(i);
    const path = mapping[key];
    if (!path) {
      missing.push(key);
      params.push('');
      continue;
    }
    const value = resolvePath(context, path);
    if (value == null || value === '') {
      missing.push(key);
      params.push('');
    } else {
      params.push(String(value));
    }
  }
  return { params, missing };
}

/** Resolve a dotted path against an object. e.g. "lead.name" or "extras.foo". */
function resolvePath(ctx: any, path: string): any {
  if (!path) return null;
  const parts = path.split('.');
  let cur: any = ctx;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}
