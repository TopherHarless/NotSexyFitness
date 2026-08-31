export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { menuItems } = body ?? {};
  if (!Array.isArray(menuItems) || menuItems.length === 0) {
    return res.status(400).json({ error: 'menuItems required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const menuJson = JSON.stringify(menuItems);
  const prompt = `You are a practical nutrition advisor. From this Chick-fil-A menu, suggest 2-3 meal combos that are genuinely good options for someone prioritizing protein and fiber without going overboard on calories. Each combo needs one entree or salad, one side, and one drink. Drinks should be zero or very low calorie (water, unsweet tea, diet options). No desserts. Be practical — suggest things a real person would actually order together.

For each combo return JSON only, no prose outside the JSON:
{
  "combos": [
    {
      "title": "short title",
      "reason": "one sentence, casual",
      "entree": { "name": "...", "calories": 0, "protein_g": 0, "fiber_g": 0 },
      "side": { "name": "...", "calories": 0, "protein_g": 0, "fiber_g": 0 },
      "drink": { "name": "...", "calories": 0, "protein_g": 0, "fiber_g": 0 }
    }
  ]
}

Menu: ${menuJson}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic error:', anthropicRes.status, errText);
      return res.status(502).json({ error: 'AI request failed' });
    }

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text ?? '';

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error('Parse error:', e, 'Raw response:', text);
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    if (!Array.isArray(parsed.combos) || !parsed.combos.length) {
      return res.status(500).json({ error: 'Invalid response structure' });
    }

    return res.status(200).json({ combos: parsed.combos });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Request timed out' });
    }
    console.error('suggest-meal error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
