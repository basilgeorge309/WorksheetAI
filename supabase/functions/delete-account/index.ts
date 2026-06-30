// Scribbl — delete-account edge function (Deno).
//
// Verifies the caller's JWT, then permanently deletes the user: their Storage
// uploads, then the auth user itself (which cascades to profiles/worksheets/usage
// via ON DELETE CASCADE foreign keys). Requires the service role.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS: Record<string, string> = {
  // Mobile-only app (RN sends no Origin); allowlist a domain here if a web
  // client is ever added.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Validate the caller via an anon client that forwards their Authorization.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // 1. Remove the user's uploaded files (outputs cascade is N/A for storage, so
    // also sweep any outputs we can identify — uploads are the user-scoped ones).
    const { data: files } = await adminClient.storage
      .from('worksheets')
      .list(`uploads/${user.id}`);
    if (files && files.length > 0) {
      const paths = files.map((f) => `uploads/${user.id}/${f.name}`);
      await adminClient.storage.from('worksheets').remove(paths);
    }

    // 2. Delete the auth user — cascades to profiles/worksheets/usage via FKs.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteError) {
      return json({ success: false, error: deleteError.message }, 500);
    }

    return json({ success: true }, 200);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : 'Delete failed' }, 500);
  }
});
