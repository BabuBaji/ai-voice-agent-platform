import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Menu, X, Sparkles, Phone, Mail, MessageSquare, Globe,
  CheckCircle2, Send, Loader2, ChevronDown, ChevronUp, MapPin, Clock, Twitter, Linkedin, Github,
  Bot, Megaphone, Headphones, Plug, Languages, Wallet,
} from 'lucide-react';
import {
  contactApi,
  INQUIRY_OPTIONS, COMPANY_SIZE_OPTIONS, CONTACT_METHOD_OPTIONS,
  type ContactSubmitRequest, type InquiryType, type CompanySize, type ContactMethod,
} from '@/services/contact.api';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Public Contact Us landing page. Lives OUTSIDE the dashboard layout — no
 * sidebar, no auth. Uses a dedicated marketing look (gradient hero, top nav,
 * FAQ, footer) rather than the internal app chrome.
 */
export function ContactPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [submitted, setSubmitted] = useState<{ reference_id: string; message: string } | null>(null);
  // When this page is rendered inside the DashboardLayout (/help/contact),
  // the user is signed in and the dashboard sidebar already provides
  // navigation — hide the duplicate public marketing nav + footer.
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {!isAuth && <TopNav mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />}

      {/* Hero — only on the public page; the dashboard view goes straight to the form */}
      {!isAuth && (
        <section className="relative overflow-hidden">
          <div aria-hidden className="absolute -top-48 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-gradient-to-br from-indigo-200/60 via-purple-200/40 to-transparent blur-3xl" />
          <div aria-hidden className="absolute -bottom-24 right-10 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-sky-200/50 to-transparent blur-3xl" />

          <div className="relative max-w-6xl mx-auto px-6 pt-16 pb-10 text-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white border border-indigo-100 text-xs font-medium text-indigo-700 shadow-sm">
              <Sparkles className="h-3 w-3" /> We usually reply within one business day
            </div>
            <h1 className="mt-5 text-4xl md:text-6xl font-bold tracking-tight text-slate-900">
              Let's Build Your{' '}
              <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-sky-600 bg-clip-text text-transparent">
                AI Voice Agent
              </span>{' '}
              Together
            </h1>
            <p className="mt-5 max-w-2xl mx-auto text-lg text-slate-600 leading-relaxed">
              Have questions about AI calling, bulk campaigns, web calls, CRM integration, or multilingual voice agents?
              Contact our team and we'll help you get started.
            </p>
            <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
              <a
                href="#contact-form"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold shadow-md hover:shadow-lg hover:translate-y-[-1px] transition"
              >
                <Send className="h-4 w-4" /> Book a Demo
              </a>
              <Link
                to="/support"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition"
              >
                <Headphones className="h-4 w-4" /> Contact Support
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Contact form + info card */}
      <section id="contact-form" className="relative max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            {submitted ? (
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-8 text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-3">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
                <h2 className="text-xl font-semibold text-slate-900">We got your message</h2>
                <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">{submitted.message}</p>
                <p className="mt-3 text-xs text-slate-500">
                  Save your reference ID — you can use it to check status later.
                </p>
                <button
                  onClick={() => setSubmitted(null)}
                  className="mt-5 inline-flex items-center gap-1 text-sm text-indigo-600"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <ContactForm onSubmitted={setSubmitted} />
            )}
          </div>

          <aside className="lg:col-span-2 space-y-4">
            <InfoCard />
            <BusinessHoursCard />
          </aside>
        </div>
      </section>

      {/* How we can help */}
      <section className="max-w-6xl mx-auto px-6 py-10">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-slate-900">How we can help</h2>
          <p className="mt-2 text-slate-600">Pick the area that fits your need and we'll route you to the right specialist.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <HelpCard icon={<Bot />} title="AI Voice Agent Setup" desc="Design agents, define prompts, voice + language, publish to phone or web." tint="indigo" />
          <HelpCard icon={<Megaphone />} title="Bulk Calling Campaigns" desc="Upload a CSV, pick an agent, and launch outbound campaigns at scale." tint="purple" />
          <HelpCard icon={<Globe />} title="Web Call Integration" desc="Embed a live browser-voice widget on your site or app — no phone needed." tint="sky" />
          <HelpCard icon={<Plug />} title="CRM Integration" desc="Sync leads, call outcomes and transcripts into HubSpot, Salesforce, Zoho or custom CRMs." tint="emerald" />
          <HelpCard icon={<Languages />} title="Multilingual Voice" desc="Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi + Indian English." tint="rose" />
          <HelpCard icon={<Wallet />} title="Pricing & Enterprise" desc="Custom plans for colleges, mid-market, and enterprise. Volume discounts on bulk minutes." tint="amber" />
        </div>
      </section>

      {/* FAQ — only on the public marketing page */}
      {!isAuth && (
        <section className="max-w-4xl mx-auto px-6 py-10">
          <div className="text-center mb-6">
            <h2 className="text-3xl font-bold text-slate-900">Frequently asked questions</h2>
            <p className="mt-2 text-slate-600">Quick answers for the things we get asked most.</p>
          </div>
          <FAQList />
        </section>
      )}

      {/* Bottom CTA — only on the public marketing page */}
      {!isAuth && (
        <section className="max-w-6xl mx-auto px-6 py-14">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-sky-600 p-10 text-center text-white shadow-xl">
            <div aria-hidden className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
            <h2 className="relative text-3xl md:text-4xl font-bold">Ready to see it live?</h2>
            <p className="relative mt-3 max-w-xl mx-auto text-indigo-50">
              Book a free 20-minute demo with our team — we'll walk through your use case and spin up a working agent by the end of the call.
            </p>
            <a
              href="#contact-form"
              className="relative mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-indigo-700 font-semibold shadow-md hover:shadow-lg hover:translate-y-[-1px] transition"
            >
              <Send className="h-4 w-4" /> Book a Demo
            </a>
          </div>
        </section>
      )}

      {!isAuth && <Footer />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Top navigation
// ----------------------------------------------------------------------------

function TopNav({ mobileOpen, setMobileOpen }: { mobileOpen: boolean; setMobileOpen: (v: boolean) => void }) {
  const links = [
    { label: 'Home', href: '/landing' },
    { label: 'Solutions', href: '/docs' },
    { label: 'Documentation', href: '/docs' },
    { label: 'Pricing', href: '/docs/article/pricing' },
    { label: 'Contact Us', href: '/contact' },
    { label: 'Book Appointment', href: '#contact-form' },
  ];
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-100">
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 inline-flex items-center justify-center text-white">
            <Bot className="h-4 w-4" />
          </span>
          Voice Agent
        </Link>
        <nav className="hidden md:flex items-center gap-5 text-sm text-slate-600">
          {links.map((l) => (
            l.href.startsWith('#') ? (
              <a key={l.label} href={l.href} className="hover:text-slate-900">{l.label}</a>
            ) : (
              <Link key={l.label} to={l.href} className="hover:text-slate-900">{l.label}</Link>
            )
          ))}
        </nav>
        <div className="hidden md:block">
          <a
            href="#contact-form"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold shadow hover:shadow-md hover:translate-y-[-1px] transition"
          >
            <Send className="h-4 w-4" /> Book a Demo
          </a>
        </div>
        <button
          className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-100 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-3 flex flex-col gap-2 text-sm">
            {links.map((l) =>
              l.href.startsWith('#') ? (
                <a key={l.label} href={l.href} onClick={() => setMobileOpen(false)} className="py-1.5 text-slate-700">{l.label}</a>
              ) : (
                <Link key={l.label} to={l.href} onClick={() => setMobileOpen(false)} className="py-1.5 text-slate-700">{l.label}</Link>
              )
            )}
            <a
              href="#contact-form"
              onClick={() => setMobileOpen(false)}
              className="mt-1 inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold"
            >
              <Send className="h-4 w-4" /> Book a Demo
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

// ----------------------------------------------------------------------------
// Contact form (card)
// ----------------------------------------------------------------------------

function ContactForm({ onSubmitted }: { onSubmitted: (v: { reference_id: string; message: string }) => void }) {
  const [form, setForm] = useState<ContactSubmitRequest>({
    full_name: '',
    email: '',
    phone: '',
    company_name: '',
    website: '',
    inquiry_type: 'DEMO',
    company_size: null,
    preferred_contact_method: 'EMAIL',
    message: '',
    consent_given: true,
    source_url: typeof window !== 'undefined' ? window.location.href : '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return form.full_name.trim().length > 0
      && /.+@.+\..+/.test(form.email)
      && form.phone.trim().length >= 4
      && form.message.trim().length >= 10
      && form.consent_given === true;
  }, [form]);

  const update = <K extends keyof ContactSubmitRequest>(k: K, v: ContactSubmitRequest[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await contactApi.submitPublic({
        ...form,
        company_name: form.company_name || null,
        website: form.website || null,
      });
      onSubmitted({ reference_id: res.reference_id, message: res.message });
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || 'Could not submit the form. Please try again.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6 md:p-8">
      <h2 className="text-xl font-semibold text-slate-900">Tell us about your project</h2>
      <p className="text-sm text-slate-500 mt-1">We'll route your message to the right specialist on our team.</p>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Full name *">
          <input className={inputCls} value={form.full_name} onChange={(e) => update('full_name', e.target.value)} required placeholder="Priya Sharma" />
        </Field>
        <Field label="Business email *">
          <input className={inputCls} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required placeholder="priya@company.com" />
        </Field>
        <Field label="Phone (with country code) *">
          <input className={inputCls} value={form.phone} onChange={(e) => update('phone', e.target.value)} required placeholder="+91 98765 43210" />
        </Field>
        <Field label="Company">
          <input className={inputCls} value={form.company_name || ''} onChange={(e) => update('company_name', e.target.value)} placeholder="GlobalCorp India" />
        </Field>
        <Field label="Website">
          <input className={inputCls} value={form.website || ''} onChange={(e) => update('website', e.target.value)} placeholder="https://yourcompany.com" />
        </Field>
        <Field label="Company size">
          <select className={inputCls} value={form.company_size || ''} onChange={(e) => update('company_size', (e.target.value || null) as CompanySize | null)}>
            <option value="">— select —</option>
            {COMPANY_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Inquiry type *">
          <select className={inputCls} value={form.inquiry_type} onChange={(e) => update('inquiry_type', e.target.value as InquiryType)}>
            {INQUIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Preferred contact method">
          <select className={inputCls} value={form.preferred_contact_method} onChange={(e) => update('preferred_contact_method', e.target.value as ContactMethod)}>
            {CONTACT_METHOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <Field label={`Message * (${form.message.trim().length}/10 min)`}>
          <textarea
            className={inputCls}
            rows={5}
            value={form.message}
            onChange={(e) => update('message', e.target.value)}
            required
            placeholder="Tell us about your use case — number of agents, languages, target market, timeline…"
          />
        </Field>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.consent_given} onChange={(e) => update('consent_given', e.target.checked)} className="mt-1 rounded border-slate-300" required />
        <span>I agree to be contacted by the Voice Agent team about this request. I've read the privacy policy.</span>
      </label>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500">Protected by rate-limiting and reCAPTCHA.</p>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-semibold shadow hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {submitting ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';

// ----------------------------------------------------------------------------
// Info cards
// ----------------------------------------------------------------------------

function InfoCard() {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Contact information</h3>
      <ul className="mt-4 space-y-3 text-sm text-slate-700">
        <li className="flex items-start gap-3">
          <span className="mt-0.5 w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600"><Mail className="h-4 w-4" /></span>
          <div>
            <div className="text-xs text-slate-500">Sales</div>
            <a href="mailto:sales@voiceagent.local" className="font-medium text-slate-900">sales@voiceagent.local</a>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600"><Headphones className="h-4 w-4" /></span>
          <div>
            <div className="text-xs text-slate-500">Support</div>
            <a href="mailto:support@voiceagent.local" className="font-medium text-slate-900">support@voiceagent.local</a>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600"><Phone className="h-4 w-4" /></span>
          <div>
            <div className="text-xs text-slate-500">Phone</div>
            <a href="tel:+919000000000" className="font-medium text-slate-900">+91 90000 00000</a>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600"><MessageSquare className="h-4 w-4" /></span>
          <div>
            <div className="text-xs text-slate-500">WhatsApp</div>
            <a href="https://wa.me/919000000000" className="font-medium text-slate-900" target="_blank" rel="noreferrer">+91 90000 00000</a>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className="mt-0.5 w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600"><MapPin className="h-4 w-4" /></span>
          <div>
            <div className="text-xs text-slate-500">Office</div>
            <div className="font-medium text-slate-900">Hyderabad, Telangana, India</div>
          </div>
        </li>
      </ul>
    </div>
  );
}

function BusinessHoursCard() {
  return (
    <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 p-6">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-900">Business hours</h3>
      </div>
      <ul className="mt-3 text-sm text-slate-700 space-y-1">
        <li className="flex justify-between"><span>Mon – Fri</span><span>10:00 – 19:00 IST</span></li>
        <li className="flex justify-between"><span>Saturday</span><span>10:00 – 15:00 IST</span></li>
        <li className="flex justify-between"><span>Sunday</span><span className="text-slate-400">Closed</span></li>
      </ul>
      <p className="mt-4 text-xs text-slate-600">
        Typical response time — <span className="font-medium text-slate-900">under 4 business hours</span> for sales & demos,
        under 24h for support tickets.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// How we can help cards
// ----------------------------------------------------------------------------

function HelpCard({ icon, title, desc, tint }: { icon: React.ReactNode; title: string; desc: string; tint: string }) {
  const tints: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600',
    purple: 'bg-purple-50 text-purple-600',
    sky: 'bg-sky-50 text-sky-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm hover:shadow-md hover:translate-y-[-1px] transition">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tints[tint]}`}>
        <div className="[&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      </div>
      <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{desc}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// FAQ
// ----------------------------------------------------------------------------

function FAQList() {
  const items: { q: string; a: string }[] = [
    { q: 'How soon will your team contact me?', a: 'Sales and demo inquiries get a response within 4 business hours on weekdays. Support tickets within 24 hours.' },
    { q: 'Can I book a demo?', a: "Yes — pick “Product Demo” in the inquiry dropdown above. We'll share a Google Meet link at your preferred time slot." },
    { q: 'Do you support Telugu and Indian languages?', a: 'Yes. Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Assamese, Urdu and Indian English are all supported out of the box.' },
    { q: 'Can you integrate with my CRM?', a: 'We ship native integrations with HubSpot, Salesforce, Zoho and Pipedrive, and open webhooks + REST APIs for custom CRMs. Call data, transcripts and AI analysis all sync as activities on the lead.' },
    { q: 'Do you support bulk calling?', a: "Yes. Upload a CSV, pick an agent and a phone number, and launch — our bulk campaign runner handles retries, concurrency, and hooks the results into the agent's post-call workflow." },
    { q: 'Can I use my own phone number?', a: "You can bring your own Plivo or Twilio number, or we'll provision one for you. Indian KYC (DOT/TRAI) is required for outbound dialing from Indian numbers." },
  ];
  return (
    <div className="space-y-2">
      {items.map((it, i) => <FAQItem key={i} {...it} />)}
    </div>
  );
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border ${open ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'} transition`}>
      <button className="w-full flex items-center justify-between text-left px-5 py-3" onClick={() => setOpen(!open)}>
        <span className="font-medium text-slate-900">{q}</span>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-4 text-sm text-slate-600">{a}</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Footer
// ----------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-10">
      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 inline-flex items-center justify-center text-white">
              <Bot className="h-4 w-4" />
            </span>
            Voice Agent
          </Link>
          <p className="mt-3 text-sm text-slate-500 max-w-xs">AI voice agents for phone, web and bulk campaigns — multilingual, CRM-connected, production-grade.</p>
          <div className="mt-4 flex items-center gap-3 text-slate-400">
            <a href="#" className="hover:text-slate-600" aria-label="Twitter"><Twitter className="h-4 w-4" /></a>
            <a href="#" className="hover:text-slate-600" aria-label="LinkedIn"><Linkedin className="h-4 w-4" /></a>
            <a href="#" className="hover:text-slate-600" aria-label="GitHub"><Github className="h-4 w-4" /></a>
          </div>
        </div>
        <FooterCol title="Product" items={[
          { label: 'Agent Builder', href: '/agents' },
          { label: 'Web Call', href: '/agents' },
          { label: 'Bulk Campaigns', href: '/campaigns' },
          { label: 'CRM Integration', href: '/crm/leads' },
        ]} />
        <FooterCol title="Resources" items={[
          { label: 'Documentation', href: '/docs' },
          { label: 'Changelog', href: '/docs' },
          { label: 'Pricing', href: '/docs/article/pricing' },
        ]} />
        <FooterCol title="Support" items={[
          { label: 'Contact Us', href: '/contact' },
          { label: 'Report Issue', href: '/report' },
          { label: 'Status', href: '/docs' },
        ]} />
      </div>
      <div className="border-t border-slate-100 text-center text-xs text-slate-400 py-4">
        © {new Date().getFullYear()} Voice Agent · All rights reserved
      </div>
    </footer>
  );
}
function FooterCol({ title, items }: { title: string; items: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm">
        {items.map((it) => (
          <li key={it.label}>
            <Link to={it.href} className="text-slate-500 hover:text-slate-900">{it.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

