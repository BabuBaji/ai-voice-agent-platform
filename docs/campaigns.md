# Bulk Call Campaigns — Feature Documentation

Comprehensive reference for the `/campaigns` feature in the AI Voice Agent platform — how it works end-to-end, what powers it, and where every piece lives.

---

## 1. Purpose

`/campaigns` lets an operator dial a list of contacts in bulk using an AI agent, fully unattended:

- Upload a contact list (CSV or paste).
- Pick a deployed phone number + an AI agent.
- Configure concurrency, retries, calling-hours window, and (optionally) a scheduled start.
- Start the campaign — the platform places outbound calls one batch at a time, captures audio + transcript per contact, and surfaces a full per-contact analysis afterwards.

This is the "outbound dialer" half of the platform. The inbound half (a customer dialing into your number) reuses the same speech + AI pipeline.

---

## 2. Pages & user flow

The feature spans **three frontend routes**:

| Route | Component | Purpose |
|---|---|---|
| `/campaigns` | `CampaignsPage.tsx` | List + filters + bulk select + View button |
| `/campaigns/new` | `CampaignWizardPage.tsx` | 4-step creation wizard |
| `/campaigns/:id` | `CampaignDetailPage.tsx` | KPIs + expandable per-contact panel with recording / transcript / analysis |

### 2.1 List page (`/campaigns`)
- Real-time campaign list with rollup counts (`target_count`, `completed_count`, `failed_count`, `pending_count`, `in_progress_count`).
- Filters: free-text search, status (`DRAFT` · `SCHEDULED` · `RUNNING` · `WAITING` · `PAUSED` · `COMPLETED` · `FAILED` · `CANCELLED`), and bot (agent).
- Status pills follow an OmniDim-style palette.
- Explicit **View** button on each row + the row itself is clickable.
- A compact **Campaign data flow diagram** (`CampaignFlowCard.tsx`) sits between the header and the filters as an at-a-glance explainer.

### 2.2 Wizard (`/campaigns/new`)

Four steps, each validated before advancing:

| Step | What the user sets |
|---|---|
| 1 — Campaign & phone | Campaign name, phone number (must be **deployed** and **attached to an agent**), concurrency (1–10) |
| 2 — Upload contacts | CSV upload **or** paste; client-side preview; required column is `phone_number` (`phone`/`number`/`to` accepted); optional `name`; extra columns become per-target template variables |
| 3 — Campaign settings | Max attempts (1–5), retry delay (60–86 400 s), **calling-hours window** (timezone + start/end) and (optionally) **scheduled start** datetime |
| 4 — Review & create | Confirms everything; POSTs `campaigns` then bulk-uploads targets |

Created campaigns enter `DRAFT` status. To start, the operator either:
1. Clicks **Start** on the detail page, **or**
2. Sets `schedule_start_at` — the scheduler will auto-flip it to `RUNNING` at the chosen time.

### 2.3 Detail page (`/campaigns/:id`)

- Header shows status, from-number, provider, concurrency, **calling-hours window** (or `24×7 (no window set)`), plus the live "outside window — sleeping" indicator when `status='WAITING'`.
- **KPIs**: Total · Pending · In progress · Completed · Failed + a progress bar.
- **Add targets**: single number or paste/upload CSV after the fact.
- **Contacts list** (expandable accordion). Each row shows phone, status, outcome, attempts, last-attempt time, and a **View / Hide** toggle.
- Expanding a row lazy-loads a 3-column panel:

  | Left column | Right column (2/3 width) |
  |---|---|
  | 🎵 **Audio player** (stereo recording) | 💬 **Transcript** — alternating caller / agent bubbles, timestamped |
  | 📊 Call meta (duration · channel · language · start time) | |
  | 🔗 Open full call page link | |
  | ✨ **AI Analysis** — short + detailed summary, sentiment, interest, lead score, next action, topics, key points | |

- Auto-refresh every 5 s while `status ∈ {RUNNING, WAITING}`.

---

## 3. Architecture flow

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│ Wizard          │ ──▶ │ campaigns table  │ ──▶ │ schedule       │
│ /campaigns/new  │     │ + campaign_      │     │ auto-start     │
│ frontend        │     │ targets table    │     │ poller (15s)   │
└─────────────────┘     └──────────────────┘     └───────┬────────┘
                                                          │
                                                          ▼
                                                ┌────────────────────┐
                                                │  processCampaign   │
                                                │  (concurrency-     │
                                                │   aware dial loop) │
                                                └─────────┬──────────┘
                                                          │
                                                          ▼
                            ┌─────────────────────────────────────────────────┐
                            │ Telephony provider (Plivo / Twilio / Exotel)    │
                            │ Outbound dial via Call.create                   │
                            └─────────────────┬───────────────────────────────┘
                                              │
                                              ▼
                            ┌─────────────────────────────────────────────────┐
                            │ telephony-adapter :3002                         │
                            │ Plivo Stream WS → mulaw 8 kHz, bidirectional    │
                            └─────────────────┬───────────────────────────────┘
                                              │
                ┌─────────────────────────────┼─────────────────────────────┐
                ▼                             ▼                             ▼
       ┌────────────────┐           ┌────────────────┐            ┌───────────────┐
       │   STT routing  │           │   ai-runtime   │            │  TTS routing  │
       │   (per-lang)   │ ──text──▶ │     :8000      │ ──text──▶  │  (per-lang)   │
       └────────────────┘           │   LLM brain    │            └───────────────┘
                                    └───┬────────────┘
                                        │ tools / RAG
                                        ▼
                              ┌──────────────────────┐
                              │ ai-runtime tools     │
                              │ knowledge-service    │
                              │ tavily web search    │
                              └──────────────────────┘
                                              │
                                              ▼ (on call end)
                            ┌─────────────────────────────────────────────────┐
                            │ updateTargetFromCallEnd                         │
                            │ - flip campaign_targets row to COMPLETED/FAILED │
                            │ - kick processCampaign for next contact         │
                            └─────────────────┬───────────────────────────────┘
                                              │
                                              ▼
                            ┌─────────────────────────────────────────────────┐
                            │ conversation-service :3003                      │
                            │ - stereo WAV at logs/recordings/{callSid}.wav   │
                            │ - transcript in messages table                  │
                            │ - analyzer writes conversations.analysis JSONB  │
                            └─────────────────┬───────────────────────────────┘
                                              │
                                              ▼
                            ┌─────────────────────────────────────────────────┐
                            │ Detail page (lazy-load per contact)             │
                            │ - audio blob via /conversations/:id/recording   │
                            │ - transcript via /conversations/:id/messages    │
                            │ - analysis via /conversations/:id               │
                            └─────────────────────────────────────────────────┘
```

---

## 4. Technology stack

### 4.1 Frontend
| Concern | Library / approach |
|---|---|
| Framework | React + TypeScript + Vite |
| Routing | React Router v6 |
| Styling | Tailwind CSS (utility-first) |
| Icons | lucide-react |
| HTTP | Axios via shared `services/api.ts` (adds `x-tenant-id` + auth) |
| State | Local component state + light context for auth/features |

### 4.2 Backend (campaign-owning service)
| Concern | Library / approach |
|---|---|
| Runtime | Node.js 20 + TypeScript (`tsx` for dev) |
| Web framework | Express |
| Service | `services/telephony-adapter` (port 3002) |
| Logging | pino |
| WebSocket | `ws` (for Plivo Stream audio) |
| Provider SDKs | `plivo` (CJS), Twilio REST, Exotel REST |
| Database driver | `pg` (raw SQL, no ORM in this service) |

### 4.3 Database
- **PostgreSQL 15** (`va-postgres` container).
- DB: `conversation_db` (campaigns live here alongside `calls`, `conversations`, `messages`).
- Cross-database queries use a separate `pg.Pool` (e.g. tenant retention sweeper reads `identity_db`).

### 4.4 Infrastructure
| Concern | Component |
|---|---|
| Cache | Redis (queue-friendly, not currently load-bearing for campaigns) |
| Message bus | RabbitMQ (planned for cross-service events; campaigns currently use in-process scheduling) |
| Object store | MinIO (S3-compatible, used by knowledge-service) |
| Public tunnel | ngrok (so Plivo can reach `telephony-adapter` webhooks during dev) |

### 4.5 Telephony providers (outbound dial)
| Provider | Role | Notes |
|---|---|---|
| **Plivo** | Primary in India | KYC required for live calls; `<Stream>` XML for full-duplex audio |
| Twilio | International primary | Same Stream XML pattern, different SDK |
| Exotel | Indian fallback | Limited; mock-style integration today |
| Sandbox | In-app testing | No real PSTN — used for UI demos |

---

## 5. AI / LLM models

The campaign runner reuses the same speech + AI pipeline as inbound calls — picked per agent + per language at call time.

### 5.1 LLM (the "AI Brain")

Configured per agent in the wizard (`AgentWizardPage.tsx`). The agent stores `llm_provider` and `llm_model`; campaigns inherit them via the agent reference.

| Provider | Models exposed | Notes |
|---|---|---|
| **OpenAI** | `gpt-4o` · `gpt-4-turbo` · `gpt-3.5-turbo` | Used when key is present; fallback if 429 |
| **Anthropic** | `claude-sonnet-4-20250514` · `claude-3-5-haiku-20241022` | Tool-use + structured output |
| **Google Gemini** | `gemini-2.5-pro` · `gemini-2.5-flash` | Default; free tier caps at ~20 req/day on flash |
| **Sarvam-M** | `sarvam-m` via OpenAI-compatible `/v1/chat/completions` | Fallback for Indian-language calls and when others 429; strict user/assistant alternation; `<think>…</think>` blocks are stripped server-side |
| **Mock** | `mock-v1` | Demo mode, no API key needed |

**Fallback cascade** (live in `ai-runtime` + reused by the post-call analyzer):
1. Agent's configured provider (`/chat/simple`).
2. If that returns `mock: true` **or** the call is in an Indic language → Sarvam-M.
3. If both fail → keyword heuristic (only for the analyzer; not the live conversation).

### 5.2 STT (speech → text)

Picked inside `plivoAudioStream.ts onStart` based on the agent's language:

1. Indic language (`te`, `hi`, `ta`, `kn`, `ml`, `mr`, `bn`, `gu`, `pa`, `or`, `as`, `ur`, `ne`, `kok`) **and** Sarvam key present → **Sarvam saarika v2.5**.
2. Non-Deepgram language **and** Azure key present → **Azure Speech**.
3. Default → **Deepgram nova-2**.

All three stream partials at roughly 250 ms cadence.

### 5.3 TTS (text → speech)

Mirror of STT routing:
- Indic → **Sarvam bulbul v2**
- English / Hinglish → **Deepgram Aura** (low-latency, low-cost)
- Voice clones → **ElevenLabs** (where account allows; some library voices require a paid plan)

Output is mulaw 8 kHz back over the Plivo Stream.

### 5.4 Post-call analysis

After each call ends, `conversation-service/src/services/analyzer.ts` runs `analyzeConversation`:
1. POST to `ai-runtime /chat/analyze` with the full transcript and a rich `CALL_RESULT` prompt.
2. If the response looks heuristic (missing `short_summary` / `lead_score`) **and** Sarvam key is set → retry via Sarvam-M.
3. Falls back to keyword heuristic if both fail.

The resulting JSONB is written to `conversations.analysis`. Fields include:

```jsonc
{
  "short_summary": "…",
  "detailed_summary": "…",
  "sentiment": "POSITIVE | NEGATIVE | NEUTRAL | MIXED",
  "interest_level": 7,
  "lead_score": 82,
  "conversion_probability": 0.41,
  "next_best_action": "Schedule a follow-up demo",
  "objections": [...],
  "key_entities": [...],
  "topics": [...],
  "key_points": [...],
  "follow_up_required": true,
  "qa_score": 78,
  "agent_performance_notes": "…",
  "quality_risks": [...],
  "conversation_quality": {
    "customer": { "understanding": "...", "engagement": "...", "emotion": "...", "frustration": "...", "tone": "...", "pacing": "...", "pitch_impression": "...", "notes": "..." },
    "agent":    { /* same shape */ },
    "overall_note": "…"
  }
}
```

The detail page renders the most-useful subset (summary / sentiment / interest / lead score / next action / topics / key points).

### 5.5 Live web grounding

The AI Brain can call a `web_search` tool backed by **Tavily** for trending / news questions, when wired on the agent. This is reused unchanged from the inbound pipeline.

---

## 6. Data model

### 6.1 `campaigns` (in `conversation_db`)

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `tenant_id` | UUID | Required, indexed |
| `agent_id` | UUID | Required; agent must be `PUBLISHED` to dial |
| `name` | VARCHAR(255) | |
| `description` | TEXT | |
| `from_number` | VARCHAR(20) | E.164; must be **deployed** in `phone_numbers` |
| `provider` | VARCHAR(20) | `plivo` (default) / `twilio` / `exotel` / `sandbox` |
| `concurrency` | INTEGER | Default 1, clamped 1–10 |
| `max_attempts` | INTEGER | Default 1, clamped 1–5 |
| `retry_delay_seconds` | INTEGER | Default 900, clamped 60–86 400 |
| `status` | VARCHAR(20) | `DRAFT` · `SCHEDULED` · `RUNNING` · `WAITING` · `PAUSED` · `COMPLETED` · `FAILED` |
| `schedule_start_at` | TIMESTAMPTZ | When auto-start should fire |
| **`timezone`** | VARCHAR(64) | IANA, default `Asia/Kolkata` |
| **`call_window_start`** | VARCHAR(5) | `HH:MM` 24h, nullable |
| **`call_window_end`** | VARCHAR(5) | `HH:MM` 24h, nullable |
| `last_run_at` | TIMESTAMPTZ | |
| `total_targets` / `completed_targets` / `failed_targets` | INTEGER | Cached counters |
| `metadata` | JSONB | Free-form (e.g. `{ failure_reason: 'agent_not_deployed' }`) |
| `created_by` | UUID | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Bold rows were added by this build. Both bare columns and the alter migrations are in `services/telephony-adapter/src/db/init.ts`.

### 6.2 `campaign_targets`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `campaign_id` | UUID FK | `ON DELETE CASCADE` |
| `phone_number` | VARCHAR(20) | E.164 |
| `name` | VARCHAR(255) | Optional |
| `variables` | JSONB | Per-target template vars (any extra CSV columns) |
| `attempts` | INTEGER | Incremented before each dial |
| `last_attempt_at` | TIMESTAMPTZ | |
| `next_attempt_after` | TIMESTAMPTZ | Set when retrying |
| `status` | VARCHAR(20) | `PENDING` · `IN_PROGRESS` · `COMPLETED` · `FAILED` |
| `outcome` | VARCHAR(50) | `answered` / `failed` / `cancelled` |
| `provider_call_sid` | VARCHAR(255) | Unique anchor to the `calls` row |
| `conversation_id` | UUID | Set on call-end; links to `conversations` |
| `last_error` | TEXT | Truncated to 500 chars |
| `created_at` | TIMESTAMPTZ | |

### 6.3 Related tables (already-existing, reused)

- **`calls`** — one row per dial, written when the provider returns a SID. Fields: `direction='OUTBOUND'`, `status`, `outcome`, `caller_number`, `called_number`, `provider`, `provider_call_sid` (unique), `metadata` (`{campaign_id, target_id, target_name, vars}`), `recording_url`.
- **`conversations`** — owned by `conversation-service`. Holds `recording_url`, `summary`, `sentiment`, `analysis` (JSONB), `duration_seconds`.
- **`messages`** — full transcript, alternating `user` / `assistant` roles.
- **`phone_numbers`** — `deployment_status='deployed'` required to be a valid `from_number`.

---

## 7. REST API

All routes live on `telephony-adapter` (`/api/v1/campaigns…`) and require the `x-tenant-id` header.

| Method & path | Body / params | Returns |
|---|---|---|
| `GET    /campaigns` | — | `{ data: Campaign[] }` with rollup counts |
| `POST   /campaigns` | `{ name, agent_id, from_number, provider?, concurrency?, max_attempts?, retry_delay_seconds?, schedule_start_at?, timezone?, call_window_start?, call_window_end? }` | created `Campaign` (status=`DRAFT`) |
| `GET    /campaigns/:id` | — | `Campaign` with counts |
| `DELETE /campaigns/:id` | — | 204 |
| `POST   /campaigns/:id/targets` | JSON `{phone_number, name?, variables?}` **or** `Content-Type: text/csv` body | `{ added, skipped }` |
| `GET    /campaigns/:id/targets` | — | `CampaignTarget[]` (limit 2000) |
| `POST   /campaigns/:id/start` | — | flips to `RUNNING` + kicks the runner |
| `POST   /campaigns/:id/pause` | — | flips to `PAUSED` |

Validation highlights on POST:
- `name`, `agent_id`, `from_number` required.
- Timezone validated via `Intl.DateTimeFormat` — unknown zones return **400**.
- `call_window_start` / `call_window_end` must be `HH:MM` 24-hour; both required if either is set.

---

## 8. Lifecycle & state machine

```
                            ┌──────────────────────────────────────────────┐
                            ▼                                              │
   ┌─────────┐ schedule_start ┌──────────┐  auto-start  ┌──────────┐ done  │
   │  DRAFT  │ ──────────────▶│SCHEDULED │ ───────────▶ │ RUNNING  │ ──────┘
   └────┬────┘                └──────────┘              └──────────┘
        │                                                    │
        │ Start (manual)                                     │ pause
        └────────────────────────────────────────────────────▶
                                                             │
                                                       outside calling-hours
                                                             │
                                                             ▼
                                                       ┌──────────┐
                                                       │ WAITING  │  (auto-resumes when window re-opens)
                                                       └────┬─────┘
                                                            │
                                                            ▼
                                                       ┌──────────┐
                                                       │ RUNNING  │
                                                       └────┬─────┘
                                                            │ no pending+in_progress left
                                                            ▼
                                                       ┌──────────┐
                                                       │ COMPLETED│
                                                       └──────────┘
```

- `RUNNING` ↔ `WAITING` is automatic — driven by the calling-hours gate inside `processCampaign`.
- `PAUSED` is operator-only (the runner refuses to dial when paused).
- `FAILED` is set when the agent isn't deployed and `BYPASS_PUBLISH_GATE` is not enabled.

---

## 9. The runner — `processCampaign(campaignId)`

Lives in `services/telephony-adapter/src/routes/campaigns.ts`. On each tick it:

1. **Loads campaign**. Returns early if not `RUNNING`/`WAITING`.
2. **Finalize check**: if zero `PENDING`+`IN_PROGRESS` targets, flip to `COMPLETED` and exit.
3. **Calling-hours gate**: evaluate the current time in the campaign's IANA timezone vs. window. If outside → flip to `WAITING` and `setTimeout` until window re-opens (capped at 10 min so restart-edits aren't stranded). If inside and was WAITING → flip back to `RUNNING`.
4. **Concurrency check**: count `IN_PROGRESS` rows; only dispatch up to `concurrency − in_flight`.
5. **Eligible targets**: pull `PENDING` rows where `next_attempt_after IS NULL OR next_attempt_after <= NOW()`, ordered oldest-first.
6. **Deploy gate**: fetch agent from `agent-service`; if status `DRAFT`/`ARCHIVED` and `BYPASS_PUBLISH_GATE !== 'true'` → mark campaign `FAILED` with `metadata.failure_reason='agent_not_deployed'`.
7. **Dispatch dial** for each eligible target in parallel:
   - Mark target `IN_PROGRESS`, increment `attempts`.
   - Call `provider.initiateCall({ from, to, agentId, tenantId, voicemailDetection })`.
   - Insert a `calls` row with `direction='OUTBOUND'`, `metadata={campaign_id, target_id, target_name, vars}`.
   - Record `provider_call_sid` on the target.
   - On error: if `attempts >= max_attempts` → `FAILED` else schedule retry (`next_attempt_after = NOW() + retry_delay_seconds`).
8. **Reloop** with `setTimeout(processCampaign, 5000)`.

### `updateTargetFromCallEnd(providerCallSid, outcome, conversationId)`
Called from the call-end webhook. Flips target to `COMPLETED` (if `answered`) or schedules retry / marks `FAILED`. Kicks `processCampaign` so the next contact dials immediately.

### `startCampaignScheduler()`
Periodic poller (15 s tick) that finds `DRAFT`/`SCHEDULED` rows with `schedule_start_at <= NOW()`, flips them to `RUNNING`, and kicks the runner. Started in `services/telephony-adapter/src/index.ts` after `server.listen`.

---

## 10. Calling-hours window + timezone

- Three columns on `campaigns`: `timezone` (default `Asia/Kolkata`), `call_window_start`, `call_window_end` (`HH:MM` 24h).
- Window is evaluated inside the runner via `evaluateCallWindow(campaign)` which:
  - Uses `Intl.DateTimeFormat` with the campaign's IANA timezone to read current wall-clock hour:minute.
  - Handles same-day windows (e.g. `09:00–21:00`) and **night-spanning** windows (e.g. `22:00–06:00`).
  - Returns `{open, msUntilOpen}`.
- Outside the window the campaign sits in `WAITING` and **does not** consume dial slots.
- Frontend wizard exposes a short IANA dropdown plus 24-hour `<input type="time">` pickers, plus a "Restrict to calling hours" toggle (defaults to `09:00–21:00 Asia/Kolkata`).
- The `datetime-local` field for `schedule_start_at` is converted from the user's wall-clock to a TZ-anchored ISO string via `localToTzIso()` in the wizard, so "4:10 PM" really means 4:10 PM in the chosen tz — not UTC.

---

## 11. Per-contact assets after a call

The detail page's expandable contact panel lazy-fetches three artifacts per contact:

| Artifact | Source endpoint | Underlying storage |
|---|---|---|
| **Recording** | `GET /conversations/:id/recording` (returns blob) | `services/telephony-adapter/logs/recordings/{callSid}.wav` (stereo: L=caller / R=agent), served back through ngrok in `conversations.recording_url` |
| **Transcript** | `GET /conversations/:id/messages` | `messages` table — `role ∈ {user, assistant, system, tool}`, content, `audio_url`, `latency_ms`, `tokens_used`, `created_at` |
| **AI analysis** | `GET /conversations/:id` (analysis is in the conversation row) | `conversations.analysis` JSONB (see §5.4) |

The "View full call page" link still works — it routes to `/calls/:conversationId` which is the existing standalone call view (Whisper / Sarvam re-transcribe, voice-quality metrics, etc.).

---

## 12. Error handling & edge cases

| Situation | Behaviour |
|---|---|
| `from_number` not deployed | Wizard refuses to advance from step 1 |
| Agent in `DRAFT` / `ARCHIVED` at start time | Campaign goes `FAILED` with `metadata.failure_reason='agent_not_deployed'` (override with `BYPASS_PUBLISH_GATE=true`) |
| Phone number compliance pending at carrier | Plivo may reject dial; reflected in `campaign_targets.last_error` and retried per `max_attempts` |
| Caller didn't answer / busy / hung up | `outcome='failed'`, `duration_seconds=0`; counted as a failed dial; retries if attempts remain |
| Call window edited mid-campaign | Next tick re-evaluates; campaign smoothly shifts between `RUNNING` and `WAITING` |
| Telephony-adapter restart | Scheduler resumes on boot; overdue `SCHEDULED` rows auto-start on first tick |
| Recording / transcript / analysis missing | Detail-page panel shows a graceful empty state explaining why |
| Cross-DST timezone | Validated via `Intl.DateTimeFormat`; offset is recomputed on each dial tick (so DST shifts auto-apply) |

---

## 13. File reference

### Frontend
- `frontend/admin-dashboard/src/pages/campaigns/CampaignsPage.tsx` — list + filters + View button + the embedded `CampaignFlowCard`
- `frontend/admin-dashboard/src/pages/campaigns/CampaignWizardPage.tsx` — 4-step wizard, calling-hours card, schedule helpers
- `frontend/admin-dashboard/src/pages/campaigns/CampaignDetailPage.tsx` — KPIs, accordion contacts, `TargetCallPanel` (recording + transcript + analysis)
- `frontend/admin-dashboard/src/components/campaigns/CampaignFlowCard.tsx` — 5-stage data-flow explainer for the list page
- `frontend/admin-dashboard/src/components/agent-builder/ArchitectureFlowCard.tsx` — sibling explainer for the agent wizard
- `frontend/admin-dashboard/src/services/campaign.api.ts` — Axios client + TypeScript types (`Campaign`, `CampaignTarget`)
- `frontend/admin-dashboard/src/services/conversation.api.ts` — reused for recording / transcript / analysis loads

### Backend
- `services/telephony-adapter/src/routes/campaigns.ts` — REST handlers, `processCampaign`, `evaluateCallWindow`, `updateTargetFromCallEnd`, `startCampaignScheduler`
- `services/telephony-adapter/src/db/init.ts` — `campaigns` + `campaign_targets` schemas + window-column ALTERs
- `services/telephony-adapter/src/index.ts` — wires `startCampaignScheduler()` after `server.listen`
- `services/telephony-adapter/src/app.ts` — mounts router at `/api/v1/campaigns` + special-cases `Content-Type: text/csv`
- `services/telephony-adapter/src/providers/` — `plivo`, `twilio`, `exotel`, `sandbox` implementations of `initiateCall`
- `services/conversation-service/src/services/analyzer.ts` — runs `/chat/analyze` and writes `conversations.analysis`
- `services/ai-runtime` (Python, port 8000) — LLM provider routing + Sarvam-M fallback
- `services/conversation-service/src/routes/conversations.ts` — exposes recording / messages / analysis endpoints used by the detail page

---

## 14. Environment & secrets

Keys are loaded by every Node service via `npx tsx --env-file=…/.env`. Campaigns need at least:

| Variable | Used for |
|---|---|
| `DATABASE_URL` | `conversation_db` connection |
| `AGENT_SERVICE_URL` | Deploy-gate lookup |
| `PUBLIC_BASE_URL` | Plivo answer_url + webhook callback |
| `PLIVO_AUTH_ID` / `PLIVO_AUTH_TOKEN` | Outbound dial |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Outbound dial (if `provider='twilio'`) |
| `DEEPGRAM_API_KEY` | English STT/TTS |
| `SARVAM_API_KEY` | Indic STT/TTS + LLM fallback |
| `ELEVENLABS_API_KEY` | Voice cloning |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` | LLM Brain |
| `TAVILY_API_KEY` | Live web-search tool |
| `BYPASS_PUBLISH_GATE` | (Dev only) allow dialing a DRAFT agent |

---

## 15. Known limitations / next gaps

- **No DND / blocklist** — uploaded numbers aren't cross-checked against a tenant-wide do-not-call list.
- **No persistent contact library** — each campaign owns its own CSV; segments aren't reusable.
- **Single-process runner** — `processCampaign` runs in-process inside `telephony-adapter`. Horizontal scaling will need a Redis lock or queue worker.
- **Analytics are basic** — counts + per-target outcomes only. No per-hour throughput chart, answer-rate %, average duration, or breakdown by hang-up reason yet.
- **No campaign cloning** — copy of an existing campaign with fresh targets isn't a one-click flow.

---

*Last updated: 2026-05-11*
