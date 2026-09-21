import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Packaging config for the downloadable SabiLine app.
 *
 * The shell loads the SAME Vite build the web deployment serves (`dist/`),
 * so there is one frontend codebase, not two. What differs is only where the
 * API lives: on the web it is same-origin, in here it is VITE_API_BASE_URL,
 * resolved by src/services/api/apiBase.ts.
 *
 * Build the native bundle with:
 *   VITE_API_BASE_URL=https://<your-deployment> npm run build:mobile
 */
const config: CapacitorConfig = {
  appId: 'io.sabiline.app',
  appName: 'SabiLine',
  webDir: 'dist',

  // Microphone capture is the whole app, and a WebView will not prompt for it
  // over an insecure origin. Both platforms are pinned to a secure scheme so
  // getUserMedia is available at all.
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },

  ios: {
    // Patients hand the device back and forth; a bounce at the scroll edge
    // reads as the page coming loose.
    scrollEnabled: true,
    contentInset: 'always',
  },

  android: {
    // Release builds only: debug keystores must never sign a build that
    // handles patient data.
    allowMixedContent: false,
  },
};

export default config;
