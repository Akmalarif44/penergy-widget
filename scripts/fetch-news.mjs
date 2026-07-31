/* =====================================================================
   fetch-news.mjs
   Pulls Malaysian oil & gas headlines and writes news.json.
   Runs on GitHub Actions once a day - see .github/workflows/update-news.yml
   No dependencies. Needs Node 18+ (built-in fetch).
   ===================================================================== */

import { writeFile, readFile } from 'node:fs/promises';

/* ---------------------------------------------------------------------
   1. WHAT TO SEARCH FOR
   ------------------------------------------------------------------- */
const QUERIES = [
  'Malaysia oil and gas',
  'Petronas Malaysia upstream',
  '"Petra Energy" OR "Petra Resources"',
  'Malaysia LNG Petronas',
  'Petronas Carigali contract'
];

/* ---------------------------------------------------------------------
   2. ONLY THESE PUBLISHERS ARE ACCEPTED
   ------------------------------------------------------------------- */
const ALLOWED = [
  'thestar.com.my', 'nst.com.my', 'theedgemalaysia.com', 'bernama.com',
  'malaymail.com', 'freemalaysiatoday.com', 'businesstoday.com.my',
  'thesundaily.my', 'themalaysianreserve.com', 'klsescreener.com',
  'offshore-energy.biz', 'rigzone.com', 'upstreamonline.com',
  'oedigital.com', 'aogdigital.com', 'worldoil.com', 'oilprice.com',
  'bairdmaritime.com', 'splash247.com', 'lngprime.com', 'energyvoice.com',
  'oilandgasmiddleeast.com', 'hartenergy.com'
];

/* ---------------------------------------------------------------------
   3. PHOTO PICKING — verified Pexels IDs
   ------------------------------------------------------------------- */
const PHOTO_RULES = [
  { words: ['lng', 'liquefied', 'gas sale', 'shizuoka', 'cargo'],
    photo: 15893881, palette: 'navy',  motif: 'tank' },
  { words: ['tanker', 'vessel', 'shipping', 'strait', 'hormuz', 'supply'],
    photo: 13178759, palette: 'ocean', motif: 'tanker' },
  { words: ['refinery', 'petrochemical', 'downstream', 'pengerang'],
    photo: 15970032, palette: 'red',   motif: 'pipeline' },
  { words: ['hook-up', 'commissioning', 'huc', 'fabrication', 'maintenance'],
    photo: 15970028, palette: 'red',   motif: 'pipeline' },
  { words: ['earnings', 'profit', 'results', 'revenue', 'bursa', 'quarter', 'rhb', 'analyst'],
    photo: 29708259, palette: 'slate', motif: 'chart' },
  { words: ['bid round', 'psc', 'exploration', 'block', 'licensing', 'award'],
    photo: 15961091, palette: 'ocean', motif: 'derrick' },
  { words: ['sarawak', 'miri', 'bintulu', 'sabah'],
    photo: 9336586,  palette: 'teal',  motif: 'platform' },
  { words: ['offshore', 'platform', 'rig', 'drilling', 'field', 'oilfield'],
    photo: 36594202, palette: 'teal',  motif: 'wellhead' },
  { words: ['conference', 'forum', 'summit', 'opinion', 'outlook'],
    photo: 29708266, palette: 'navy',  motif: 'expo' }
];

const DEFAULTS = [
  { photo: 9336590,  palette: 'ocean', motif: 'platform' },
  { photo: 16830015, palette: 'teal',  motif: 'derrick' },
  { photo: 16169312, palette: 'navy',  motif: 'platform' }
];

const MAX_ITEMS = 10;
const MAX_AGE_DAYS = 45;

/* ------------------------------------------------------------------ */

function rssUrl(q){
  return 'https://news.google.com/rss/search?q=' +
         encodeURIComponent(q + ' when:60d') +
         '&hl=en-MY&gl=MY&ceid=MY:en';
}

function tagText(block, tag){
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  if(!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function sourceDomain(block){
  const m = block.match(/<source[^>]*url="([^"]+)"/i);
  if(!m) return '';
  try { return new URL(m[1]).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function pickArt(title, i){
  const t = title.toLowerCase();
  for(const rule of PHOTO_RULES){
    if(rule.words.some(w => t.includes(w))){
      return { photo: rule.photo, palette: rule.palette, motif: rule.motif };
    }
  }
  return DEFAULTS[i % DEFAULTS.length];
}

async function fetchQuery(q){
  const res = await fetch(rssUrl(q), {
    headers: { 'User-Agent': 'penergy-widget/1.0 (+github actions)' }
  });
  if(!res.ok) throw new Error(q + ' -> HTTP ' + res.status);
  const xml = await res.text();
  return xml.split(/<item>/i).slice(1).map(b => b.split(/<\/item>/i)[0]);
}

async function main(){
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const seen = new Map();

  for(const q of QUERIES){
    let blocks = [];
    try { blocks = await fetchQuery(q); }
    catch(err){ console.warn('skipped:', err.message); continue; }

    for(const b of blocks){
      const domain = sourceDomain(b);
      if(!ALLOWED.includes(domain)) continue;

      const link = tagText(b, 'link');
      if(!link) continue;

      const when = Date.parse(tagText(b, 'pubDate'));
      if(!when || when < cutoff) continue;

      let title = tagText(b, 'title').replace(/\s+-\s+[^-]{2,40}$/, '').trim();
      if(title.length < 20 || title.length > 110) continue;

      const key = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
      if(seen.has(key)) continue;

      seen.set(key, {
        title,
        source: tagText(b, 'source') || domain,
        date: new Date(when).toISOString().slice(0, 10),
        link,
        when
      });
    }
  }

  const items = [...seen.values()]
    .sort((a, b) => b.when - a.when)
    .slice(0, MAX_ITEMS)
    .map((it, i) => {
      const art = pickArt(it.title, i);
      return {
        title:  it.title,
        source: it.source,
        date:   it.date,
        link:   it.link,
        photo:   art.photo,
        palette: art.palette,
        motif:   art.motif
      };
    });

  if(items.length < 5){
    console.error('Only ' + items.length + ' items passed the filters - keeping the existing news.json');
    try { await readFile('news.json'); process.exit(0); }
    catch { console.error('...and there is no existing news.json'); process.exit(1); }
  }

  await writeFile('news.json', JSON.stringify(items, null, 2) + '\n');
  console.log('Wrote ' + items.length + ' items. Newest: ' + items[0].date + ' - ' + items[0].title);
}

main().catch(err => { console.error(err); process.exit(1); });
