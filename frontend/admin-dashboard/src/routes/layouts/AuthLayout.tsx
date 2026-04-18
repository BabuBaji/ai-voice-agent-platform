import { Outlet } from 'react-router-dom';
import { Mic, Check, Shield, BarChart3, Workflow, Users } from 'lucide-react';

const highlights = [
  { icon: Users, text: 'Personalized Voice Agents' },
  { icon: Workflow, text: 'Seamless Integrations' },
  { icon: Shield, text: 'Enterprise-grade Security' },
  { icon: BarChart3, text: 'Advanced Analytics' },
];

export function AuthLayout() {
  return (
    <div className="min-h-screen flex">
      {/* Left - branding panel */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Dark gradient background */}
        <div className="absolute inset-0 bg-dark-bg" />
        <div className="absolute inset-0 hero-gradient" />
        <div className="absolute inset-0 grid-pattern" />

        {/* Floating orbs */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-primary-600/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 w-64 h-64 bg-accent-600/10 rounded-full blur-3xl animate-float delay-300" />

        <div className="relative z-10 p-12 flex flex-col justify-between w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-brand flex items-center justify-center shadow-glow">
              <Mic className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold text-white">VoiceAgent AI</span>
          </div>

          {/* Main content */}
          <div className="max-w-lg">
            <h2 className="text-4xl font-bold text-white mb-4 leading-tight">
              Enterprise-grade AI voice assistants for your business
            </h2>
            <p className="text-lg text-gray-400 leading-relaxed mb-10">
              Create, deploy, and manage AI-powered voice agents that handle customer calls,
              qualify leads, and automate conversations at scale.
            </p>

            {/* Feature highlights */}
            <div className="grid grid-cols-2 gap-4">
              {highlights.map((item) => (
                <div key={item.text} className="flex items-center gap-3 glass-card py-3 px-4">
                  <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center flex-shrink-0">
                    <item.icon className="h-4 w-4 text-primary-400" />
                  </div>
                  <span className="text-sm text-gray-300 font-medium">{item.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom stats */}
          <div className="flex items-center gap-8">
            <div>
              <p className="text-2xl font-bold text-white">500+</p>
              <p className="text-xs text-gray-500">Businesses</p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div>
              <p className="text-2xl font-bold text-white">10M+</p>
              <p className="text-xs text-gray-500">Calls Handled</p>
            </div>
            <div className="w-px h-8 bg-white/10" />
            <div>
              <p className="text-2xl font-bold text-white">99.9%</p>
              <p className="text-xs text-gray-500">Uptime</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right - form area */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
