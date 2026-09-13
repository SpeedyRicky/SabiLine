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
server.ts         Express API (TTS generation, translation, benchmark runner, QA evaluator)
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
| `GEMINI_API_KEY` | Gemini TTS, translation, QA judge | Those features return an explicit "not configured" error; the rest of the app keeps working. |
| `SAHARA_API_KEY` | Intron Sahara native African TTS | Sahara option shows "not configured"; switch to Gemini or Device Speech instead. |
| `MODEL_B_API_KEY` / `MODEL_C_API_KEY` | Reserved for wiring in real secondary ASR providers | Benchmark tab uses its built-in comparison identities. |

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

- The "Live Benchmark" ASR hypotheses are deterministic, calibrated simulations of model behavior (not
  live calls to three real ASR APIs), consistent with how this benchmark tab shipped from AI Studio. If you
  wire in real `MODEL_B_API_KEY` / `MODEL_C_API_KEY` providers, replace the simulation block in
  `server.ts`'s `/api/benchmark/run` handler with real calls.
- Browser/device speech (`provider: "browser"`) plays once locally via the Web Speech API and cannot be
  saved as an audio file — the UI states this explicitly rather than showing a non-functional player.
