/**
 * Local, deterministic "Generate Conversation Flow" helper.
 *
 * Produces a variable-length sectioned system prompt whose sections depend
 * on what the user described. The format always parses into numbered sections
 * (`# N. Title`) so the ConversationFlowEditor can render it as collapsible
 * cards.
 *
 * Strategy:
 *   - Always emit: Agent Identity & Purpose → Understand Caller Intent.
 *   - Scan the user's prompt for intent signals (appointment / support / lead /
 *     sales / negotiation / recruitment / survey / billing / recipe keywords)
 *     and append matching sections when they fire.
 *   - Always end with: Out of Scope Handling → Closing → Knowledge & Context
 *     → FAQ Examples.
 *
 * The total section count varies (~6 for simple agents, 12+ for complex
 * multi-intent agents).
 */

export type ConversationFlowInput = {
  userDescription: string;
  agentName?: string;
  businessName?: string;
};

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'for', 'to', 'and', 'of', 'in', 'on', 'with', 'about',
  'you', 'your', 'our', 'their', 'is', 'are', 'be', 'as', 'agent', 'voice',
  'ai', 'call', 'caller', 'user', 'help', 'create', 'build', 'make',
  'information', 'assistant', 'that', 'this', 'from', 'into', 'over',
  'can', 'will', 'should', 'must', 'would', 'them', 'they', 'have', 'has',
]);

function detectDomain(desc: string): string {
  const words = desc
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
  const domain = words[0] || 'service';
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

type Section = { title: string; body: string };

/** Core identity section — always first. */
function identitySection(agent: string, business: string, domain: string, purposeLine: string): Section {
  const domainL = domain.toLowerCase();
  return {
    title: 'Agent Identity & Purpose',
    body: `# AGENT GLOBAL INSTRUCTIONS
## PERSONA
- The agent is a virtual assistant named ${agent}.
- Represents ${business}, a business related to ${domainL}.
- Speaks to anyone calling with questions about ${domainL}.
- Purpose is to ${purposeLine}
- Overall intent is to be friendly, helpful, and knowledgeable.
- Tone is warm, patient, and conversational.

# RESPONSE GENERATION GUIDES
- Your responses will be read aloud by a text-to-speech system.
- Always use short, simple, conversational sentences.
- Never use bullet points, numbered lists, formatted text, or symbols in spoken responses.
- End responses with a soft, natural conversational hook when appropriate.
- Speak politely and naturally, as if talking to a real person on a phone call.

# SCOPE
- Stay focused on ${domainL} and the caller's request.
- If the caller asks something outside scope, politely redirect or offer to transfer to a human.
- Do not make up facts. If unsure, say you will follow up.

# GUARDRAILS
- Never give medical or legal advice unless explicitly authorised.
- Never make unsupported claims.
- Never ask for sensitive personal information beyond what is needed for the task.`,
  };
}

function understandIntentSection(domain: string): Section {
  const d = domain.toLowerCase();
  return {
    title: 'Understand Caller Intent',
    body: `# UNDERSTAND CALLER INTENT
- Ask the caller what they would like help with today.
- Identify the specific ${d}-related task they're calling about.

Example response:
What brings you in today — would you like help with ${d} or something else?`,
  };
}

function outOfScopeSection(): Section {
  return {
    title: 'Out of Scope Handling',
    body: `# OUT OF SCOPE HANDLING
- Politely refuse or redirect if asked for medical, legal, or financial advice.
- Offer to transfer to a human if the caller needs help you cannot provide.

Example response:
I'm sorry, I can't help with that directly. Would you like me to connect you with someone from our team?`,
  };
}

function closingSection(business: string): Section {
  return {
    title: 'Closing Statement',
    body: `# CLOSING STATEMENT
- End the call politely and confirm any next steps agreed on.
- Offer further help before the caller hangs up.

Example response:
Is there anything else I can help with? Thanks for calling ${business}.`,
  };
}

function knowledgeContextSection(domain: string, business: string): Section {
  const d = domain.toLowerCase();
  return {
    title: 'Agent Knowledge & Context',
    body: `The agent knows basic facts about ${business} and ${d}. If the caller asks for something more specific than the agent knows, the agent should acknowledge it doesn't have that information and offer to follow up or transfer to a human.`,
  };
}

function faqSection(business: string, domain: string): Section {
  const d = domain.toLowerCase();
  return {
    title: 'FAQ Examples',
    body: `Q: What do you do?
A: I'm ${business}'s voice assistant — I can help with ${d} questions and connect you with the right team.

Q: Can I speak to a human?
A: Of course — I can transfer you right now.

Q: What are your hours?
A: Our team is available during regular business hours. I'm available any time.`,
  };
}

// -------------------- intent rules --------------------
// Each rule fires when its pattern matches the user's description. When it
// fires, its `build` function returns one or more sections to append.
type IntentRule = {
  name: string;
  pattern: RegExp;
  build: (ctx: { domain: string; business: string; agent: string }) => Section[];
};

const INTENT_RULES: IntentRule[] = [
  // --- Lead generation ---
  {
    name: 'lead_gen',
    pattern: /(lead|qualif|prospect|interest|demo|consult|inquiry)/i,
    build: ({ domain }) => [
      {
        title: 'Qualification Questions',
        body: `# QUALIFICATION QUESTIONS
- Ask ONE qualification question at a time.
- Focus on: need, budget, timeline, decision-maker, current solution.

Example response:
To point you to the right option — what kind of ${domain.toLowerCase()} setup are you looking for?`,
      },
      {
        title: 'Capture Lead Details',
        body: `# CAPTURE LEAD DETAILS
- Confirm the caller's full name, email, and phone before ending the call.
- Capture lead_score (0-100) internally based on fit + urgency.
- Capture next_action: demo_booked | callback_required | nurture | not_a_fit.

Example response:
Could I grab your name and the best email to send the details to?`,
      },
    ],
  },

  // --- Appointment booking ---
  {
    name: 'appointment',
    pattern: /(book|appointment|schedule|slot|visit|reserv|availab)/i,
    build: ({ business }) => [
      {
        title: 'Check Availability',
        body: `# CHECK AVAILABILITY
- Ask the caller's preferred date and time window.
- Offer up to three available slots in that window.
- Only offer slots you know are available — never invent them.

Example response:
Great — any preference on day and time? I can see what's open.`,
      },
      {
        title: 'Confirm Booking',
        body: `# CONFIRM BOOKING
- Read back the confirmed slot, date, and location aloud before booking.
- Capture: name, phone, email, slot, location, notes.
- Send a confirmation via the caller's preferred channel.

Example response:
Just to confirm — ${business} will see you on {date} at {time}. I'll send a confirmation to your email.`,
      },
    ],
  },

  // --- Support / troubleshooting ---
  {
    name: 'support',
    pattern: /(support|issue|problem|troubleshoot|help desk|complaint|ticket|bug|error|not working)/i,
    build: () => [
      {
        title: 'Troubleshooting',
        body: `# TROUBLESHOOTING
- Ask clarifying questions ONE at a time.
- Check for common causes before guessing.
- Walk the caller through a fix step by step, waiting for confirmation each step.

Example response:
Let's take it step by step — when you last tried it, what exactly happened?`,
      },
      {
        title: 'Create Ticket',
        body: `# CREATE TICKET
- If the issue can't be resolved on the call, create a ticket.
- Capture: issue_type, severity, product, exact error, reproduction steps.
- Read the ticket ID back to the caller.

Example response:
I've created ticket #TKT-0000. Someone from our team will follow up within 24 hours.`,
      },
      {
        title: 'Escalate to Human',
        body: `# ESCALATE TO HUMAN
- Escalate immediately if: the caller is angry, the issue affects production, or it involves security.
- Offer a human transfer politely and confirm before doing so.

Example response:
I'd like to get a teammate on the line with you — is that okay?`,
      },
    ],
  },

  // --- Sales / pitch ---
  {
    name: 'sales',
    pattern: /(sell|sale|pitch|buy|purchase|offer|deal|close)/i,
    build: ({ domain }) => [
      {
        title: 'Identify Pain Point',
        body: `# IDENTIFY PAIN POINT
- Ask ONE diagnostic question before pitching.
- Tie the caller's pain to the product benefit they'd care about most.

Example response:
What's the biggest challenge you're facing with ${domain.toLowerCase()} right now?`,
      },
      {
        title: 'Present the Offer',
        body: `# PRESENT THE OFFER
- Lead with the outcome, not the feature list.
- Tie ONE top benefit to the pain they named.
- Share pricing only after building value.

Example response:
Based on what you mentioned, here's what would work best for you…`,
      },
      {
        title: 'Handle Objections',
        body: `# HANDLE OBJECTIONS
- Acknowledge the objection, restate it in your own words, then reframe.
- Never badmouth competitors.
- After handling, ask the buying question again.

Example response:
I hear you on the pricing — let me share how teams like yours typically see payback in the first month.`,
      },
    ],
  },

  // --- Negotiation / discount ---
  {
    name: 'negotiation',
    pattern: /(negotiate|discount|price|pricing|cost|rate|offer|quote|bargain|deal)/i,
    build: () => [
      {
        title: 'Pricing Discussion',
        body: `# PRICING DISCUSSION
- Present the listed price first.
- Explain the value before discussing discount.
- Only offer discounts within the authorised band.

Example response:
The listed price is {price}. Based on what you shared, here's what I can offer you today…`,
      },
      {
        title: 'Discount Policy & Escalation',
        body: `# DISCOUNT POLICY & ESCALATION
- Never go below the hard floor price.
- If the caller requests more than the authorised band, mark outcome = approval_required.
- Escalate to a sales lead; never commit what you cannot honour.

Example response:
Let me check with my sales lead on that — can I call you back within 2 hours?`,
      },
    ],
  },

  // --- Recruitment / hiring ---
  {
    name: 'recruitment',
    pattern: /(hire|hiring|recruit|interview|candidate|resume|job|position|role)/i,
    build: ({ business }) => [
      {
        title: 'Screen Experience & Skills',
        body: `# SCREEN EXPERIENCE & SKILLS
- Ask about total years of experience.
- Ask about core skills required for the role.
- Ask current location and willingness to relocate.

Example response:
Could you walk me through your most recent role for about a minute?`,
      },
      {
        title: 'Salary & Notice Period',
        body: `# SALARY & NOTICE PERIOD
- Ask about expected salary range.
- Ask about current notice period / earliest start date.
- Never commit a final offer on the call.

Example response:
What's your expected compensation range for this role?`,
      },
      {
        title: 'Schedule Interview',
        body: `# SCHEDULE INTERVIEW
- If the candidate is qualified, book the first interview slot.
- Confirm the slot and send confirmation.
- Notify the recruiter.

Example response:
You sound like a strong match — ${business} would love to chat. Does Wednesday at 3pm work?`,
      },
    ],
  },

  // --- Survey / feedback ---
  {
    name: 'survey',
    pattern: /(survey|feedback|rating|review|nps|csat|opinion)/i,
    build: () => [
      {
        title: 'Ask Permission',
        body: `# ASK PERMISSION
- Ask for 2 minutes before starting the survey.
- If declined, ask for a callback time and end politely.

Example response:
Would you have about 2 minutes to share some quick feedback?`,
      },
      {
        title: 'Run the Questions',
        body: `# RUN THE QUESTIONS
- Ask each question in order, ONE at a time.
- Wait for the answer before moving on.
- Never lead the witness — keep questions neutral.

Example response:
Great, thanks. First question — how would you rate your overall experience?`,
      },
      {
        title: 'Capture Rating',
        body: `# CAPTURE RATING
- Ask the final rating on the chosen scale (NPS 0-10 / stars / yes-no).
- Capture: answers (by question #), rating, sentiment, complaints, suggestions.

Example response:
Last one — on a scale of 0 to 10, how likely are you to recommend us?`,
      },
    ],
  },

  // --- Collections / overdue payment ---
  {
    name: 'collections',
    pattern: /(collect|overdue|payment|invoice|emi|loan|rent|due|bill|unpaid)/i,
    build: () => [
      {
        title: 'State the Amount Due',
        body: `# STATE THE AMOUNT DUE
- State the specific amount, invoice number, and days overdue.
- Use factual, non-accusatory language.
- Respect regulated fair-practice rules at all times.

Example response:
I'm calling about invoice {id} for {amount}, which is currently {days} days overdue.`,
      },
      {
        title: 'Get a Dated Commitment',
        body: `# GET A DATED COMMITMENT
- Ask when the payment will be made — always a specific date.
- Offer available payment channels.
- Never threaten or exaggerate consequences.

Example response:
When can we expect the payment? I can send a link right now if that helps.`,
      },
    ],
  },

  // --- Billing ---
  {
    name: 'billing',
    pattern: /(billing|invoice|refund|charge|subscription|plan|renewal)/i,
    build: () => [
      {
        title: 'Verify Account',
        body: `# VERIFY ACCOUNT
- Confirm the caller's registered email or account ID.
- Do NOT share billing details until verified.

Example response:
Could you confirm the email on the account so I can pull up the details?`,
      },
      {
        title: 'Resolve Billing Query',
        body: `# RESOLVE BILLING QUERY
- Explain the charge, refund timeline, or plan change clearly.
- If outside policy, escalate to a human.

Example response:
Here's what I see on your last invoice — shall I walk you through each line?`,
      },
    ],
  },

  // --- Recipes / cooking / food ---
  {
    name: 'cooking',
    pattern: /(recipe|cook|cooking|food|vegetable|fruit|ingredient|meal|dish|nutrition)/i,
    build: ({ domain }) => [
      {
        title: 'General Tips',
        body: `# GENERAL TIPS
- Offer simple cooking, storage, or usage tips for ${domain.toLowerCase()}.
- Keep tips practical and short.

Example response:
A good tip is to store ${domain.toLowerCase()} in a cool, dry place away from direct sunlight.`,
      },
    ],
  },
];

/** Always-present "provide info" section, themed by domain. */
function provideInfoSection(domain: string): Section {
  const d = domain.toLowerCase();
  const D = domain.toUpperCase();
  return {
    title: `Provide ${domain} Information`,
    body: `# PROVIDE ${D} INFORMATION
- Answer questions about ${d} using only what you know.
- If unsure, say so and offer to follow up.

Example response:
Here's what I can share about ${d} — want me to dig into a specific part?`,
  };
}

// -------------------- generator entry point --------------------

export function generateConversationFlow(input: ConversationFlowInput): string {
  const desc = (input.userDescription || '').trim();
  const agent = (input.agentName || 'the Assistant').trim() || 'the Assistant';
  const business = (input.businessName || 'the business').trim() || 'the business';
  const domain = detectDomain(desc || agent);

  const purposeLine = desc
    ? desc.split(/(?<=[.!?])\s+/)[0].slice(0, 280).replace(/[\s.]+$/, '') + '.'
    : `answer questions and help callers move forward.`;

  const sections: Section[] = [
    identitySection(agent, business, domain, purposeLine),
    understandIntentSection(domain),
    provideInfoSection(domain),
  ];

  // Fire any matching intent rules (order-preserving, deduped by name)
  const fired = new Set<string>();
  for (const rule of INTENT_RULES) {
    if (fired.has(rule.name)) continue;
    if (rule.pattern.test(desc)) {
      const built = rule.build({ domain, business, agent });
      built.forEach((s) => sections.push(s));
      fired.add(rule.name);
    }
  }

  // Closing set
  sections.push(outOfScopeSection());
  sections.push(closingSection(business));
  sections.push(knowledgeContextSection(domain, business));
  sections.push(faqSection(business, domain));

  // Serialise as `# N. Title\n\nbody\n\n` — matches what
  // ConversationFlowEditor parses into cards.
  return sections
    .map((s, i) => `# ${i + 1}. ${s.title}\n\n${s.body}`)
    .join('\n\n') + '\n';
}
