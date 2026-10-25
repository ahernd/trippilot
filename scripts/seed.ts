// Seeds synthetic flights and hotels into Supabase.
//
// Run:        npx tsx --env-file=.env.local scripts/seed.ts
// Re-seed:    npx tsx --env-file=.env.local scripts/seed.ts --reset
// Dry run:    DRY_RUN=1 npx tsx scripts/seed.ts   (prints counts, no database)
//
// Design: every ordered pair of 5 cities has one flight per day for the next 15 days,
// so searches like "Pune to Goa on Friday" always find something.
// 5 cities x 4 destinations = 20 routes x 15 days = 300 flights. 5 cities x 12 = 60 hotels.

import { createClient } from '@supabase/supabase-js';

const cities = ['Pune', 'Mumbai', 'Delhi', 'Goa', 'Bengaluru'];
const airlines = ['SkyJet', 'BlueWing', 'IndiFly', 'AirDemo'];
const hotelWords = ['Grand', 'Palm', 'Central', 'Harbour', 'Garden', 'Summit'];
const DAYS = 15;

const IST_MS = 5.5 * 60 * 60 * 1000;
const rand = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const pad = (n: number) => String(n).padStart(2, '0');

// Calendar date in India, offset by N days from today.
function istDate(offsetDays: number): string {
  const d = new Date(Date.now() + IST_MS + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function buildFlights() {
  const rows: any[] = [];
  for (const origin of cities) {
    for (const destination of cities) {
      if (origin === destination) continue;
      const base = 2500 + ((origin.length * 37 + destination.length * 53) % 20) * 150;
      for (let day = 1; day <= DAYS; day++) {
        const date = istDate(day);
        const hour = rand(5, 22);
        const minute = [0, 15, 30, 45][rand(0, 3)];
        const depart = new Date(`${date}T${pad(hour)}:${pad(minute)}:00+05:30`);
        const arrive = new Date(depart.getTime() + rand(75, 180) * 60_000);
        rows.push({
          origin,
          destination,
          depart_at: depart.toISOString(),
          arrive_at: arrive.toISOString(),
          airline: airlines[rand(0, airlines.length - 1)],
          price_inr: base + rand(0, 3500),
          seats_left: rand(2, 30),
        });
      }
    }
  }
  return rows;
}

function buildHotels() {
  const rows: any[] = [];
  for (const city of cities) {
    for (let i = 0; i < 12; i++) {
      rows.push({
        city,
        name: `${city} ${hotelWords[i % hotelWords.length]} ${i + 1}`,
        price_per_night_inr: rand(1500, 9000),
        rating: rand(35, 50) / 10,
        rooms_left: rand(2, 15),
      });
    }
  }
  return rows;
}

async function insertInBatches(supabase: any, table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 100));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  const flights = buildFlights();
  const hotels = buildHotels();

  if (process.env.DRY_RUN) {
    console.log(`Dry run: ${flights.length} flights, ${hotels.length} hotels.`);
    console.log('Sample flight:', flights[0]);
    console.log('Sample hotel:', hotels[0]);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local');
  }
  const supabase = createClient(url, key);

  const reset = process.argv.includes('--reset');
  const { count: existing, error: countError } = await supabase
    .from('flights')
    .select('*', { count: 'exact', head: true });
  if (countError) throw new Error(`Could not read flights table: ${countError.message}`);

  if ((existing ?? 0) > 0 && !reset) {
    console.log(`Flights table already has ${existing} rows. Nothing done. Use --reset to replace them.`);
    return;
  }
  if (reset) {
    await supabase.from('flights').delete().gte('id', 0);
    await supabase.from('hotels').delete().gte('id', 0);
    console.log('Old flights and hotels removed.');
  }

  await insertInBatches(supabase, 'flights', flights);
  await insertInBatches(supabase, 'hotels', hotels);
  console.log(`Seeded ${flights.length} flights and ${hotels.length} hotels.`);
}

main().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
