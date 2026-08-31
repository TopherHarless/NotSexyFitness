const FOOD_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    name:      { type: 'string' },
    calories:  { type: 'number' },
    protein_g: { type: 'number' },
    carbs_g:   { type: 'number' },
    fat_g:     { type: 'number' },
    fiber_g:   {
      description: 'Fiber in grams. null if the provided menu data has no fiber value — never guess, never default to 0. null = unknown; 0 = confirmed zero fiber.',
    },
  },
  required: ['name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'],
};

const COMBOS_TOOL = {
  name: 'respond_with_meal_combos',
  description: 'Return exactly 3 diverse meal combinations plus healthiness-sorted alternates per category.',
  input_schema: {
    type: 'object',
    required: ['meals', 'alternates'],
    properties: {
      meals: {
        type: 'array',
        description: 'Exactly 3 complete meal suggestions. Use fewer only if the menu genuinely cannot support 3 distinct meals.',
        items: {
          type: 'object',
          required: ['entree', 'side', 'drink', 'totalCalories', 'totalProtein', 'totalFiber', 'reason'],
          properties: {
            entree: {
              anyOf: [FOOD_ITEM_SCHEMA, { type: 'null' }],
              description: 'The main item. null only if the menu has no entrees.',
            },
            side: {
              anyOf: [FOOD_ITEM_SCHEMA, { type: 'null' }],
              description: 'A side item. null if this restaurant has no sides.',
            },
            drink: {
              anyOf: [FOOD_ITEM_SCHEMA, { type: 'null' }],
              description: 'A drink. null if this restaurant has no drinks.',
            },
            totalCalories: { type: 'number', description: 'Sum of calories across all non-null components.' },
            totalProtein:  { type: 'number', description: 'Sum of protein_g across all non-null components.' },
            totalFiber: {
              anyOf: [{ type: 'number' }, { type: 'null' }],
              description: 'Sum of fiber_g across non-null components. null if ALL component fiber values are unknown.',
            },
            reason: {
              type: 'string',
              description: '1-2 sentences. Casual, direct. Why this combination fits the goal. No fluff.',
            },
          },
        },
      },
      alternates: {
        type: 'object',
        description: 'The full categorized list for each category, sorted healthiest-first. Include every item — do NOT exclude items used as primary picks in the 3 meals. Every item the AI categorized into a bucket must appear in that bucket\'s alternates array.',
        required: ['entrees', 'sides', 'drinks'],
        properties: {
          entrees: { type: 'array', items: FOOD_ITEM_SCHEMA },
          sides:   { type: 'array', items: FOOD_ITEM_SCHEMA },
          drinks:  { type: 'array', items: FOOD_ITEM_SCHEMA },
        },
      },
    },
  },
};

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

  const { menuItems, userProfile, restaurantName } = body ?? {};

  if (!Array.isArray(menuItems) || menuItems.length === 0) {
    return res.status(400).json({ error: 'menuItems must be a non-empty array' });
  }
  if (!userProfile?.goal || !userProfile?.dailyCalories || !userProfile?.dailyProtein) {
    return res.status(400).json({ error: 'userProfile must include goal, dailyCalories, and dailyProtein' });
  }
  if (!restaurantName) {
    return res.status(400).json({ error: 'restaurantName is required' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Anthropic API key not configured' });
  }

  const { goal, dailyCalories, dailyProtein, foodsToAvoid = [] } = userProfile;

  const goalDescription = goal === 'cutting'
    ? 'cutting (losing fat, preserving muscle — prioritize protein density and calorie control)'
    : goal === 'bulking'
      ? 'bulking (gaining muscle — prioritize protein density; higher calories are fine)'
      : 'maintaining (sustaining weight — balance protein and calories near target)';

  const itemsList = menuItems
    .map((item, i) => {
      const parts = [`${i + 1}. ${item.name}`];
      if (item.calories  != null) parts.push(`${item.calories}cal`);
      if (item.protein_g != null) parts.push(`${item.protein_g}g protein`);
      if (item.carbs_g   != null) parts.push(`${item.carbs_g}g carbs`);
      if (item.fat_g     != null) parts.push(`${item.fat_g}g fat`);
      if (item.fiber_g   != null) parts.push(`${item.fiber_g}g fiber`);
      return parts.join(' — ');
    })
    .join('\n');

  const avoidLine = foodsToAvoid.length > 0
    ? `\nFoods to avoid — exclude these entirely from all categories and meals: ${foodsToAvoid.join(', ')}.`
    : '';

  const alternateSortNote = goal === 'cutting'
    ? 'For sorting alternates: weight protein-to-calorie ratio heavily (more protein per calorie = better), add a bonus for fiber, treat higher calories as a mild penalty once protein and fiber are factored in.'
    : goal === 'bulking'
      ? 'For sorting alternates: prioritize protein density (protein per calorie), bonus for fiber, but do not penalize higher-calorie items — a surplus is the goal.'
      : 'For sorting alternates: balance protein density and fiber; use total calories as a soft tiebreaker toward the lower end.';

  const prompt = [
    `The user is eating at ${restaurantName}. Goal: ${goalDescription}.`,
    `Daily targets: ${dailyCalories} kcal, ${dailyProtein}g protein.`,
    avoidLine,
    '',
    `Menu (${menuItems.length} items):`,
    itemsList,
    '',
    'Instructions:',
    '1. Categorize every item as "entree", "side", "drink", or "other" using judgment from the name and macros. Items categorized as "other" do not appear in any output.',
    '2. If a restaurant lacks obvious sides or drinks, do your best to assign the closest substitute — use judgment, not a hard rule.',
    '3. Exclude anything matching foods-to-avoid from ALL categories before building meals.',
    '4. Build exactly 3 complete meal suggestions (entree + side + drink). The 3 meals must use different entrees. Omit a slot only if that category has zero items after step 3.',
    '5. Each meal\'s totals are the arithmetic sum of its non-null components.',
    '6. For fiber_g: the provided data may not include fiber. Set fiber_g to null if you have no fiber data for an item in the provided list — never guess, never default to 0. null = unknown; 0 = confirmed zero grams.',
    '7. alternates.entrees/sides/drinks must contain the FULL categorized list for that category, sorted healthiest-first. Include every item in each category — including items used as primary picks in the 3 meals. Do not exclude primary picks from alternates.',
    alternateSortNote,
    '8. Treat null/unknown fiber as neutral when sorting alternates — do not penalize it vs confirmed 0g.',
  ].filter(Boolean).join('\n');

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
        max_tokens: 4096,
        system: "You are a direct, no-fluff fitness nutrition advisor. Build practical meal combinations based on the user's goals. No motivational filler.",
        tools: [COMBOS_TOOL],
        tool_choice: { type: 'tool', name: 'respond_with_meal_combos' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, err);
      return res.status(502).json({ error: 'Failed to get recommendations from AI' });
    }

    const data = await anthropicRes.json();

    const toolUse = data.content?.find(
      block => block.type === 'tool_use' && block.name === 'respond_with_meal_combos'
    );
    if (!toolUse?.input?.meals) {
      console.error('Unexpected Anthropic response shape:', JSON.stringify(data));
      return res.status(500).json({ error: 'Unexpected response from AI' });
    }

    return res.status(200).json({
      meals:      toolUse.input.meals,
      alternates: toolUse.input.alternates ?? { entrees: [], sides: [], drinks: [] },
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'AI request timed out' });
    }
    console.error('rank-meals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
