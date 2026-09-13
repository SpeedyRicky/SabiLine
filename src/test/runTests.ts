import { calculateWER } from '../services/benchmark/wer';
import { calculateCER } from '../services/benchmark/cer';
import { normalizeTranscript } from '../services/benchmark/normalization';
import { analyzeCodeSwitching } from '../services/benchmark/errorAnalysis';
import { calculateSentenceBLEU, calculateChrF } from '../services/benchmark/bleu';
import { LANGUAGES, LanguageCode } from '../types';
import { PROVIDER_CAPABILITIES, AVAILABLE_VOICES } from '../services/tts/voices';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`PASS: ${testName}`);
    passed++;
  } else {
    console.error(`FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failed++;
  }
}

console.log('=== RUNNING AFRI-VOICE STUDIO VERIFICATION TESTS ===\n');

// 1. Normalization Tests
const rawHausa = 'Kina bukatar... shan maganin iron, da folic acid!';
const normHausa = normalizeTranscript(rawHausa);
assert(normHausa === 'kina bukatar shan maganin iron da folic acid', 'Normalization strips punctuation and lowercases');

const rawYorubaDiacritics = 'Ẹ dín iyọ̀ kù';
const strippedDiacritics = normalizeTranscript(rawYorubaDiacritics, { stripDiacritics: true });
assert(!/[Ẹọ̀]/.test(strippedDiacritics), 'Normalization diacritic stripping works for orthographic ablation');

// 2. WER Tests
const ref = 'take two tablets daily after meal';
const hypExact = 'take two tablets daily after meal';
const werExact = calculateWER(ref, hypExact);
assert(werExact.wer === 0 && werExact.substitutions === 0, 'WER is 0 on identical transcripts');

const hypSub = 'take three tablets daily after meal';
const werSub = calculateWER(ref, hypSub);
assert(Math.abs(werSub.wer - 1 / 6) < 0.001 && werSub.substitutions === 1, 'WER detects single word substitution correctly');

const hypDel = 'take tablets daily after meal';
const werDel = calculateWER(ref, hypDel);
assert(werDel.deletions === 1, 'WER detects word deletion correctly');

const hypIns = 'please take two tablets daily after meal';
const werIns = calculateWER(ref, hypIns);
assert(werIns.insertions === 1, 'WER detects word insertion correctly');

// Edge cases
const emptyRefWer = calculateWER('', 'some words');
assert(emptyRefWer.wer === 1.0, 'WER handles empty reference gracefully');

const emptyHypWer = calculateWER('some words', '');
assert(emptyHypWer.deletions === 2, 'WER handles empty hypothesis gracefully');

// 3. CER Tests
const cerExact = calculateCER('abara', 'abara');
assert(cerExact.cer === 0, 'CER is 0 on identical character strings');

const cerSub = calculateCER('obara', 'abara');
assert(cerSub.substitutions === 1 && cerSub.cer === 0.2, 'CER accurately detects character substitution');

// 4. Code-Switching Analysis Tests
const codeSwitchText = 'The patient arrived yau da safe with severe zazzabi and headache';
const csResult = analyzeCodeSwitching(codeSwitchText, 'en');
assert(csResult.isCodeSwitched === true, 'Code-switching detector recognizes English-Hausa intra-utterance switch');
assert(csResult.transitionCount >= 2, 'Code-switching detects transitions');
assert(csResult.inferredNotice.includes('Model-inferred'), 'Inferred code-switch notice is clearly labeled per ethics specification');

// 5. BLEU & chrF Translation Metrics
const bleuRef = 'take your medication with clean water';
const bleuHyp = 'take your medication with clean water';
assert(calculateSentenceBLEU(bleuRef, bleuHyp) === 1.0, 'Sentence BLEU is 1.0 on exact match');

const chrfScore = calculateChrF('ogwu', 'ogwu');
assert(chrfScore === 1.0, 'chrF is 1.0 on exact match');

// 6. Language Catalog Validation
const requiredLanguages: LanguageCode[] = ['en', 'fr', 'zh', 'hi', 'es', 'ig', 'ha', 'yo'];
const languageCodes = LANGUAGES.map(l => l.code);
const allLangsPresent = requiredLanguages.every(code => languageCodes.includes(code));
assert(allLangsPresent, 'All 8 required languages (en, fr, zh, hi, es, ig, ha, yo) are registered');

const hausa = LANGUAGES.find(l => l.code === 'ha');
const igbo = LANGUAGES.find(l => l.code === 'ig');
const yoruba = LANGUAGES.find(l => l.code === 'yo');
assert(Boolean(hausa?.african && igbo?.african && yoruba?.african), 'Hausa, Igbo, and Yoruba are marked as first-class African languages');

// 7. Provider Capability & Voice Options
assert(PROVIDER_CAPABILITIES.sahara.supportedLanguages.includes('ha'), 'Sahara provider explicitly supports Hausa');
assert(PROVIDER_CAPABILITIES.sahara.supportedLanguages.includes('yo'), 'Sahara provider explicitly supports Yoruba');
assert(PROVIDER_CAPABILITIES.sahara.supportedLanguages.includes('ig'), 'Sahara provider explicitly supports Igbo');

const hausaVoices = AVAILABLE_VOICES.filter(v => v.language === 'ha');
const igboVoices = AVAILABLE_VOICES.filter(v => v.language === 'ig');
const yorubaVoices = AVAILABLE_VOICES.filter(v => v.language === 'yo');
assert(hausaVoices.length > 0 && igboVoices.length > 0 && yorubaVoices.length > 0, 'Native voice options exist for Hausa, Igbo, and Yoruba');

console.log(`\n=== TESTS COMPLETE: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
