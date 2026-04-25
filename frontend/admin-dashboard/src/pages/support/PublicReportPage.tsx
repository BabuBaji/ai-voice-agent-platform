import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ReportIssueForm } from '@/components/support/ReportIssueForm';

/**
 * Public, unauthenticated report page.
 *
 * Backed by POST /api/v1/reports/public (IP-rate-limited + reCAPTCHA when
 * RECAPTCHA_SECRET is configured server-side). No access to user profile
 * auto-fill — the user types everything in.
 */
export function PublicReportPage() {
  const [submitted, setSubmitted] = useState<{ ticket_id: string; message: string } | null>(null);
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <LifeBuoy className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Report an Issue</h1>
            <p className="text-sm text-gray-500">No account required. Describe what's wrong or what you'd like to see next.</p>
          </div>
        </div>
        <div className="text-sm">
          <Link to="/login" className="text-indigo-600 hover:underline">Sign in</Link> to track your reports and get faster responses.
        </div>

        {submitted ? (
          <Card className="mt-6 p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mb-3">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">Report submitted</h2>
            <p className="text-sm text-gray-600 mt-1 max-w-md mx-auto">{submitted.message}</p>
            <p className="mt-4 text-xs text-gray-500">
              Save your ticket ID — you'll need it to reference this report later.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button variant="secondary" onClick={() => setSubmitted(null)}>Submit another</Button>
              <Link to="/login" className="inline-flex items-center text-sm text-indigo-600">
                Sign in to track <ExternalLink className="h-3 w-3 ml-1" />
              </Link>
            </div>
          </Card>
        ) : (
          <div className="mt-6">
            <ReportIssueForm mode="public" onSubmitted={setSubmitted} />
          </div>
        )}
      </div>
    </div>
  );
}
