import { supabase } from './supabaseClient.js';

const FUNCTION_NAME = 'manage-users';

async function invokeManageUsers(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action, ...payload },
  });

  if (error) {
    let serverMessage = '';
    if (error.context && typeof error.context.json === 'function') {
      try {
        const body = await error.context.json();
        serverMessage = body?.error || '';
      } catch {
        // Fall back to the client error when the response is not JSON.
      }
    }
    throw new Error(serverMessage || error.message || 'User management request failed.');
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function listManagedUsers() {
  const data = await invokeManageUsers('list');
  return Array.isArray(data) ? data : (data?.users || []);
}

export async function createManagedUser({ email, fullName, role, temporaryPassword }) {
  return invokeManageUsers('create', {
    email,
    fullName,
    role,
    password: temporaryPassword,
  });
}

export async function updateManagedUserRole(userId, role, active) {
  return invokeManageUsers('update_access', { userId, role, active });
}

export async function updateManagedUserStatus(userId, status, role) {
  return invokeManageUsers('update_access', { userId, role, active: status === 'active' });
}
