# AfriVoice Studio

A voice-generation and speech-model benchmarking platform for African languages, built around the
**Sahara CodeSwitch Africa Challenge** and inspired by the **Intron AfriHealth MultiBench** project.

## Problem

Existing AI voice and speech benchmarks systematically underrepresent accented and multilingual speech
from Africa, including the speech patterns of clinicians and community health workers. AfriVoice Studio
gives organizations serving multilingual African communities (healthcare workers, educators, public
services) a practical tool to generate spoken audio in their audience's language, and gives researchers a
transparent way to compare how well different speech models actually perform on African languages.

## Solution

- **Voice Generator** — turn text into real synthesized speech in 8 languages (English, French, Chinese,
  Hindi, Spanish, Igbo, Hausa, Yoruba), with Hausa/Igbo/Yoruba treated as first-class languages with
  dedicated native voices, plus multi-language batch generation and side-by-side audio comparison.
- **Patient Voice Intake** — an open-ended spoken conversation with no language picker and no fixed
  script: the first turn's audio goes to Gemini for combined language identification + transcription
  (English, Nigerian Pidgin, Yoruba, Igbo, Hausa, or Fulfulde), then every turn's audio is also sent to
  every other configured ASR provider (Sahara, the two custom benchmark endpoints) for comparison. Each
  reply is generated live by Gemini as one more turn in the conversation — it asks about whatever it
  doesn't have yet (name, age/DOB, payment type, reason for visit, symptom duration, allergies), in
  whatever order feels natural, gently steering the caller back to health topics if the conversation
  drifts off-topic for a few minutes, and the mic re-activates automatically after every reply so the
  whole thing reads as one continuous call. Once Gemini signals the intake is actually complete, the
  record is shown as JSON and queued in a local "front desk" list, honestly flagged for manual review
  whenever fields are still missing or unclear.
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
| `SAHARA_TTS_API_KEY` | Intron Sahara native African TTS (Voice Generator) | Sahara option shows "not configured"; switch to Gemini or Device Speech instead. |
| `SAHARA_STT_API_KEY` | Intron Sahara as a real ASR provider in the Benchmark tab | Sahara is honestly reported as "not configured" and excluded from benchmark averages. These are separate keys — configuring one does not configure the other. |
| `MODEL_B_API_KEY` + `MODEL_B_API_URL` / `MODEL_C_API_KEY` + `MODEL_C_API_URL` | Bring-your-own real ASR endpoint for the Benchmark tab (no vendor assumed) | Reported as "not configured" and excluded from benchmark averages. |

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
  front end (e.g. Twilio, so a real phone call could drive the same intake pipeline) is a natural extension
  but is out of scope for the primary deliverable.
- Because Patient Intake is a genuine open-ended conversation, it spends one `gemini-3.8-flash` call per
  turn (plus one for language detection on the first turn) rather than the 2-3 calls a fixed-question flow
  would use — a single intake call can use up a meaningful share of that model's 20-requests/day free-tier
  cap. Enabling billing on the Gemini API key removes this ceiling.
