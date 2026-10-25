// The chat endpoint. The browser sends the conversation, we stream the agent's answer back.

import { streamText, isStepCount, convertToModelMessages, toUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { UIMessage } from 'ai';
import { getUser } from '@/lib/auth';
import { getModel } from '@/lib/models';
import { createTools } from '@/lib/tools';
import { buildInstructions } from '@/lib/agent';
import { listUserBookings } from '@/lib/bookings';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { MAX_STEPS, MAX_INPUT_CHARS } from '@/lib/config';

export const maxDuration = 60;

function lastUserText(messages: UIMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  return last.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ').trim();
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return Response.json({ error: 'Please log in.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const messages: UIMessage[] = body?.messages ?? [];
  const text = lastUserText(messages);
  if (!text) return Response.json({ error: 'Empty message.' }, { status: 400 });
  if (text.length > MAX_INPUT_CHARS) {
    return Response.json({ error: `Please keep messages under ${MAX_INPUT_CHARS} characters.` }, { status: 400 });
  }

  const db = supabaseAdmin();
  const [{ data: profile }, bookings] = await Promise.all([
    db.from('profiles').select('home_city, seat_pref').eq('id', user.id).maybeSingle(),
    listUserBookings(user.id),
  ]);

  const started = Date.now();
  const result = streamText({
    model: getModel('fast'),
    instructions: buildInstructions({
      homeCity: profile?.home_city,
      seatPref: profile?.seat_pref,
      bookings,
    }),
    messages: await convertToModelMessages(messages),
    tools: createTools(user.id),
    stopWhen: isStepCount(MAX_STEPS),
    onEnd: async (event: any) => {
      // Save one log row per turn. Failure to log must never break the chat.
      try {
        const toolNames = (event.steps ?? []).flatMap((s: any) => (s.toolCalls ?? []).map((c: any) => c.toolName));
        await db.from('agent_runs').insert({
          user_id: user.id,
          input: text.slice(0, 500),
          tool_calls: toolNames,
          latency_ms: Date.now() - started,
          tokens: event.usage?.totalTokens ?? null,
        });
      } catch {}
    },
  });

  return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
}
