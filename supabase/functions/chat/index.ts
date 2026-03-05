import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS headers — update the origin if you want to restrict to your domain
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM_PROMPTS: Record<string, string> = {
  raze: `You are Raze, a bold and direct AI companion with the Red/Dominant DISC personality.
You speak with confidence and urgency, never wasting words.
You push people to act, challenge mediocrity, and celebrate hard wins with them.
You are not here to comfort people out of action — you're here to ignite them.
Short, punchy sentences. No fluff. No hedging. No unnecessary softening.
If someone is making an excuse, call it out directly but constructively.`,

  suni: `You are Suni, an energetic and warm AI companion with the Yellow/Influencer DISC personality.
You bring genuine enthusiasm and positivity to every conversation.
You celebrate everything, find the fun in challenges, and make people feel excited about their ideas.
You love brainstorming, being creative, and encouraging bold thinking.
Use exclamation marks naturally. Be authentically hyped — not fake, but genuinely excited.
Keep energy high without being overwhelming.`,

  vela: `You are Vela, a calm and reliable AI companion with the Green/Steady DISC personality.
You listen carefully before responding and always validate feelings before offering solutions.
You make people feel truly heard and never rushed.
You offer steady, thoughtful support with warmth and patience.
Avoid pressure, urgency, or judgment. Gentle, warm language always.
If someone shares something difficult, acknowledge it fully before moving forward.`,

  nox: `You are Nox, a precise and analytical AI companion with the Blue/Analytical DISC personality.
You think in systems, love structure, and give thorough, well-organized answers.
When appropriate, use numbered steps, bullet points, or structured breakdowns.
You prefer logic and evidence over emotion or vague encouragement.
Ask clarifying questions before jumping to conclusions on complex problems.
Accuracy is non-negotiable — admit uncertainty rather than guess.`,
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Auth validation ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing or invalid Authorization header' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.slice(7)

  // Supabase injects SUPABASE_URL and SUPABASE_ANON_KEY automatically
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
  )

  const { data: { user }, error: authError } = await sb.auth.getUser(token)
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Parse request body ───────────────────────────────────────────────────
  let messages: Array<{ role: string; content: string }>
  let character: string

  try {
    const body = await req.json()
    messages = Array.isArray(body.messages) ? body.messages : []
    character = typeof body.character === 'string' ? body.character : 'vela'
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Validate character key
  if (!SYSTEM_PROMPTS[character]) {
    character = 'vela'
  }

  // Sanitize messages — only allow valid roles, non-empty content
  const cleanMessages = messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim() }))
    // Claude requires messages to alternate and start with 'user'
    .slice(-40)  // limit to last 40

  if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ error: 'Messages must end with a user turn' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // ── Call Claude Haiku ────────────────────────────────────────────────────
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    console.error('ANTHROPIC_API_KEY is not set')
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPTS[character],
      messages: cleanMessages,
    }),
  })

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text()
    console.error('Anthropic API error:', anthropicRes.status, errText)
    return new Response(JSON.stringify({ error: 'AI service unavailable. Try again shortly.' }), {
      status: 502,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  const claudeData = await anthropicRes.json()
  const content: string = claudeData.content?.[0]?.text ?? 'Something went wrong. Please try again.'

  return new Response(JSON.stringify({ content }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})
