'use client';

import './trippilot.css';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { Session } from '@supabase/supabase-js';
import { supabaseBrowser as supabase } from '@/lib/supabase-browser';

const CITY_NAMES = ['Pune', 'Mumbai', 'Delhi', 'Goa', 'Bengaluru'];
const SEATS = ['No preference', 'Window', 'Aisle'];
const STARTERS = [
  'Find me a flight from Pune to Goa tomorrow',
  'Cheapest hotel in Goa under 3000 per night',
  'What happens if I cancel less than 24 hours before my flight?',
];

// The login token is kept here so the chat request can attach it.
let currentToken = '';

const inr = (n: number) => new Intl.NumberFormat('en-IN').format(n);

// ---------------------------------------------------------------- login screen

function AuthForm() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setMessage(error.message);
      else if (!data.session) setMessage('Check your email to confirm your account, then log in.');
    }
    setBusy(false);
  }

  return (
    <main className="tp">
      <div className="tp-auth">
        <h1>TripPilot</h1>
        <p className="tp-muted">Flights and hotels across India. Book only after you confirm.</p>
        <form onSubmit={submit}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input
            type="password"
            placeholder="Password (6+ characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <button type="submit" disabled={busy}>{mode === 'in' ? 'Log in' : 'Create account'}</button>
        </form>
        {message && <p className="tp-error">{message}</p>}
        <button className="tp-link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
        <p className="tp-small">Demo app. All flights, hotels and policies are synthetic.</p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- proposal card

type Proposal = {
  action: 'book' | 'cancel';
  kind: 'flight' | 'hotel';
  item_id?: number;
  booking_id?: string;
  title: string;
  when?: string;
  total_inr?: number;
  check_in?: string;
  nights?: number;
  hours_until_departure?: number | null;
  original_price_inr?: number;
  idempotency_key: string;
};
type CardState = { state: 'working' | 'done' | 'error'; message: string };

function ProposalCard({ p, status, onConfirm }: { p: Proposal; status?: CardState; onConfirm: (p: Proposal) => void }) {
  const isBook = p.action === 'book';
  return (
    <div className="tp-card">
      <div className="tp-card-label">{isBook ? `Book ${p.kind}` : `Cancel ${p.kind}`}</div>
      <div className="tp-card-title">{p.title}</div>
      {p.when && <div>{p.when}</div>}
      {isBook && p.total_inr !== undefined && <div>Total: INR {inr(p.total_inr)}</div>}
      {!isBook && p.hours_until_departure != null && <div>Departs in about {p.hours_until_departure} hours</div>}
      {!isBook && p.original_price_inr ? <div>Paid: INR {inr(p.original_price_inr)}</div> : null}

      {status?.state === 'done' ? (
        <div className="tp-ok">{status.message}</div>
      ) : (
        <>
          <button disabled={status?.state === 'working'} onClick={() => onConfirm(p)}>
            {status?.state === 'working' ? 'Working...' : isBook ? 'Confirm booking' : 'Confirm cancellation'}
          </button>
          {status?.state === 'error' && <div className="tp-error">{status.message}</div>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- chat screen

type BookingItem = { id: string; kind: string; status: string; title: string };

function ChatApp({ session }: { session: Session }) {
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        headers: () => ({ Authorization: `Bearer ${currentToken}` }),
      })
  );
  const { messages, sendMessage, status, error } = useChat({ transport });

  const [input, setInput] = useState('');
  const [bookings, setBookings] = useState<BookingItem[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [homeCity, setHomeCity] = useState('');
  const [seatPref, setSeatPref] = useState('');
  const [prefNote, setPrefNote] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  async function loadBookings() {
    const res = await fetch('/api/bookings', { headers: { Authorization: `Bearer ${currentToken}` } });
    if (res.ok) setBookings((await res.json()).bookings ?? []);
  }

  useEffect(() => {
    loadBookings();
    supabase
      .from('profiles')
      .select('home_city, seat_pref')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        setHomeCity(data?.home_city ?? '');
        setSeatPref(data?.seat_pref ?? '');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  async function savePrefs(city: string, seat: string) {
    setHomeCity(city);
    setSeatPref(seat);
    const { error: err } = await supabase
      .from('profiles')
      .upsert({ id: session.user.id, home_city: city || null, seat_pref: seat || null });
    setPrefNote(err ? 'Could not save.' : 'Saved.');
    setTimeout(() => setPrefNote(''), 1500);
  }

  async function confirm(p: Proposal) {
    const key = p.idempotency_key;
    setCards((c) => ({ ...c, [key]: { state: 'working', message: '' } }));
    const payload =
      p.action === 'book'
        ? { action: 'book', kind: p.kind, item_id: p.item_id, check_in: p.check_in, nights: p.nights, idempotency_key: key }
        : { action: 'cancel', booking_id: p.booking_id, idempotency_key: key };
    try {
      const res = await fetch('/api/bookings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentToken}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'Unexpected response.' }));
      if (data.ok) {
        setCards((c) => ({ ...c, [key]: { state: 'done', message: data.message ?? 'Done.' } }));
        loadBookings();
      } else {
        setCards((c) => ({ ...c, [key]: { state: 'error', message: data.error ?? 'Something went wrong.' } }));
      }
    } catch {
      setCards((c) => ({ ...c, [key]: { state: 'error', message: 'Network problem. Try again.' } }));
    }
  }

  const busy = status === 'submitted' || status === 'streaming';

  function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    sendMessage({ text: clean });
    setInput('');
  }

  return (
    <main className="tp">
      <header className="tp-header">
        <div>
          <strong>TripPilot</strong>
          <span className="tp-muted"> {session.user.email}</span>
        </div>
        <button className="tp-link" onClick={() => supabase.auth.signOut()}>Log out</button>
      </header>

      <section className="tp-prefs">
        <label>
          Home city
          <select value={homeCity} onChange={(e) => savePrefs(e.target.value, seatPref)}>
            <option value="">Not set</option>
            {CITY_NAMES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Seat
          <select value={seatPref} onChange={(e) => savePrefs(homeCity, e.target.value)}>
            <option value="">Not set</option>
            {SEATS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <span className="tp-small">{prefNote}</span>
      </section>

      <section className="tp-chat">
        {messages.length === 0 && (
          <div className="tp-starters">
            <p className="tp-muted">Try one of these:</p>
            {STARTERS.map((s) => (
              <button key={s} className="tp-chip" onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'tp-msg tp-user' : 'tp-msg tp-bot'}>
            {m.parts.map((part, i) => {
              if (part.type === 'text') return <p key={i} className="tp-text">{part.text}</p>;
              if (part.type.startsWith('tool-')) {
                const p = part as any;
                const name = part.type.slice(5);
                const isProposal = name === 'propose_booking' || name === 'propose_cancellation';
                if (isProposal && p.state === 'output-available' && p.output?.ok && p.output.proposal) {
                  const proposal = p.output.proposal as Proposal;
                  return (
                    <ProposalCard key={i} p={proposal} status={cards[proposal.idempotency_key]} onConfirm={confirm} />
                  );
                }
                return (
                  <div key={i} className="tp-tool">
                    {p.state === 'output-available' || p.state === 'output-error' ? 'Used' : 'Using'} {name.replace(/_/g, ' ')}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}

        {busy && <div className="tp-tool">Thinking...</div>}
        {error && <div className="tp-error">Something went wrong. Please try again.</div>}
        <div ref={endRef} />
      </section>

      <form className="tp-input" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about flights, hotels, weather or policies"
          maxLength={1000}
        />
        <button type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>

      <section className="tp-bookings">
        <h2>My bookings</h2>
        {bookings.length === 0 ? (
          <p className="tp-muted">No bookings yet.</p>
        ) : (
          <ul>
            {bookings.map((b) => (
              <li key={b.id}>
                <span className={b.status === 'confirmed' ? 'tp-badge tp-badge-ok' : 'tp-badge'}>{b.status}</span> {b.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="tp-small tp-center">Demo app. All flights, hotels and policies are synthetic.</p>
    </main>
  );
}

// ---------------------------------------------------------------- page

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      currentToken = data.session?.access_token ?? '';
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      currentToken = s?.access_token ?? '';
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <main className="tp"><p className="tp-muted tp-center">Loading...</p></main>;
  return session ? <ChatApp session={session} /> : <AuthForm />;
}
