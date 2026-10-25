// Reads a user's bookings with a readable title for each one.

import { supabaseAdmin } from './supabase-admin';

export type BookingRow = {
  id: string;
  kind: 'flight' | 'hotel';
  status: string;
  title: string;
  created_at: string;
};

export async function listUserBookings(userId: string): Promise<BookingRow[]> {
  const db = supabaseAdmin();
  const { data: bookings } = await db
    .from('bookings')
    .select('id, kind, item_id, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (!bookings || bookings.length === 0) return [];

  const flightIds = bookings.filter((b) => b.kind === 'flight').map((b) => b.item_id);
  const hotelIds = bookings.filter((b) => b.kind === 'hotel').map((b) => b.item_id);

  const [{ data: flights }, { data: hotels }] = await Promise.all([
    flightIds.length
      ? db.from('flights').select('id, airline, origin, destination, depart_at').in('id', flightIds)
      : Promise.resolve({ data: [] as any[] }),
    hotelIds.length
      ? db.from('hotels').select('id, name, city').in('id', hotelIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const when = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  });

  return bookings.map((b) => {
    let title = 'Booking';
    if (b.kind === 'flight') {
      const f = (flights ?? []).find((x: any) => x.id === b.item_id);
      if (f) title = `${f.airline}: ${f.origin} to ${f.destination}, departs ${when.format(new Date(f.depart_at))}`;
    } else {
      const h = (hotels ?? []).find((x: any) => x.id === b.item_id);
      if (h) title = `${h.name}, ${h.city}`;
    }
    return { id: b.id, kind: b.kind, status: b.status, title, created_at: b.created_at };
  });
}
