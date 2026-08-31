// USDA nutrient IDs for the fields we care about
const NUTRIENT = {
  calories: [1008, 2047, 2048], // Energy (kcal) — multiple representations in FDC
  protein_g: [1003],
  carbs_g:   [1005],
  fat_g:     [1004],
};

function pickNutrient(nutrients, ids) {
  for (const id of ids) {
    const hit = nutrients.find(n => n.nutrientId === id);
    if (hit?.value != null) return Math.round(hit.value * 10) / 10;
  }
  return null;
}

async function searchUSDA(restaurant) {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) return [];

  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: restaurant,
        pageSize: 25,
        dataType: ['Branded', 'Survey (FNDDS)'],
      }),
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!res.ok) return [];

  const data = await res.json();

  return (data.foods ?? [])
    .map(food => ({
      name:      food.description ?? '',
      calories:  pickNutrient(food.foodNutrients ?? [], NUTRIENT.calories),
      protein_g: pickNutrient(food.foodNutrients ?? [], NUTRIENT.protein_g),
      carbs_g:   pickNutrient(food.foodNutrients ?? [], NUTRIENT.carbs_g),
      fat_g:     pickNutrient(food.foodNutrients ?? [], NUTRIENT.fat_g),
    }))
    .filter(item => item.name && item.calories != null);
}

async function searchOpenFoodFacts(restaurant) {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('tagtype_0', 'brands');
  url.searchParams.set('tag_contains_0', 'contains');
  url.searchParams.set('tag_0', restaurant);
  url.searchParams.set('json', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('page_size', '30');
  url.searchParams.set('fields', 'product_name,nutriments');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'NotSexyFitness/1.0 (nutrition tracker; contact: kharless@gmail.com)',
      'Accept': 'application/json, text/javascript, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return [];

  const data = await res.json();

  return (data.products ?? [])
    .map(product => {
      const n = product.nutriments ?? {};
      // Prefer per-serving values; fall back to per-100g
      const cal     = n['energy-kcal_serving']      ?? n['energy-kcal_100g']      ?? null;
      const protein = n['proteins_serving']          ?? n['proteins_100g']          ?? null;
      const carbs   = n['carbohydrates_serving']     ?? n['carbohydrates_100g']     ?? null;
      const fat     = n['fat_serving']               ?? n['fat_100g']               ?? null;

      return {
        name:      (product.product_name ?? '').trim(),
        calories:  cal     != null ? Math.round(cal     * 10) / 10 : null,
        protein_g: protein != null ? Math.round(protein * 10) / 10 : null,
        carbs_g:   carbs   != null ? Math.round(carbs   * 10) / 10 : null,
        fat_g:     fat     != null ? Math.round(fat     * 10) / 10 : null,
      };
    })
    .filter(item => item.name && item.calories != null);
}

export default async function handler(req, res) {
  const restaurant = (req.query?.restaurant ?? '').trim();

  if (!restaurant) {
    return res.status(400).json({ error: 'Missing required query parameter: restaurant' });
  }

  let items = [];

  try {
    items = await searchUSDA(restaurant);
  } catch { /* fall through to OFF */ }

  if (items.length < 5) {
    try {
      const offItems = await searchOpenFoodFacts(restaurant);
      const seen = new Set(items.map(i => i.name.toLowerCase()));
      for (const item of offItems) {
        if (!seen.has(item.name.toLowerCase())) {
          seen.add(item.name.toLowerCase());
          items.push(item);
        }
      }
    } catch { /* return whatever we have */ }
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).json(items.slice(0, 20));
}
