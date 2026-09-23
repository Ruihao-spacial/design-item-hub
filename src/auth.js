import { supabase } from './supabaseClient.js';

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { success: false, error: error.message };
  return { success: true, user: data.user };
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(session, event));
  return () => data.subscription.unsubscribe();
}

export async function getCurrentProfile(userId) {
  const [profileResult, accessResult] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('id', userId).maybeSingle(),
    supabase.from('user_access').select('role, active').eq('user_id', userId).maybeSingle(),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (accessResult.error) throw accessResult.error;
  if (!accessResult.data) return null;
  return {
    id: userId,
    full_name: profileResult.data?.full_name || '',
    role: accessResult.data.role,
    active: accessResult.data.active,
  };
}
