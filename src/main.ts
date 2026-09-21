import { createApp } from 'vue';
import App from './App.vue';
import './index.css';
import { logError } from './utils/diagnostics';

const app = createApp(App);

// Catch errors thrown inside component render/setup/lifecycle/event handlers.
app.config.errorHandler = (err, instance, info) => {
  logError(`vue:${info}`, err);
};

// Catch anything Vue's error handler cannot see: raw DOM listeners, timers, etc.
window.addEventListener('error', (event) => {
  logError('window:error', event.error ?? event.message);
});

// Catch unhandled promise rejections (failed fetches without a .catch, etc.)
window.addEventListener('unhandledrejection', (event) => {
  logError('window:unhandledrejection', event.reason);
});

app.mount('#root');
