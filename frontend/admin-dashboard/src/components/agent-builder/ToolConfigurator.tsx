import { Settings2 } from 'lucide-react';
import { AVAILABLE_TOOLS } from '@/utils/constants';

interface ToolConfiguratorProps {
  enabledTools: string[];
  onToggle: (toolId: string) => void;
}

export function ToolConfigurator({ enabledTools, onToggle }: ToolConfiguratorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Enable the tools your agent can use during conversations.
      </p>
      <div className="space-y-3">
        {AVAILABLE_TOOLS.map((tool) => {
          const isEnabled = enabledTools.includes(tool.id);
          return (
            <div
              key={tool.id}
              className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                isEnabled ? 'border-primary-200 bg-primary-50/50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${
                    isEnabled ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  <Settings2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{tool.name}</p>
                  <p className="text-xs text-gray-500">{tool.description}</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => onToggle(tool.id)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-gray-200 rounded-full peer peer-checked:bg-primary-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
