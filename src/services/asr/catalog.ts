// Pure data, safe to import from client code. The server has its own
// registry (src/services/asr/registry.ts) with the actual provider
// implementations — this is just display metadata for the UI.
export interface AsrModelCatalogEntry {
  id: string;
  displayName: string;
  architecture: string;
}

export const ASR_MODEL_CATALOG: AsrModelCatalogEntry[] = [
  { id: 'openai', displayName: 'OpenAI', architecture: 'Whisper audio-to-text' },
  { id: 'sahara', displayName: 'Intron Sahara', architecture: 'African-Acoustic Tuned CTC/Conformer' },
  { id: 'model_b', displayName: 'Model B', architecture: 'Custom endpoint (bring your own)' },
  { id: 'model_c', displayName: 'Model C', architecture: 'Custom endpoint (bring your own)' },
];

export function catalogLabel(modelId: string): string {
  return ASR_MODEL_CATALOG.find((m) => m.id === modelId)?.displayName ?? modelId;
}
