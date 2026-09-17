import './styles.css';
import { initApp } from './app.js';
import { supabaseConfigError } from './supabaseClient.js';

const rootEl = document.getElementById('app');
if (supabaseConfigError) {
  rootEl.innerHTML = `<div class="login-page"><div class="login-card" role="alert"><img class="brand-logo" src="/assets/spacial-logo-blue.svg" alt="Spacial" /><img class="orbit-illustration" src="/assets/orbit-refined-main.png" alt="Orbit, Spacial assistant" /><h1>Configuration required</h1><p class="subtitle">${supabaseConfigError}</p></div></div>`;
} else {
  initApp(rootEl).catch((error) => {
    console.error('Application initialization failed:', error);
    rootEl.innerHTML = '<div class="login-page"><div class="login-card" role="alert"><img class="brand-logo" src="/assets/spacial-logo-blue.svg" alt="Spacial" /><img class="orbit-illustration" src="/assets/orbit-refined-main.png" alt="Orbit, Spacial assistant" /><h1>Unable to start</h1><p class="subtitle">Please refresh the page. If the problem continues, contact your administrator.</p></div></div>';
  });
}
