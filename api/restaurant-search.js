const OFF_HEADERS = {
  'User-Agent': 'NotSexyFitness/1.0 (nutrition tracker; contact: kharless@gmail.com)',
  'Accept': 'application/json, text/javascript, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

async function searchUSDABrands(q) {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) return [];

  const res = await fetch(
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        pageSize: 50,
        dataType: ['Branded'],
        fields: ['brandOwner', 'brandName'],
      }),
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!res.ok) return [];

  const data = await res.json();
  const qLower = q.toLowerCase();
  const seen = new Set();
  const names = [];

  for (const food of data.foods ?? []) {
    for (const raw of [food.brandOwner, food.brandName]) {
      if (!raw) continue;
      const name = raw.trim();
      const key = name.toLowerCase();
      if (key.includes(qLower) && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    }
  }

  return names;
}

async function searchOFFBrands(q) {
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('tagtype_0', 'brands');
  url.searchParams.set('tag_contains_0', 'contains');
  url.searchParams.set('tag_0', q);
  url.searchParams.set('json', '1');
  url.searchParams.set('action', 'process');
  url.searchParams.set('page_size', '100');
  url.searchParams.set('fields', 'brands');

  const res = await fetch(url.toString(), {
    headers: OFF_HEADERS,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return [];

  const data = await res.json();
  const qLower = q.toLowerCase();
  const seen = new Set();
  const names = [];

  for (const product of data.products ?? []) {
    for (const raw of (product.brands ?? '').split(',')) {
      const name = raw.trim();
      const key = name.toLowerCase();
      if (name && key.includes(qLower) && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    }
  }

  return names;
}

export default async function handler(req, res) {
  const q = (req.query?.q ?? '').trim();

  if (!q) {
    return res.status(400).json({ error: 'Missing required query parameter: q' });
  }

  let names = [];

  try {
    names = await searchUSDABrands(q);
  } catch { /* fall through */ }

  if (names.length < 3) {
    try {
      const offNames = await searchOFFBrands(q);
      const seen = new Set(names.map(n => n.toLowerCase()));
      for (const name of offNames) {
        if (!seen.has(name.toLowerCase())) {
          seen.add(name.toLowerCase());
          names.push(name);
        }
      }
    } catch { /* return whatever we have */ }
  }

  names.sort((a, b) => a.localeCompare(b));

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json(names);
}
