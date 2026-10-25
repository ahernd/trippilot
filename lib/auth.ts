// Finds out who is calling an API route.
// The browser sends "Authorization: Bearer <login token>". We ask Supabase if it is real.

import { supabaseAdmin } from './supabase-admin';

export async function getUser(req: Request): Promise<{ id: string; email: string | undefined } | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}
