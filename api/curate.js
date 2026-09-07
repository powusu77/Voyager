// Trip curation endpoint.
//
// The browser must never hold the AI provider key, so the page posts the form
// data here. This function builds the prompt, calls the provider with the
// credentials attached, and returns the parsed trip object.
//
// Environment variables (set in Vercel, never committed):
//   AI_API_KEY   required, provider API key
//   AI_BASE_URL  optional, defaults to Moonshot / Kimi
//   AI_MODEL     optional, defaults to kimi-k2.6
//
// Base URL and model are configurable so the provider can be changed without
// editing code.

const API_BASE = process.env.AI_BASE_URL || 'https://api.moonshot.ai/v1';
const API_MODEL = process.env.AI_MODEL || 'kimi-k2.6';

// Kept below the 60s function limit in vercel.json so a slow provider still
// returns a handled response instead of being killed by the platform.
const UPSTREAM_TIMEOUT_MS = 45000;

const UNAVAILABLE =
  'Trip curation is temporarily unavailable. Please try again in a little while.';
const UNREADABLE =
  'We could not put an itinerary together this time. Please try again.';

// Visitors get a plain sentence; the technical reason goes to the function log.
// Provider messages can contain account identifiers, so they are never returned.
function fail(res, status, message, logDetail) {
  if (logDetail) console.error('[curate]', status, logDetail);
  return res.status(status).json({ error: message, retryable: status !== 400 });
}

function str(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function buildPrompt(d) {
  const interests = Array.isArray(d.interests)
    ? d.interests.map((i) => str(i, 40)).filter(Boolean).slice(0, 12).join(', ')
    : '';

  return `You are a luxury travel curator AI. Generate a complete trip curation for this brief:
Origin: ${str(d.origin, 120) || 'Munich'}
Destination: ${str(d.destination, 120) || 'Surprise me'}
Depart: ${str(d.departDate, 40) || 'Flexible'}
Return: ${str(d.returnDate, 40) || 'Flexible'}
Travellers: ${str(d.travellers, 60)}
Budget: ${str(d.budget, 60)}
Cabin: ${str(d.cabin, 60)}
Interests: ${interests || 'General'}
Wishes: ${str(d.wishes, 1200) || 'A wonderful holiday'}

Respond ONLY with a JSON object (no markdown, no backticks) with this exact structure:
{"profile":{"origin":string,"destination":string,"departDate":string,"returnDate":string,"budgetTier":string,"comfortStyle":string,"cabinClass":string,"dinnerMood":string,"tripInterests":string[]},"flights":[{"route":string,"airline":string,"timing":string,"price":string,"cabin":string,"handoff":string}],"proposals":[{"id":"p1","title":string,"mood":string,"pace":"leisurely"|"balanced"|"action-packed","estimate":string,"budgetLabel":string,"comfortLabel":string,"interestLabel":string,"dinnerLabel":string,"fit":string,"hotel":{"name":string,"area":string},"restaurants":[{"name":string}],"dinners":[{"name":string,"format":string,"why":string}],"experiences":[{"title":string}],"dayPlan":[{"day":string,"title":string,"items":string[]}]}]}
Generate exactly 3 proposals with distinct moods/paces. 3 flight options. dayPlan min 3 days. Be vivid and specific.`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Method not allowed.');
  }

  const key = process.env.AI_API_KEY;
  if (!key) {
    return fail(res, 503, UNAVAILABLE, 'AI_API_KEY is not set.');
  }

  const data = req.body && typeof req.body === 'object' ? req.body : null;
  if (!data) {
    return fail(res, 400, 'Something looked wrong with that request. Please try again.');
  }
  if (!str(data.destination, 120) && !str(data.wishes, 1200)) {
    return fail(res, 400, 'Add a destination, or describe the trip you have in mind.');
  }

  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: API_MODEL,
        max_tokens: 8000,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: buildPrompt(data) }]
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (error) {
    const reason = error && error.name === 'TimeoutError' ? 'timed out' : 'unreachable';
    return fail(res, 503, UNAVAILABLE, `Provider ${reason}.`);
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    const reason = (payload && payload.error && payload.error.message) || `status ${upstream.status}`;
    return fail(res, 503, UNAVAILABLE, `Provider ${upstream.status}: ${reason}`);
  }

  const message = payload && payload.choices && payload.choices[0] && payload.choices[0].message;
  const raw = message && typeof message.content === 'string' ? message.content : '';

  let result;
  try {
    result = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return fail(res, 502, UNREADABLE, 'Provider response was not valid JSON.');
  }

  if (!result || !result.profile || !Array.isArray(result.proposals) || !result.proposals.length) {
    return fail(res, 502, UNREADABLE, 'Provider response was missing profile or proposals.');
  }
  if (!Array.isArray(result.flights)) {
    result.flights = [];
  }

  return res.status(200).json(result);
};
