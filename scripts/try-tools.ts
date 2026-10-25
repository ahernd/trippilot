// Tries the read-only tools from the command line, with no AI model involved.
// Run: npx tsx --env-file=.env.local scripts/try-tools.ts

import { searchFlights, searchHotels, getWeather, searchPolicy, proposeBooking } from '../lib/tools';

function dayFromNow(n: number) {
  return new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
}
const show = (label: string, value: unknown) => {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
};

async function main() {
  const date = dayFromNow(3);
  const flights: any = await searchFlights({ origin: 'pune', destination: 'Goa', date });
  show(`Flights Pune to Goa on ${date}`, flights);

  show('Hotels in Goa under 4000', await searchHotels({ city: 'Goa', max_price_per_night_inr: 4000 }));
  show('Weather in Goa', await getWeather({ city: 'Goa', date }));
  show('Policy: baggage', await searchPolicy({ question: 'how many kilos can I carry' }));
  show('Policy: off-topic', await searchPolicy({ question: 'what is the capital of France' }));
  show('Bad city', await searchFlights({ origin: 'Paris', destination: 'Goa', date }));

  const first = flights.flights?.[0];
  if (first) {
    show('Propose booking (writes nothing)', await proposeBooking({ kind: 'flight', item_id: first.id }));
  }
}

main().catch((e) => {
  console.error('Failed:', e.message);
  process.exit(1);
});
