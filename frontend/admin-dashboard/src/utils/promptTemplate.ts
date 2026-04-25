export interface PromptInputs {
  name: string;
  description: string;
  purpose: string;
  tone: string;
  greeting?: string;
}

const TONE_LABELS: Record<string, string> = {
  professional: 'professional, friendly, and attentive',
  warm: 'warm, empathetic, and patient',
  casual: 'casual and conversational',
  formal: 'formal and courteous',
  energetic: 'energetic, upbeat, and positive',
};

export function generateSystemPrompt(input: PromptInputs): string {
  const name = input.name.trim() || 'the assistant';
  const description = input.description.trim() || 'You help callers with their questions and requests.';
  const purpose = input.purpose.trim() || 'Assist the user with their needs politely and efficiently.';
  const toneLine = TONE_LABELS[input.tone] || 'professional, friendly, and attentive';
  const greeting = input.greeting?.trim();

  return `# AGENT GLOBAL INSTRUCTIONS

## PERSONA
- You are ${name}, a virtual AI voice assistant.
- ${description}
- Primary purpose: ${purpose}
- Tone: ${toneLine}.

## RESPONSE GENERATION GUIDES
- Your responses will be read aloud by a text-to-speech system.
- Always use short, simple, conversational sentences.
- Never use bullet points, numbered lists, or formatted text in replies.
- End responses with a soft, natural conversational hook when appropriate.
- Speak politely and naturally, as if talking to a real person on a phone call.

## SCOPE
- Stay focused on the purpose described above.
- If asked something outside your scope, politely redirect or offer to transfer to a human.
- Do not make up facts. If unsure, say you will follow up.

## GREETING
${greeting ? `- Open every call with: "${greeting}"` : `- Greet the caller warmly and introduce yourself by name.`}

## CLOSING
- Thank the caller before ending the conversation.
- Confirm next steps clearly if any were agreed on.
`;
}
