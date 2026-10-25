# TripPilot: Agent Spec

**One line:** A chat agent that searches flights and hotels, checks weather, explains cancellation rules, and books or cancels only after the user clicks Confirm. It never invents data.

**Status:** Checkpoint 1. Demo data and demo policies are synthetic. This is stated in the README.

## 1. Define your user

- **Who:** Working professionals in India who take 1 to 2 trips a month. Mostly domestic and short trips.
- **Context:** They book on a phone between meetings. They juggle many tabs, nothing remembers their preferences, and they get no help when a flight changes.
- **Not the user:** Travel agencies, corporate travel desks, group tours.

## 2. One job-to-be-done

> "Get me a flight and hotel for this trip, book it after I confirm, and tell me if anything changes."

Success means the user goes from request to confirmed booking in one chat. Every flight, price, weather figure and policy comes from a tool result.

## 3. Tools

| Tool | Source | Type |
|---|---|---|
| `search_flights` | Supabase table (synthetic data) | Read |
| `search_hotels` | Supabase table (synthetic data) | Read |
| `get_weather` | Open-Meteo API (live), with timeout and one retry | Read |
| `search_policy` | Supabase pgvector, RAG over cancellation, refund, baggage and delay rules | Read |
| `get_booking_status` | Simulated delay or gate change | Read |
| `propose_booking` | Prepares a booking. Does not write. | Proposal |
| `propose_cancellation` | Prepares a cancellation. Does not write. | Proposal |

**Write rule:** Only the Confirm button writes. It calls `/api/bookings/confirm`. The agent has no tool that can write a booking by itself. Each proposal carries an idempotency key, so a repeated click never double-books.

## 4. Memory and state

- **Short term:** the message history of the current chat.
- **Long term:** a `profiles` table with home city and seat preference, read at the start of each chat.

## 5. Guardrails and failure handling

- **Grounding:** the agent states only flights, prices, weather and policies returned by a tool.
- **Tool failure:** every tool returns `{ ok: false, error }` instead of crashing. If a tool fails twice, the agent says so and offers a next step. It never guesses.
- **Off-topic:** the agent refuses requests outside flights, hotels, weather and travel policies.
- **Privacy:** Supabase Auth with row-level security. A user sees only their own bookings.
- **Limits:** input length cap and a maximum of 6 agent steps per turn.

## 6. Success metrics (at launch)

| Metric | Target |
|---|---|
| Task success rate on 40+ test cases | 85% or more |
| Correct tool and arguments | 90% or more |
| Hallucinated flight, price or policy | 0 |
| Write actions without explicit confirmation | 0 |
| Median latency | Under 6 seconds |
| Cost per conversation | Reported |

## 7. Scope

**In:** flights and hotels, one live API, confirm before write, basic memory of home city and seat preference, policy search.

**Out (next steps):** car rentals, payments, voice, multi-city trips, real airline or hotel APIs.

## 8. Stack

Next.js on Vercel, Vercel AI SDK, OpenRouter models, Supabase (Postgres, pgvector, Auth with row-level security), Hugging Face embeddings, code on GitHub, evals run in GitHub Actions.

## 9. Design choices

- **Tools, not free text:** the agent cannot state facts it did not fetch.
- **Confirm button in code:** "no booking without a yes" is enforced by the system, not requested in a prompt.
- **Two model tiers:** a cheap model for simple turns and a stronger one for planning. Names live in one config file.
- **RAG for policies:** rules change, and answers must quote real text with numbers.
- **Synthetic data:** real booking APIs need commercial access, and a seven-day build does not.
