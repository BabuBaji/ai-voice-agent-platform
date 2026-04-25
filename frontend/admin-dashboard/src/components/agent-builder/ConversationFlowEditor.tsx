import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, Sparkles } from 'lucide-react';
import { generateConversationFlow } from '@/utils/conversationFlow';

interface ConversationFlowEditorProps {
  value: string;
  onChange: (value: string) => void;
}

type Section = {
  id: string;
  num: number;
  title: string;
  body: string;
  enabled: boolean;
};

/**
 * Sectioned "Conversational Flow" editor. Parses the system_prompt string
 * into numbered sections using `# N. Title` markers, renders each as a
 * collapsible card with an ON/OFF toggle, and writes the full string back
 * through onChange whenever anything changes.
 *
 * Backwards compatible — if the incoming value has no markers, the whole
 * text becomes a single "Agent Instructions" section (user can still edit it
 * and add more sections).
 *
 * Disabled sections are written back wrapped in [DISABLED] markers so the
 * state round-trips through save/reload.
 */
export function ConversationFlowEditor({ value, onChange }: ConversationFlowEditorProps) {
  const [sections, setSections] = useState<Section[]>(() => parseToSections(value));
  const [openIds, setOpenIds] = useState<Record<string, boolean>>(() => {
    // Open the first section by default so the user sees content right away
    const first = parseToSections(value)[0];
    return first ? { [first.id]: true } : {};
  });
  const lastExternalValueRef = useRef<string>(value);

  // If the parent value changes externally (e.g. generated from the wizard),
  // re-parse. We ignore echoes of our own serialised output.
  useEffect(() => {
    if (value !== lastExternalValueRef.current && value !== serialize(sections)) {
      const fresh = parseToSections(value);
      setSections(fresh);
      if (fresh.length > 0 && Object.keys(openIds).length === 0) {
        setOpenIds({ [fresh[0].id]: true });
      }
      lastExternalValueRef.current = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Section[]) => {
    setSections(next);
    const serialised = serialize(next);
    lastExternalValueRef.current = serialised;
    onChange(serialised);
  };

  const toggleEnabled = (id: string) => {
    commit(sections.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const updateBody = (id: string, body: string) => {
    commit(sections.map((s) => (s.id === id ? { ...s, body } : s)));
  };

  const updateTitle = (id: string, title: string) => {
    commit(sections.map((s) => (s.id === id ? { ...s, title } : s)));
  };

  const addSection = () => {
    const nextNum = (sections[sections.length - 1]?.num ?? 0) + 1;
    const id = `s-${Date.now()}`;
    const next: Section = {
      id,
      num: nextNum,
      title: 'New Section',
      body: '# NEW SECTION\n- Describe what this section should do.\n\nExample response:\nYour example here.',
      enabled: true,
    };
    const updated = [...sections, next];
    commit(updated);
    setOpenIds((o) => ({ ...o, [id]: true }));
  };

  const removeSection = (id: string) => {
    if (!confirm('Remove this section?')) return;
    const filtered = sections.filter((s) => s.id !== id);
    // Renumber sequentially
    commit(filtered.map((s, i) => ({ ...s, num: i + 1 })));
  };

  const generate = () => {
    if (sections.some((s) => s.body.trim().length > 0)) {
      if (!confirm('Replace the current conversation flow with a generated template?')) return;
    }
    const tpl = generateConversationFlow({
      userDescription: sections[0]?.body?.split('\n')[0] || 'Voice AI assistant',
    });
    const fresh = parseToSections(tpl);
    commit(fresh);
    setOpenIds(fresh.length > 0 ? { [fresh[0].id]: true } : {});
  };

  const toggleOpen = (id: string) => setOpenIds((o) => ({ ...o, [id]: !o[id] }));

  const allExpanded = useMemo(
    () => sections.length > 0 && sections.every((s) => openIds[s.id]),
    [sections, openIds]
  );
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    if (!allExpanded) sections.forEach((s) => { next[s.id] = true; });
    setOpenIds(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Conversational Flow</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {sections.length} section{sections.length === 1 ? '' : 's'} · click a section to expand
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            type="button"
            onClick={generate}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            title="Generate a starter flow"
          >
            <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
            Generate
          </button>
          <button
            type="button"
            onClick={addSection}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Section
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {sections.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center">
            <p className="text-sm text-gray-600">No sections yet.</p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={generate}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500"
              >
                Generate starter flow
              </button>
              <button
                type="button"
                onClick={addSection}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              >
                Add blank section
              </button>
            </div>
          </div>
        )}

        {sections.map((s) => {
          const open = !!openIds[s.id];
          return (
            <div
              key={s.id}
              className={`rounded-xl border transition-colors ${
                s.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50/50'
              }`}
            >
              {/* Section header */}
              <div className="flex items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => toggleOpen(s.id)}
                  aria-label={open ? 'Collapse' : 'Expand'}
                  className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <span className="text-xs font-mono text-gray-500 tabular-nums w-6 text-right">{s.num}.</span>

                <input
                  value={s.title}
                  onChange={(e) => updateTitle(s.id, e.target.value)}
                  className={`flex-1 bg-transparent text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-200 rounded px-1.5 py-1 ${
                    s.enabled ? 'text-gray-900' : 'text-gray-500'
                  }`}
                />

                <button
                  type="button"
                  onClick={() => toggleEnabled(s.id)}
                  aria-label={s.enabled ? 'Turn off' : 'Turn on'}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                    s.enabled
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-gray-400'}`}
                  />
                  {s.enabled ? 'ON' : 'OFF'}
                </button>

                <button
                  type="button"
                  onClick={() => removeSection(s.id)}
                  aria-label="Remove"
                  className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Body (only when expanded) */}
              {open && (
                <div className="px-3 pb-3">
                  <textarea
                    value={s.body}
                    onChange={(e) => updateBody(s.id, e.target.value)}
                    rows={Math.min(16, Math.max(5, s.body.split('\n').length + 1))}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-y text-gray-800"
                    placeholder="# Section content..."
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------- parse / serialise -----------------------

/** Split a system-prompt string into numbered sections by `# N. Title` markers. */
function parseToSections(raw: string): Section[] {
  const text = (raw || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];

  // Match "# 1. Title" (any number) at the start of a line
  const re = /^#\s+(\d+)\.\s+(.+?)\s*$/gm;
  const matches: { index: number; num: number; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push({ index: m.index, num: Number(m[1]), title: m[2].trim() });
  }

  if (matches.length === 0) {
    // No numbered markers — treat the whole thing as one section
    return [{
      id: 's-0',
      num: 1,
      title: 'Agent Instructions',
      body: text.trim(),
      enabled: true,
    }];
  }

  const sections: Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const headerLineEnd = text.indexOf('\n', start);
    const bodyStart = headerLineEnd === -1 ? text.length : headerLineEnd + 1;
    let body = text.slice(bodyStart, nextStart).trim();
    let enabled = true;
    // Respect our round-trip marker
    if (body.startsWith('[DISABLED]')) {
      enabled = false;
      body = body.replace(/^\[DISABLED\]\s*\n?/, '').trim();
    }
    sections.push({
      id: `s-${i}-${matches[i].num}`,
      num: matches[i].num,
      title: matches[i].title,
      body,
      enabled,
    });
  }
  return sections;
}

/** Rebuild the full system_prompt string from sections. */
function serialize(sections: Section[]): string {
  return sections
    .map((s) => {
      const header = `# ${s.num}. ${s.title}`;
      const body = s.enabled ? s.body : `[DISABLED]\n${s.body}`;
      return `${header}\n\n${body}`.trim();
    })
    .join('\n\n') + '\n';
}
