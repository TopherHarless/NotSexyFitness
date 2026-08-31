// Serverless function: fetch and parse Chick-fil-A nutrition data from their website
// Called by /eat-out/ when the browser Refresh button hits CORS on the direct fetch

const CFA_API = 'https://www.chick-fil-a.com/wp-json/wp/v2/pages?slug=nutrition-allergens';
const VALID_CATS = new Set(['Breakfast','Entrées','Salads','Sides','Treats','Drinks','Coffee','Dipping Sauces','Dressings']);

const CAT_MARKERS = [
  ['Breakfast',      'id="Breakfast"'],
  ['Entrées',        'id="Entr'],
  ['Salads',         'id="Salads"'],
  ['Sides',          'id="Sides"'],
  ['Treats',         'id="Treats"'],
  ['Drinks',         'id="Drinks"'],
  ['Coffee',         'id="Coffee"'],
  ['Dipping Sauces', 'id="Dipping Sauces"'],
  ['Dressings',      'id="Dressings"'],
];

function toNum(v) {
  return parseFloat((v || '').replace(/[^\d.]/g, '')) || 0;
}

function getCategory(pos, catPositions) {
  let cat = null;
  for (const cp of catPositions) {
    if (pos >= cp.pos) cat = cp.cat;
    else break;
  }
  return cat && VALID_CATS.has(cat) ? cat : null;
}

function unescapeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .trim();
}

function parseNutritionHtml(html) {
  // Build category position map (search after nav area)
  const catPositions = [];
  for (const [cat, marker] of CAT_MARKERS) {
    let idx = html.indexOf(marker, 8000);
    if (idx >= 0) catPositions.push({ cat, pos: idx });
  }
  catPositions.sort((a, b) => a.pos - b.pos);

  // Find all pre-rendered each-child td blocks
  // Pattern: data-wp-each-child="...::{menu_item|sub_item}.fields"
  // followed by sr-only span with label, then value span
  const EACH_RX = /data-wp-each-child="[^"]*::context\.(menu_item|sub_item)\.fields"[\s\S]*?class="sr-only"[^>]*>([^<]+)<\/span>[\s\S]*?inert[^>]*>\s*([^<]*)\s*<\/span>/g;

  const allMatches = [];
  let m;
  while ((m = EACH_RX.exec(html)) !== null) {
    allMatches.push({
      type: m[1],
      label: m[2],
      value: m[3].trim(),
      pos: m.index
    });
  }

  // Items have 11 consecutive fields: serving size, calories, fat, sat fat, trans fat,
  // cholesterol, sodium, carbs, fiber, sugar, protein
  const items = [];
  for (let i = 0; i < allMatches.length - 10; i++) {
    const group = allMatches.slice(i, i + 11);

    // Validate: all same type, index 1 is Calories
    if (group[0].type !== group[10].type) continue;
    if (!group[1].label.includes('Calorie') && !group[1].label.includes('calorie')) continue;

    const pos = group[0].pos;
    const cat = getCategory(pos, catPositions);
    if (!cat) { i += 10; continue; }

    // Find item name from preceding HTML
    const lookback = html.slice(Math.max(0, pos - 2500), pos);
    let name = null;

    if (group[0].type === 'menu_item') {
      // Main items: <a href="...chick-fil-a.com/...">NAME</a>
      const aRx = /<a\s+href="https:\/\/www\.chick-fil-a\.com\/[^"]*"[^>]*>([^<]+)<\/a>/g;
      let am;
      while ((am = aRx.exec(lookback)) !== null) name = am[1];
    } else {
      // Sub-items: <td data-wp-text="context.sub_item.title" tabindex="0">NAME</td>
      const tRx = /<td\s+data-wp-text="context\.sub_item\.title"\s+tabindex="0">\s*([^<]+)\s*<\/td>/g;
      let tm;
      while ((tm = tRx.exec(lookback)) !== null) name = tm[1];
    }

    if (!name) { i += 10; continue; }

    items.push({
      name: unescapeHtml(name),
      category: cat,
      calories: toNum(group[1].value),
      fat_g: toNum(group[2].value),
      sat_fat_g: toNum(group[3].value),
      carbs_g: toNum(group[7].value),
      fiber_g: toNum(group[8].value),
      sugar_g: toNum(group[9].value),
      protein_g: toNum(group[10].value),
    });

    i += 10; // skip to next group start
  }

  // Deduplicate
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.name}|${item.category}|${item.calories}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const apiResp = await fetch(CFA_API, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NSF-menu-refresh/1.0)' },
      signal: AbortSignal.timeout(25000),
    });

    if (!apiResp.ok) {
      return res.status(502).json({ error: `CFA API returned ${apiResp.status}` });
    }

    const apiData = await apiResp.json();
    const html = apiData?.[0]?.content?.rendered;
    if (!html) {
      return res.status(502).json({ error: 'No content in CFA API response' });
    }

    const items = parseNutritionHtml(html);
    if (!items.length) {
      return res.status(502).json({ error: 'Parser returned 0 items' });
    }

    return res.status(200).json({ items, count: items.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
