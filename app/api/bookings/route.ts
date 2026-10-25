// Returns the logged-in user's bookings (for the "My bookings" list).

import { getUser } from '@/lib/auth';
import { listUserBookings } from '@/lib/bookings';

export async function GET(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Please log in.' }, { status: 401 });
  return Response.json({ bookings: await listUserBookings(user.id) });
}
