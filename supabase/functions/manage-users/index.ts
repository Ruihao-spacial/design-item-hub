import { createClient } from 'npm:@supabase/supabase-js@2.115.0';

// The service key remains in the Edge Function environment, never in Vite/browser code.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Use POST.' });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return response(503, { error: 'User management is not configured.' });
    const authorization = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+$/i.test(authorization)) return response(401, { error: 'Sign in required.' });
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    if (authError || !authData.user) return response(401, { error: 'Sign in required.' });
    const { data: access, error: accessError } = await caller.from('user_access')
      .select('role,active').eq('user_id', authData.user.id).single();
    if (accessError || !access?.active || access.role !== 'admin') return response(403, { error: 'Administrator access required.' });

    // Bound the actual body, even when no Content-Length header was sent.
    const reader = request.body?.getReader();
    if (!reader) return response(400, { error: 'A JSON body is required.' });
    let bodyText = '';
    let size = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return response(413, { error: 'Request is too large.' }); }
      bodyText += decoder.decode(value, { stream: true });
    }
    bodyText += decoder.decode();
    let body: Record<string, unknown>;
    try { body = JSON.parse(bodyText); } catch { return response(400, { error: 'Invalid JSON.' }); }
    if (!body || Array.isArray(body) || typeof body !== 'object') return response(400, { error: 'Invalid request.' });

    if (body.action === 'list') {
      const page = body.page ?? 1;
      const perPage = body.perPage ?? 100;
      if (!Number.isInteger(page) || !Number.isInteger(perPage) || Number(page) < 1 || Number(page) > 100000 || Number(perPage) < 1 || Number(perPage) > 200) {
        return response(400, { error: 'Invalid pagination.' });
      }
      const { data, error } = await caller.rpc('admin_list_users', { page_number: page, page_size: perPage });
      if (error) return response(error.code === '42501' ? 403 : 500, { error: 'Unable to list users.' });
      const users = (data || []).map(({ total: _total, ...user }: Record<string, unknown>) => user);
      return response(200, { users, page, perPage, total: Number(data?.[0]?.total || 0) });
    }

    if (body.action === 'update_access') {
      if (typeof body.userId !== 'string' || !uuidPattern.test(body.userId)
        || typeof body.role !== 'string' || !['admin', 'member'].includes(body.role) || typeof body.active !== 'boolean'
        || (body.fullName !== undefined && (typeof body.fullName !== 'string' || !body.fullName.trim() || body.fullName.length > 200))) {
        return response(400, { error: 'Provide a valid user, role, active status, and name.' });
      }
      const { data, error } = await caller.rpc('admin_update_user', {
        target_user_id: body.userId, new_role: body.role, is_active: body.active,
        new_full_name: body.fullName ?? null,
      });
      if (error) {
        const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : 400;
        return response(status, { error: error.code === '23514' ? 'At least one active administrator is required.' : 'Unable to update this user.' });
      }
      return response(200, { user: Array.isArray(data) ? data[0] : data });
    }

    if (body.action === 'create') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
      const password = body.password;
      const role = body.role ?? 'member';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        || !fullName || fullName.length > 200 || typeof role !== 'string' || !['admin', 'member'].includes(role)
        || typeof password !== 'string' || password.length < 10 || password.length > 128
        || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return response(400, { error: 'Enter a valid email and name. Password must be 10–128 characters and include uppercase, lowercase, and a number.' });
      }
      const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      if (error || !data.user) return response(400, { error: 'Unable to create the account. The email may already be registered or the password may not meet requirements.' });
      // The trigger provisions inactive access. The caller-authenticated RPC rechecks
      // permissions and records the real administrator before activating the account.
      const { data: updated, error: setupError } = await caller.rpc('admin_update_user', {
        target_user_id: data.user.id, new_role: role, is_active: true, new_full_name: fullName,
      });
      if (setupError) return response(409, {
        error: 'The account was created but remains inactive. An active administrator can enable it from user management.',
        userId: data.user.id,
      });
      const updatedAccess = Array.isArray(updated) ? updated[0] : updated;
      return response(201, { user: {
        id: data.user.id, email: data.user.email, full_name: fullName,
        role: updatedAccess.role, active: updatedAccess.active, created_at: data.user.created_at, last_sign_in_at: null,
      } });
    }
    return response(400, { error: 'Unknown user management action.' });
  } catch {
    // Never echo or log request bodies, tokens, passwords, or service credentials.
    return response(500, { error: 'User management is temporarily unavailable.' });
  }
});
