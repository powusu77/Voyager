// Server-side endpoint for the trip curation request.
//
// The browser must never hold the AI provider key, so the page posts the raw
// form data here; this function builds the prompt, calls the provider with the
// credentials attached, and returns the parsed trip object. The key lives only
// in a Vercel environment variable and is never sent to the client.
//
// Configuration (Vercel environment variables):
//   AI_API_KEY   (required) provider API key
//   AI_BASE_URL  (optional) defaults to Moonshot / Kimi
//   AI_MODEL     (optional) defaults to kimi-k2.6
//
// The provider is configurable so it can be changed without a code change.

const API_BASE = process.env.AI_BASE_URL || 'https://api.moonshot.ai/v1';
const API_MODEL = process.env.AI_MODEL || 'kimi-k2.6';

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
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
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const key = process.env.AI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'Trip service is not configured.',
      detail: 'The server is missing its AI provider key.'
    });
  }

  const data = req.body && typeof req.body === 'object' ? req.body : null;
  if (!data) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  if (!str(data.destination, 120) && !str(data.wishes, 1200)) {
    return res.status(400).json({ error: 'Add a destination or describe your dream trip.' });
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
      })
    });
  } catch (e) {
    return res.status(502).json({
      error: 'Could not reach the trip service.',
      detail: 'The AI provider did not respond.'
    });
  }

  const payload = await upstream.json().catch(() => null);

  if (!upstream.ok) {
    // Surface the provider's own reason (no credit, bad key, unknown model)
    // so failures are diagnosable, without echoing the credential.
    const detail = (payload && payload.error && payload.error.message) || `Upstream error ${upstream.status}.`;
    return res.status(upstream.status === 429 ? 429 : 502).json({
      error: 'The trip service is unavailable right now.',
      detail
    });
  }

  const raw =
    payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content || ''
      : '';

  let result;
  try {
    result = JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    return res.status(502).json({
      error: 'The trip service returned an unreadable response.',
      detail: 'Response was not valid JSON.'
    });
  }

  if (!result || !result.profile || !Array.isArray(result.proposals) || !result.proposals.length) {
    return res.status(502).json({
      error: 'The trip service returned an incomplete itinerary.',
      detail: 'Missing profile or proposals.'
    });
  }
  if (!Array.isArray(result.flights)) result.flights = [];

  return res.status(200).json(result);
};
