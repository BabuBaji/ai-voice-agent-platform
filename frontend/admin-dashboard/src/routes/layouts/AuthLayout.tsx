import { Outlet } from 'react-router-dom';
import { Mic } from 'lucide-react';

export function AuthLayout() {
  return (
    <div className="min-h-screen flex">
      {/* Left - branding panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Mic className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white">VoiceAgent</span>
        </div>

        <div>
          <h2 className="text-4xl font-bold text-white mb-4">
            Build Intelligent Voice Agents
          </h2>
          <p className="text-lg text-primary-200 leading-relaxed">
            Create, deploy, and manage AI-powered voice agents that handle customer calls,
            qualify leads, and automate conversations at scale.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-3xl font-bold text-white">50K+</p>
            <p className="text-sm text-primary-300">Calls Handled</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-white">98%</p>
            <p className="text-sm text-primary-300">Satisfaction</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-white">24/7</p>
            <p className="text-sm text-primary-300">Availability</p>
          </div>
        </div>
      </div>

      {/* Right - form area */}
      <div className="flex-1 flex items-center justify-center p-6 bg-gray-50">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
