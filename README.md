# SabiLine

A voice-based patient intake assistant for African clinics — the primary deliverable, and what the site's
root URL shows by default. It's built on top of **AfriVoice Studio**, a voice-generation and speech-model
benchmarking platform for African languages developed around the **Sahara CodeSwitch Africa Challenge** and
inspired by the **Intron AfriHealth MultiBench** project; that broader studio (Voice Generator, Benchmark,
Code-Switching Explorer, Methodology/Ethics/Impact) still lives in the app and stays reachable by appending
`?studio=1` to the URL.

## Problem

Existing AI voice and speech benchmarks systematically underrepresent accented and multilingual speech
from Africa, including the speech patterns of clinicians and community health workers. AfriVoice Studio
gives organizations serving multilingual African communities (healthcare workers, educators, public
services) a practical tool to generate spoken audio in their audience's language, and gives researchers a
transparent way to compare how well different speech models actually perform on African languages.

## Solution

- **SabiLine Patient Voice Intake** (the default landing experience) — tap SPEAK and SabiLine greets the
  caller and takes it from there: an open-ended spoken conversation with no language picker and no fixed
  script. The very first turn's audio goes to Gemini for combined language identification + transcription
  (English, Nigerian Pidgin, Yoruba, Igbo, Hausa, or Fulfulde) — after that, every turn's audio is also sent
  to every other configured ASR provider (Sahara, the two custom benchmark endpoints) for comparison.
  Recording stops on its own once the caller has clearly spoken and gone quiet, rather than needing a second
  tap — an `AnalyserNode` reading of the live mic level, which also drives the wave animation around the
  SPEAK button. Callers who'd rather not talk can tap "Prefer to type instead of talk?" and type every turn
  instead; typed turns run through a lighter text-only Gemini call for language detection instead of the
  audio pipeline. Each reply is generated live by Gemini as one more turn in the conversation — it asks
  about whatever it doesn't have yet (name, age/DOB, phone number, payment type, reason for visit, symptom
  duration, allergies), in whatever order feels natural, gently steering the caller back to health topics if
  the conversation drifts off-topic for a few minutes. Once Gemini signals the intake is actually complete,
  it also picks a clinic department and proposes a near-future appointment slot (once a phone number is on
  file), and the record is saved to **My Visits**, a local per-browser visit history, honestly flagged for
  manual review whenever fields are still missing or unclear. Every structured field (name, age, symptoms,
  reason for visit, department, appointment) is recorded in English regardless of which of the five
  languages the conversation itself happened in — only `spokenReply`, the line actually spoken back to the
  patient, is allowed to be in their language — and the moment the intake is marked done, that English
  summary is pushed automatically to the person in charge via `STAFF_NOTIFY_WEBHOOK_URL` (a Slack/Teams/
  Discord/Zapier-compatible incoming webhook), honestly reporting "not configured" when unset. The same
  "done" moment also arms two automatic outbound Twilio reminder calls — one about 2 days before the
  confirmed appointment, one about 2 hours before — computed from a real ISO timestamp behind the scenes
  (see `src/services/reminder/reminderScheduler.ts`); each visit card still has a manual "Send reminder
  call" button as a guaranteed fallback, and both paths honestly report "not configured" when Twilio
  credentials aren't set rather than faking a call.
- **Voice Generator** (`?studio=1`) — turn text into real synthesized speech in 8 languages (English,
  French, Chinese, Hindi, Spanish, Igbo, Hausa, Yoruba), with Hausa/Igbo/Yoruba treated as first-class
  languages with dedicated native voices, plus multi-language batch generation and side-by-side audio
  comparison.
- **Speech Benchmark** — run Word Error Rate / Character Error Rate evaluation across three ASR model
  identities (Sahara, Model B, Model C) on a de-identified clinical audio sample set, with configurable
  text normalization and per-utterance error inspection.
- **Code-Switching Explorer** — detect and visualize intra-utterance language switches (e.g. English↔Hausa)
  common in real African clinical speech, with every label clearly marked as model-inferred, not ground truth.
- **Clinical QA Rubric** — evaluate a spoken-QA answer against the AfriHealth 9-dimension safety rubric
  (factuality, appropriateness, adequacy, clinical reasoning, uncertainty handling, empathy, local relevance,
  hallucination risk, harm assessment).
- **Methodology / Ethics / Impact** pages documenting how metrics are computed, what the platform will not
  claim (no medical diagnosis), and where the current dataset's coverage is limited.

## Target Users

Healthcare communication teams, community health programs, NGOs and public-service communicators who need
to produce spoken content in African languages, and researchers benchmarking speech models on African
language coverage.

## Architecture

- **Frontend:** Vue 3 (`<script setup>` SFCs) + Vite + TypeScript + Tailwind CSS v4, `lucide-vue-next` icons.
- **Backend:** Express (`server.ts`), bundled separately with esbuild for production. Vite runs in
  middleware mode in development so one process serves both the API and the SPA.
- **Speech synthesis:** Gemini's TTS model (server-side, via `@google/genai`) or Intron Sahara's API when
  configured; falls back to the browser's own Web Speech API with zero configuration.
- **Benchmark math:** pure TypeScript implementations of WER/CER (Wagner-Fischer edit distance) and
  BLEU/chrF, under `src/services/benchmark/`, covered by a Vitest suite.

```
src/
  components/     Reusable Vue components (player, modals, nav, diagnostics, error boundary)
  views/          One component per top-level tab
  services/
    tts/          Voice/provider catalog + healthcare text presets
    benchmark/    WER, CER, BLEU/chrF, normalization, code-switch heuristics, sample dataset
    intake/       Conversational intake engine (Gemini multi-turn reply, structured fields, scheduling)
    reminder/     Twilio outbound appointment reminder call
  types/          Shared TypeScript interfaces
  utils/          In-app diagnostics/error logging
    asr/          Live ASR provider registry + transcribeWithAllProviders (used by both Benchmark and Intake)
    audio/        Browser-only mic recording -> WAV encoder (Web Audio API)
    intake/       Patient intake types (structured fields, confidence threshold)
server.ts         Express API (TTS generation, translation, benchmark runner, QA evaluator, intake ASR + extraction)
```

## Setup

```bash
npm install
cp .env.example .env   # then fill in whichever keys you have
npm run dev             # http://localhost:3000
```

### Environment variables

| Variable | Required for | Behavior when unset |
|---|---|---|
| `GEMINI_API_KEY` | Gemini TTS, translation, QA judge, and the real Gemini ASR benchmark provider (also synthesizes the reference audio every benchmark run evaluates against) | Those features return an explicit "not configured" error; the rest of the app keeps working. |
| `SAHARA_API_KEY` | Intron Sahara native African TTS (Voice Generator) and as a real ASR provider in the Benchmark tab — one key powers both | Sahara options are honestly reported as "not configured" and excluded from benchmark averages; switch to Gemini or Device Speech in the Voice Generator instead. |
| `MODEL_B_API_KEY` + `MODEL_B_API_URL` / `MODEL_C_API_KEY` + `MODEL_C_API_URL` | Bring-your-own real ASR endpoint for the Benchmark tab (no vendor assumed) | Reported as "not configured" and excluded from benchmark averages. |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` | Placing the post-intake appointment reminder call | The "Send reminder call" button reports "not configured" instead of placing a call. |

No API key is ever sent to or read from the browser — all provider calls happen inside `server.ts`.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server (Express + Vite middleware) |
| `npm run build` | Type-check (`vue-tsc`), build the SPA, bundle the server for production |
| `npm start` | Run the production server from `dist/` |
| `npm run lint` | Type-check only |
| `npm test` | Run the Vitest suite |

## Testing

`npm test` runs unit tests for the benchmark math (WER, CER, BLEU, chrF, text normalization,
code-switch detection) and the diagnostics logger, including edge cases such as empty transcripts,
non-Error rejection values, and circular objects that can't be JSON-serialized.

## Privacy & Ethics

The bundled clinical audio sample set (`src/services/benchmark/sampleDataset.ts`) contains only
de-identified, consented reference transcripts with anonymized speaker IDs — no real patient data.
See the in-app **Ethics** and **Methodology** pages for the full privacy, consent, and limitations
statement, including the explicit acknowledgment that this tool does not provide medical diagnoses.

## Known limitations

- The "Live Benchmark" evaluates real ASR providers on real synthesized audio — no more simulated
  hypotheses — but it can only evaluate whichever providers actually have credentials configured. With
  only `GEMINI_API_KEY` set, Gemini is the sole model evaluated; the others are honestly reported as "not
  configured" rather than faked. See `src/services/asr/` to wire in real Sahara/Model B/Model C credentials.
- Reference audio for every benchmark run is synthesized via Gemini's TTS-preview model, which has its own
  separate free-tier quota (10 requests/day) distinct from Gemini's other quotas. Exhausting it blocks new
  benchmark runs until it resets, even if an ASR provider itself has quota to spare.
- Browser/device speech (`provider: "browser"`) plays once locally via the Web Speech API and cannot be
  saved as an audio file — the UI states this explicitly rather than showing a non-functional player.
- When Gemini's free-tier voice quota is exhausted, both the Voice Generator and Patient Intake flow
  automatically fall back to Device Web Speech and say so, rather than dead-ending on a raw API error.
  Benchmark reference audio is cached per (text, language) in-process to reduce how fast that same quota
  gets consumed by repeated benchmark runs.
- Patient Intake currently runs entirely in the browser tab (mic capture via `getUserMedia`). A telephony
  front end that drives the intake conversation itself over a real phone call (rather than just the
  reminder call described below) is a natural extension but is out of scope for the primary deliverable.
  Intron's own "Conversation Call" voicebot API is a plausible drop-in for that once a `workflow_id` of
  type `CONVERSATION` exists in Intron's dashboard — that setup is account-side and hasn't been done yet.
- The appointment reminder call (`src/services/reminder/twilioReminder.ts`, `/api/intake/remind`) is
  English-only: Twilio's built-in `<Say>` voice doesn't speak Hausa, Yoruba, Igbo, Fulfulde, or Nigerian
  Pidgin, so the reminder message is always read in English regardless of the language the intake itself
  was conducted in.
- The automatic 2-day/2-hour reminder calls (`src/services/reminder/reminderScheduler.ts`) use in-memory
  `setTimeout`s persisted to a local `data/scheduled-reminders.json` file so a normal `npm start` process
  restart can recover pending reminders. On a serverless deployment (e.g. Vercel) the process does not stay
  alive between requests, so a timer scheduled two days out will not reliably fire on its own — point an
  external cron (Vercel Cron, a scheduled GitHub Action, etc.) at `POST /api/intake/reminders/run-due` every
  10-15 minutes to sweep for anything due, or rely on the manual "Send reminder call" button, which always
  works regardless of deployment target.
- The person-in-charge notification (`src/services/notify/staffNotify.ts`, `STAFF_NOTIFY_WEBHOOK_URL`) is a
  generic incoming-webhook push (Slack/Teams/Discord/Zapier-shaped payload), not a dedicated email/SMS
  integration — wire the webhook URL to whatever channel staff actually monitor.
- Because Patient Intake is a genuine open-ended conversation, it spends one `gemini-3.8-flash` call per
  turn (plus one for language detection on the first turn) rather than the 2-3 calls a fixed-question flow
  would use — a single intake call can use up a meaningful share of that model's 20-requests/day free-tier
  cap. Enabling billing on the Gemini API key removes this ceiling.
- The auto-stop-on-silence recording (so the caller never has to tap twice) uses a fixed mic-level threshold
  tuned for a typical laptop/phone mic in a moderately quiet room — a very noisy environment can either cut
  a caller off early or (with the 20-second safety cap) delay the cutoff; "Prefer to type instead" always
  works regardless of ambient noise.
- Gemini occasionally returns a transient `503 UNAVAILABLE` ("model is currently experiencing high demand")
  that clears up within a second or two; every Gemini call in the intake flow retries that specific failure
  up to twice with a short backoff before giving up (`withGeminiRetry` in `src/services/tts/geminiClient.ts`)
  — a real quota exhaustion (`429`) is never retried, since retrying it wouldn't help. Every async route in
  `server.ts` is also wrapped so an unexpected failure anywhere still returns one honest JSON error instead
  of a hung or non-JSON response, and `vercel.json` sets `maxDuration: 30` on the serverless function so a
  slower Gemini round-trip (occasionally 10-15s end to end) isn't killed by the platform's shorter default.
