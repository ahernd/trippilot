// The 7 tools the agent can use.
//
// Rules that keep the agent honest:
// 1. Every tool returns { ok: true, ... } or { ok: false, error }. It never throws.
// 2. propose_* tools NEVER write to the database. Only the Confirm button does.
// 3. The agent may only state facts that a tool returned.

import { tool } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabase-admin';
import { embed } from './embed';
import { CITIES, MAX_RESULTS, POLICY_MIN_SIMILARITY } from './config';

// ---------- small helpers ----------

type Fail = { ok: false; error: string };
const fail = (error: string): Fail => ({ ok: false, error });

const IST = 'Asia/Kolkata';
const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const toIST = (iso: string) => timeFmt.format(new Date(iso));

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

// "pune" -> "Pune". Returns null if the city is not in our data.
function cleanCity(input: string): string | null {
  const wanted = input.trim().toLowerCase();
  return Object.keys(CITIES).find((c) => c.toLowerCase() === wanted) ?? null;
}
const cityList = Object.keys(CITIES).join(', ');

async function getJsonWithRetry(url: string): Promise<any> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

const WEATHER_TEXT: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

// ---------- tool logic (plain functions, easy to test) ----------

export async function searchFlights(args: { origin: string; destination: string; date: string; max_price_inr?: number }) {
  const origin = cleanCity(args.origin);
  const destination = cleanCity(args.destination);
  if (!origin) return fail(`We do not serve "${args.origin}". Cities: ${cityList}.`);
  if (!destination) return fail(`We do not serve "${args.destination}". Cities: ${cityList}.`);
  if (origin === destination) return fail('Origin and destination are the same city.');

  const start = new Date(`${args.date}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) return fail('Date must look like 2026-10-30.');
  const end = new Date(start.getTime() + 24 * 3600_000);

  let q = supabaseAdmin()
    .from('flights')
    .select('id, airline, depart_at, arrive_at, price_inr, seats_left')
    .eq('origin', origin)
    .eq('destination', destination)
    .gte('depart_at', start.toISOString())
    .lt('depart_at', end.toISOString())
    .gt('seats_left', 0)
    .order('price_inr', { ascending: true })
    .limit(MAX_RESULTS);
  if (args.max_price_inr) q = q.lte('price_inr', args.max_price_inr);

  const { data, error } = await q;
  if (error) return fail(`Flight search failed: ${error.message}`);

  return {
    ok: true as const,
    origin,
    destination,
    date: args.date,
    flights: (data ?? []).map((f) => ({
      id: f.id,
      airline: f.airline,
      departs: toIST(f.depart_at),
      arrives: toIST(f.arrive_at),
      price_inr: f.price_inr,
      seats_left: f.seats_left,
    })),
    note: (data ?? []).length === 0 ? 'No flights found. Data covers only the next 15 days.' : undefined,
  };
}

export async function searchHotels(args: { city: string; max_price_per_night_inr?: number }) {
  const city = cleanCity(args.city);
  if (!city) return fail(`We do not serve "${args.city}". Cities: ${cityList}.`);

  let q = supabaseAdmin()
    .from('hotels')
    .select('id, name, price_per_night_inr, rating, rooms_left')
    .eq('city', city)
    .gt('rooms_left', 0)
    .order('price_per_night_inr', { ascending: true })
    .limit(MAX_RESULTS);
  if (args.max_price_per_night_inr) q = q.lte('price_per_night_inr', args.max_price_per_night_inr);

  const { data, error } = await q;
  if (error) return fail(`Hotel search failed: ${error.message}`);
  return { ok: true as const, city, hotels: data ?? [] };
}

export async function getWeather(args: { city: string; date?: string }) {
  const city = cleanCity(args.city);
  if (!city) return fail(`We do not serve "${args.city}". Cities: ${cityList}.`);
  const date = args.date ?? todayIST();
  const { lat, lon } = CITIES[city];

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Asia%2FKolkata&forecast_days=16`;

  try {
    const data = await getJsonWithRetry(url);
    const i = data.daily.time.indexOf(date);
    if (i === -1) return fail(`No forecast for ${date}. Forecasts cover today and the next 15 days.`);
    return {
      ok: true as const,
      city,
      date,
      summary: WEATHER_TEXT[data.daily.weather_code[i]] ?? 'mixed conditions',
      max_c: data.daily.temperature_2m_max[i],
      min_c: data.daily.temperature_2m_min[i],
      rain_chance_percent: data.daily.precipitation_probability_max[i],
      source: 'Open-Meteo (live)',
    };
  } catch (e) {
    return fail(`Weather service did not respond: ${(e as Error).message}`);
  }
}

export async function searchPolicy(args: { question: string }) {
  try {
    const query_embedding = await embed(args.question, 'query');
    const { data, error } = await supabaseAdmin().rpc('match_policies', {
      query_embedding,
      match_count: 3,
    });
    if (error) return fail(`Policy search failed: ${error.message}`);

    const hits = (data ?? []).filter((r: any) => r.similarity >= POLICY_MIN_SIMILARITY);
    if (hits.length === 0) {
      return { ok: true as const, policies: [], note: 'No matching policy found. Do not guess a rule.' };
    }
    return {
      ok: true as const,
      policies: hits.map((r: any) => ({
        title: r.title,
        content: r.content,
        score: Number(r.similarity.toFixed(3)),
      })),
    };
  } catch (e) {
    return fail(`Policy search failed: ${(e as Error).message}`);
  }
}

// Booking status is simulated for the demo. The same booking always gets the same answer.
export async function getBookingStatus(userId: string, args: { booking_id: string }) {
  const { data: booking, error } = await supabaseAdmin()
    .from('bookings')
    .select('id, kind, item_id, status')
    .eq('id', args.booking_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return fail(`Could not read booking: ${error.message}`);
  if (!booking) return fail('No booking with that id was found for this user.');
  if (booking.kind !== 'flight') return fail('Live status is only available for flight bookings.');

  const { data: flight } = await supabaseAdmin()
    .from('flights')
    .select('origin, destination, depart_at')
    .eq('id', booking.item_id)
    .maybeSingle();
  if (!flight) return fail('The flight for this booking could not be found.');

  const roll = booking.id.charCodeAt(0) % 4; // same booking, same result
  const live =
    roll === 0 ? { state: 'delayed', detail: 'Delayed by 45 minutes' }
    : roll === 1 ? { state: 'gate_changed', detail: 'Gate changed to B12' }
    : { state: 'on_time', detail: 'On time' };

  return {
    ok: true as const,
    booking_id: booking.id,
    route: `${flight.origin} to ${flight.destination}`,
    scheduled_departure: toIST(flight.depart_at),
    ...live,
    note: 'Status is simulated demo data.',
  };
}

// Prepares a booking. Writes NOTHING. The user must click Confirm in the app.
export async function proposeBooking(args: { kind: 'flight' | 'hotel'; item_id: number; check_in?: string; nights?: number }) {
  const db = supabaseAdmin();

  if (args.kind === 'flight') {
    const { data: f } = await db.from('flights').select('*').eq('id', args.item_id).maybeSingle();
    if (!f) return fail('That flight id does not exist. Search again and use an id from the results.');
    if (f.seats_left < 1) return fail('That flight is sold out.');
    return {
      ok: true as const,
      needs_confirmation: true as const,
      proposal: {
        action: 'book' as const,
        kind: 'flight' as const,
        item_id: f.id as number,
        title: `${f.airline}: ${f.origin} to ${f.destination}`,
        when: `Departs ${toIST(f.depart_at)}`,
        total_inr: f.price_inr as number,
        idempotency_key: randomUUID(),
      },
    };
  }

  const nights = args.nights ?? 1;
  if (!args.check_in) return fail('A hotel booking needs a check-in date.');
  const { data: h } = await db.from('hotels').select('*').eq('id', args.item_id).maybeSingle();
  if (!h) return fail('That hotel id does not exist. Search again and use an id from the results.');
  if (h.rooms_left < 1) return fail('That hotel has no rooms left.');
  return {
    ok: true as const,
    needs_confirmation: true as const,
    proposal: {
      action: 'book' as const,
      kind: 'hotel' as const,
      item_id: h.id as number,
      title: `${h.name}, ${h.city}`,
      when: `Check-in ${args.check_in}, ${nights} night${nights > 1 ? 's' : ''}`,
      total_inr: (h.price_per_night_inr * nights) as number,
      check_in: args.check_in,
      nights,
      idempotency_key: randomUUID(),
    },
  };
}

// Prepares a cancellation. Writes NOTHING. The agent must quote the fee from search_policy.
export async function proposeCancellation(userId: string, args: { booking_id: string }) {
  const db = supabaseAdmin();
  const { data: b } = await db
    .from('bookings')
    .select('id, kind, item_id, status, created_at')
    .eq('id', args.booking_id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!b) return fail('No booking with that id was found for this user.');
  if (b.status !== 'confirmed') return fail(`This booking is already ${b.status}.`);

  let title = '';
  let hoursToDeparture: number | null = null;
  let paid = 0;
  if (b.kind === 'flight') {
    const { data: f } = await db.from('flights').select('*').eq('id', b.item_id).maybeSingle();
    if (!f) return fail('The flight for this booking could not be found.');
    title = `${f.airline}: ${f.origin} to ${f.destination}, departs ${toIST(f.depart_at)}`;
    hoursToDeparture = Math.round((new Date(f.depart_at).getTime() - Date.now()) / 3600_000);
    paid = f.price_inr;
  } else {
    const { data: h } = await db.from('hotels').select('*').eq('id', b.item_id).maybeSingle();
    title = h ? `${h.name}, ${h.city}` : 'Hotel booking';
    paid = h?.price_per_night_inr ?? 0;
  }
  const hoursSinceBooking = Math.round((Date.now() - new Date(b.created_at).getTime()) / 3600_000);

  return {
    ok: true as const,
    needs_confirmation: true as const,
    proposal: {
      action: 'cancel' as const,
      kind: b.kind as 'flight' | 'hotel',
      booking_id: b.id as string,
      title,
      hours_until_departure: hoursToDeparture,
      hours_since_booking: hoursSinceBooking,
      original_price_inr: paid,
      idempotency_key: randomUUID(),
    },
    note: 'Fee and refund are NOT computed here. Call search_policy and quote the rule that applies.',
  };
}

// ---------- the tool set given to the model ----------

const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date as YYYY-MM-DD, in Indian time');

export function createTools(userId: string | null) {
  const needUser = () => fail('The user must be logged in for this.');
  return {
    search_flights: tool({
      description: 'Search flights between two cities on one date. Returns up to 5 cheapest flights with ids.',
      inputSchema: z.object({
        origin: z.string().describe('Departure city'),
        destination: z.string().describe('Arrival city'),
        date: dateText,
        max_price_inr: z.number().optional().describe('Optional price ceiling in rupees'),
      }),
      execute: async (args) => searchFlights(args),
    }),
    search_hotels: tool({
      description: 'Search hotels in a city. Returns up to 5 cheapest hotels with ids.',
      inputSchema: z.object({
        city: z.string(),
        max_price_per_night_inr: z.number().optional(),
      }),
      execute: async (args) => searchHotels(args),
    }),
    get_weather: tool({
      description: 'Live weather forecast for a city on a date (today up to 15 days ahead).',
      inputSchema: z.object({ city: z.string(), date: dateText.optional() }),
      execute: async (args) => getWeather(args),
    }),
    search_policy: tool({
      description:
        'Search cancellation, refund, baggage, delay, check-in and hotel rules. Always use this before stating any policy, fee or refund.',
      inputSchema: z.object({ question: z.string().describe("The user's policy question in plain words") }),
      execute: async (args) => searchPolicy(args),
    }),
    get_booking_status: tool({
      description: "Check a flight booking's live status (delay or gate change). Needs a booking id.",
      inputSchema: z.object({ booking_id: z.string() }),
      execute: async (args) => (userId ? getBookingStatus(userId, args) : needUser()),
    }),
    propose_booking: tool({
      description:
        'Prepare a flight or hotel booking for the user to confirm. This does NOT book anything. The user must click Confirm.',
      inputSchema: z.object({
        kind: z.enum(['flight', 'hotel']),
        item_id: z.number().describe('The id from a search result'),
        check_in: dateText.optional().describe('Hotels only'),
        nights: z.number().int().min(1).max(30).optional().describe('Hotels only'),
      }),
      execute: async (args) => (userId ? proposeBooking(args) : needUser()),
    }),
    propose_cancellation: tool({
      description:
        'Prepare a cancellation for the user to confirm. This does NOT cancel anything. Then call search_policy to state the fee.',
      inputSchema: z.object({ booking_id: z.string() }),
      execute: async (args) => (userId ? proposeCancellation(userId, args) : needUser()),
    }),
  };
}
