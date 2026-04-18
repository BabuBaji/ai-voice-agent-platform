import { Link } from 'react-router-dom';
import {
  Mic, Phone, Bot, Brain, Database, BarChart3, Workflow,
  Users, Globe, Zap, Shield, Headphones, ChevronRight,
  Star, ArrowRight, Check, Play, MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

const stats = [
  { label: 'LLMs Supported', value: '23+' },
  { label: 'Voices Available', value: '1000+' },
  { label: 'Languages', value: '90+' },
  { label: 'Businesses Trust Us', value: '500+' },
];

const features = [
  { icon: Phone, title: 'Voice AI Calls', description: 'Deploy AI agents that handle inbound and outbound calls with human-like conversations, 24/7.' },
  { icon: Brain, title: 'Multi-LLM Support', description: 'Choose from OpenAI, Anthropic Claude, Google Gemini, and 20+ more language models.' },
  { icon: Database, title: 'Knowledge Base (RAG)', description: 'Upload documents and let your agents answer questions using your company data.' },
  { icon: Users, title: 'CRM Integration', description: 'Sync with Salesforce, HubSpot, and more. Auto-create leads from every call.' },
  { icon: Workflow, title: 'Workflow Automation', description: 'Build automated workflows triggered by call events, lead scores, and more.' },
  { icon: BarChart3, title: 'Analytics Dashboard', description: 'Real-time call analytics, agent performance metrics, and conversion tracking.' },
];

const steps = [
  { step: '01', title: 'Create Your Agent', description: 'Configure your AI voice agent with a system prompt, voice, and tools in minutes.' },
  { step: '02', title: 'Connect Phone Number', description: 'Assign a phone number from Twilio or Exotel to start receiving or making calls.' },
  { step: '03', title: 'Start Automating', description: 'Your agent handles calls, qualifies leads, books appointments, and updates your CRM.' },
];

const integrations = [
  'Twilio', 'Exotel', 'OpenAI', 'Anthropic', 'Google', 'ElevenLabs',
  'Deepgram', 'Salesforce', 'HubSpot', 'Slack', 'Zapier', 'Make',
  'Cal.com', 'Google Calendar', 'SendGrid', 'Stripe',
];

const pricing = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Perfect for getting started',
    features: ['1 AI Agent', '100 calls/month', '1 Knowledge Base', 'Community support', 'Basic analytics'],
    cta: 'Start Free',
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '$49',
    period: '/month',
    description: 'For growing businesses',
    features: ['10 AI Agents', '5,000 calls/month', 'Unlimited Knowledge Bases', 'Priority support', 'Advanced analytics', 'CRM integrations', 'Custom workflows', 'API access'],
    cta: 'Start Free Trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations',
    features: ['Unlimited AI Agents', 'Unlimited calls', 'Dedicated account manager', 'Custom integrations', 'SLA guarantee', 'HIPAA compliance', 'SSO & RBAC', 'On-premise option'],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen bg-dark-bg text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-dark-bg/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-brand flex items-center justify-center">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">VoiceAgent AI</span>
          </Link>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">Pricing</a>
            <a href="#integrations" className="text-sm text-gray-400 hover:text-white transition-colors">Integrations</a>
            <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">Docs</a>
          </div>

          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost-dark" size="sm">Log in</Button>
            </Link>
            <Link to="/register">
              <Button variant="gradient" size="sm">Get Started Free</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        <div className="hero-gradient absolute inset-0" />
        <div className="grid-pattern absolute inset-0" />

        {/* Floating orbs */}
        <div className="absolute top-40 left-10 w-72 h-72 bg-primary-600/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent-600/10 rounded-full blur-3xl animate-float delay-300" />

        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/10 mb-8 animate-fade-in">
            <Star className="h-3.5 w-3.5 text-yellow-400" />
            <span className="text-sm text-gray-300">Trusted by 500+ businesses worldwide</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 animate-slide-up">
            Build AI Voice Agents{' '}
            <span className="gradient-text-light">in Minutes</span>
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed animate-slide-up delay-100">
            Create, deploy, and manage enterprise-grade AI voice assistants that handle customer calls,
            qualify leads, and automate conversations at scale. No code required.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up delay-200">
            <Link to="/register">
              <Button variant="gradient" size="xl" className="rounded-xl">
                Start Free
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
            <Button variant="outline-dark" size="xl" className="rounded-xl">
              <Play className="h-5 w-5" />
              Book a Demo
            </Button>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="relative border-y border-white/5 bg-dark-surface/50">
        <div className="max-w-5xl mx-auto px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, i) => (
              <div key={stat.label} className="text-center animate-slide-up" style={{ animationDelay: `${i * 100}ms` }}>
                <p className="text-3xl md:text-4xl font-bold gradient-text-light">{stat.value}</p>
                <p className="text-sm text-gray-500 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-primary-400 uppercase tracking-wider mb-3">Features</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything you need to build voice AI</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">From voice cloning to CRM integration, we provide all the tools you need to create intelligent voice agents.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div
                key={feature.title}
                className="glass-card group hover:border-primary-500/30 hover:bg-white/5 transition-all duration-300 animate-slide-up"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary-600/20 to-accent-600/20 flex items-center justify-center mb-4 group-hover:from-primary-600/30 group-hover:to-accent-600/30 transition-colors">
                  <feature.icon className="h-6 w-6 text-primary-400" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 border-y border-white/5 bg-dark-surface/30">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-primary-400 uppercase tracking-wider mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Three steps to automate your calls</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {steps.map((step, i) => (
              <div key={step.step} className="relative animate-slide-up" style={{ animationDelay: `${i * 150}ms` }}>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-full w-full h-px bg-gradient-to-r from-primary-600/30 to-transparent z-0" />
                )}
                <div className="relative">
                  <span className="text-5xl font-bold text-primary-600/20">{step.step}</span>
                  <h3 className="text-xl font-semibold text-white mt-2 mb-3">{step.title}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section id="integrations" className="py-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-sm font-semibold text-primary-400 uppercase tracking-wider mb-3">Integrations</p>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Works with your favorite tools</h2>
          <p className="text-gray-400 max-w-xl mx-auto mb-12">Connect with 30+ services out of the box. More integrations added every week.</p>

          <div className="flex flex-wrap justify-center gap-3">
            {integrations.map((name) => (
              <div
                key={name}
                className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-gray-300 hover:border-primary-500/30 hover:bg-white/10 hover:text-white transition-all cursor-default"
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 border-y border-white/5 bg-dark-surface/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-sm font-semibold text-primary-400 uppercase tracking-wider mb-3">Pricing</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, transparent pricing</h2>
            <p className="text-gray-400">Start free and scale as you grow. No hidden fees.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pricing.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border p-8 transition-all duration-300 ${
                  plan.highlighted
                    ? 'border-primary-500/50 bg-gradient-to-b from-primary-600/10 to-transparent shadow-glow relative'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                }`}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-4 py-1 rounded-full text-xs font-semibold bg-gradient-brand text-white">Most Popular</span>
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                <p className="text-sm text-gray-400 mt-1">{plan.description}</p>
                <div className="mt-6 mb-6">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-gray-400">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                      <Check className="h-4 w-4 text-primary-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link to="/register">
                  <Button
                    variant={plan.highlighted ? 'gradient' : 'outline-dark'}
                    className="w-full rounded-xl"
                    size="lg"
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to automate your calls?</h2>
          <p className="text-gray-400 mb-8 max-w-xl mx-auto">
            Join 500+ businesses using VoiceAgent AI to handle customer calls, generate leads, and close deals automatically.
          </p>
          <Link to="/register">
            <Button variant="gradient" size="xl" className="rounded-xl">
              Get Started Free
              <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-brand flex items-center justify-center">
                  <Mic className="h-4 w-4 text-white" />
                </div>
                <span className="font-bold text-white">VoiceAgent AI</span>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                Enterprise-grade AI voice assistants for your business.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Product</h4>
              <ul className="space-y-2.5">
                {['Features', 'Pricing', 'Integrations', 'API Docs', 'Changelog'].map((item) => (
                  <li key={item}><a href="#" className="text-sm text-gray-500 hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Resources</h4>
              <ul className="space-y-2.5">
                {['Documentation', 'SDK Reference', 'Blog', 'Community', 'Status'].map((item) => (
                  <li key={item}><a href="#" className="text-sm text-gray-500 hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Company</h4>
              <ul className="space-y-2.5">
                {['About', 'Careers', 'Contact', 'Partners'].map((item) => (
                  <li key={item}><a href="#" className="text-sm text-gray-500 hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2.5">
                {['Privacy', 'Terms', 'Security', 'GDPR'].map((item) => (
                  <li key={item}><a href="#" className="text-sm text-gray-500 hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-white/5 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-gray-600">2026 VoiceAgent AI. All rights reserved.</p>
            <div className="flex items-center gap-6">
              {['Twitter', 'GitHub', 'LinkedIn', 'Discord'].map((social) => (
                <a key={social} href="#" className="text-sm text-gray-600 hover:text-white transition-colors">{social}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
