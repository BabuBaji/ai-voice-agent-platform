import { Calendar, Search, BookOpen, PhoneForwarded, MessageSquare, Mail, Webhook, CreditCard } from 'lucide-react';
import { AVAILABLE_TOOLS } from '@/utils/constants';

interface ToolConfiguratorProps {
  enabledTools: string[];
  onToggle: (toolId: string) => void;
}

const toolIcons: Record<string, React.ReactNode> = {
  calendar: <Calendar className="h-5 w-5" />,
  crm_lookup: <Search className="h-5 w-5" />,
  knowledge_search: <BookOpen className="h-5 w-5" />,
  transfer: <PhoneForwarded className="h-5 w-5" />,
  sms: <MessageSquare className="h-5 w-5" />,
  email: <Mail className="h-5 w-5" />,
  webhook: <Webhook className="h-5 w-5" />,
  payment: <CreditCard className="h-5 w-5" />,
};

export function ToolConfigurator({ enabledTools, onToggle }: ToolConfiguratorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Enable the tools your agent can use during conversations.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {AVAILABLE_TOOLS.map((tool) => {
          const isEnabled = enabledTools.includes(tool.id);
          return (
            <div
              key={tool.id}
              onClick={() => onToggle(tool.id)}
              className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                isEnabled
                  ? 'border-primary-200 bg-primary-50/50 shadow-sm'
                  : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-card'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-xl transition-colors ${
                    isEnabled ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {toolIcons[tool.id] || <Webhook className="h-5 w-5" />}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{tool.name}</p>
                  <p className="text-xs text-gray-500">{tool.description}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-3">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => onToggle(tool.id)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-primary-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all after:shadow-sm" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
