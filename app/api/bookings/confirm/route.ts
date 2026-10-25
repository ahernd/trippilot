// THE ONLY PLACE THAT WRITES BOOKINGS.
// It runs only when the user clicks the Confirm button.
// It never trusts prices or details sent by the browser. It reads them again from the database.
// The idempotency key makes a double click safe: the second click returns the first result.

import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('book'),
    kind: z.enum(['flight', 'hotel']),
    item_id: z.number(),
    check_in: z.string().optional(),
    nights: z.number().int().min(1).max(30).optional(),
    idempotency_key: z.string().min(10).max(100),
  }),
  z.object({
    action: z.literal('cancel'),
    booking_id: z.string().min(10).max(100),
    idempotency_key: z.string().min(10).max(100),
  }),
]);

// Moves seats or rooms by one. Returns false if it could not (sold out, or someone else changed it first).
async function adjustStock(table: 'flights' | 'hotels', id: number, delta: 1 | -1): Promise<boolean> {
  const db = supabaseAdmin();
  const col = table === 'flights' ? 'seats_left' : 'rooms_left';
  const { data } = await (db as any).from(table).select(col).eq('id', id).maybeSingle();
  if (!data) return false;
  const current: number = data[col];
  if (delta < 0 && current < 1) return false;
  const { data: updated } = await (db as any)
    .from(table)
    .update({ [col]: current + delta })
    .eq('id', id)
    .eq(col, current) // only if nobody changed it meanwhile
    .select('id');
  return !!updated?.length;
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ ok: false, error: 'Please log in.' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const input = parsed.data;
  const db = supabaseAdmin();

  // ---------- CANCEL ----------
  if (input.action === 'cancel') {
    const { data: b } = await db
      .from('bookings')
      .select('id, kind, item_id, status')
      .eq('id', input.booking_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!b) return Response.json({ ok: false, error: 'Booking not found.' }, { status: 404 });
    if (b.status === 'cancelled') {
      return Response.json({ ok: true, already: true, message: 'This booking was already cancelled.' });
    }
    const { error } = await db.from('bookings').update({ status: 'cancelled' }).eq('id', b.id).eq('user_id', user.id);
    if (error) return Response.json({ ok: false, error: 'Could not cancel. Try again.' }, { status: 500 });
    await adjustStock(b.kind === 'flight' ? 'flights' : 'hotels', b.item_id, 1);
    return Response.json({ ok: true, message: 'Booking cancelled.' });
  }

  // ---------- BOOK ----------
  const { data: existing } = await db
    .from('bookings')
    .select('id')
    .eq('idempotency_key', input.idempotency_key)
    .eq('user_id', user.id)
    .maybeSingle();
  if (existing) {
    return Response.json({ ok: true, already: true, booking_id: existing.id, message: 'Already confirmed.' });
  }

  let totalInr = 0;
  const details: Record<string, unknown> = {};
  if (input.kind === 'flight') {
    const { data: f } = await db.from('flights').select('price_inr, seats_left').eq('id', input.item_id).maybeSingle();
    if (!f) return Response.json({ ok: false, error: 'Flight not found.' }, { status: 404 });
    if (f.seats_left < 1) return Response.json({ ok: false, error: 'Sorry, that flight just sold out.' }, { status: 409 });
    totalInr = f.price_inr;
  } else {
    if (!input.check_in) return Response.json({ ok: false, error: 'Check-in date missing.' }, { status: 400 });
    const nights = input.nights ?? 1;
    const { data: h } = await db.from('hotels').select('price_per_night_inr, rooms_left').eq('id', input.item_id).maybeSingle();
    if (!h) return Response.json({ ok: false, error: 'Hotel not found.' }, { status: 404 });
    if (h.rooms_left < 1) return Response.json({ ok: false, error: 'Sorry, no rooms left.' }, { status: 409 });
    totalInr = h.price_per_night_inr * nights;
    details.check_in = input.check_in;
    details.nights = nights;
  }
  details.total_inr = totalInr;

  const { data: created, error: insertError } = await db
    .from('bookings')
    .insert({
      user_id: user.id,
      kind: input.kind,
      item_id: input.item_id,
      status: 'confirmed',
      idempotency_key: input.idempotency_key,
      details,
    })
    .select('id')
    .single();

  if (insertError) {
    // 23505 = the same key was inserted a moment ago (double click). Treat as success.
    if (insertError.code === '23505') {
      return Response.json({ ok: true, already: true, message: 'Already confirmed.' });
    }
    return Response.json({ ok: false, error: 'Could not save the booking. Try again.' }, { status: 500 });
  }

  const reserved = await adjustStock(input.kind === 'flight' ? 'flights' : 'hotels', input.item_id, -1);
  if (!reserved) {
    await db.from('bookings').delete().eq('id', created.id);
    return Response.json({ ok: false, error: 'Sorry, it sold out as you confirmed.' }, { status: 409 });
  }

  return Response.json({ ok: true, booking_id: created.id, total_inr: totalInr, message: 'Booking confirmed.' });
}
