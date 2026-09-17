import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigError = (!url || !anonKey)
  ? 'This deployment is missing its Supabase connection. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild the app.'
  : null;

// A syntactically valid fallback keeps the app shell renderable so main.js can
// show a useful configuration error instead of crashing during module import.
export const supabase = createClient(
  url || 'http://127.0.0.1:54321',
  anonKey || 'missing-supabase-anon-key',
);
