// GET /api/floors
// Current OpenSea floor (cheapest listing) for each Gigaverse ROM Tier + Memory combination.
// Needs OPENSEA_API_KEY in Vercel's environment variables.
//
// Freshness: Vercel's CDN keeps the result for 1 hour, so everyone gets hourly-fresh floors.
// The page's Update button adds ?fresh=<time>, which skips that cache and asks OpenSea right away.

const SLUG = process.env.OPENSEA_SLUG || "gigaverse-roms-abstract";
const KEY = process.env.OPENSEA_API_KEY || "";

const COMBOS = [
  ["Silver", "8MB"], ["Silver", "16MB"], ["Silver", "32MB"],
  ["Gold", "32MB"], ["Gold", "64MB"], ["Gold", "128MB"],
  ["Void", "128MB"], ["Void", "256MB"], ["Void", "512MB"],
  ["Giga", null],
];

function readPrice(listing) {
  const cur = listing?.price?.current;
  if (!cur || cur.value == null) return null;
  const decimals = Number(cur.decimals ?? 18);
  const value = Number(BigInt(cur.value)) / 10 ** decimals;
  return { value, currency: cur.currency || "ETH" };
}

function readTokenId(listing) {
  const offer = listing?.protocol_data?.parameters?.offer?.[0];
  return offer?.identifierOrCriteria ?? null;
}

async function floorFor(tier, memory) {
  const traits = [{ traitType: "Tier", value: tier }];
  if (memory) traits.push({ traitType: "Memory", value: memory });
  const url =
    `https://api.opensea.io/api/v2/listings/collection/${SLUG}/best` +
    `?limit=1&traits=${encodeURIComponent(JSON.stringify(traits))}`;
  const r = await fetch(url, { headers: { accept: "application/json", "x-api-key": KEY } });
  if (!r.ok) throw new Error(`OpenSea returned HTTP ${r.status} for ${tier} ${memory || ""}`.trim());
  const j = await r.json();
  const first = (j.listings || [])[0];
  const price = first ? readPrice(first) : null;
  return {
    tier,
    memory,
    floor: price ? price.value : null,
    currency: price ? price.currency : null,
    tokenId: first ? readTokenId(first) : null,
  };
}

// GLHF collection on Ethereum: its floor is the default value of 1 GLHFER
const GLHF_CONTRACT = process.env.GLHF_CONTRACT || "0x7eeb9b28833934aa9f79da82d29aebfa29b779f3";
let glhfSlug = process.env.GLHF_SLUG || null;

async function os(path) {
  const r = await fetch("https://api.opensea.io/api/v2" + path, { headers: { accept: "application/json", "x-api-key": KEY } });
  if (!r.ok) throw new Error(`OpenSea returned HTTP ${r.status} for GLHF`);
  return r.json();
}

async function glhfFloor() {
  if (!glhfSlug) glhfSlug = (await os(`/chain/ethereum/contract/${GLHF_CONTRACT}`)).collection;
  if (!glhfSlug) throw new Error("Couldn't find the GLHF collection on OpenSea");
  // Cheapest live listing first; fall back to the collection stats floor
  try {
    const j = await os(`/listings/collection/${glhfSlug}/best?limit=1`);
    const p = readPrice((j.listings || [])[0]);
    if (p) return { slug: glhfSlug, floor: p.value, currency: p.currency };
  } catch {}
  const st = await os(`/collections/${glhfSlug}/stats`);
  const f = st?.total?.floor_price;
  return { slug: glhfSlug, floor: f ?? null, currency: st?.total?.floor_price_symbol || "ETH" };
}

// GLHFStrategy (GLHFSTR) ERC-20 on Ethereum, priced via GeckoTerminal (free, no key)
const STRATEGY = (process.env.GLHFSTR_CONTRACT || "0xae52e336f1cc779c2e647b82994e4d29ed4e0286").toLowerCase();
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

async function strategyPrice() {
  const r = await fetch(
    `https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${STRATEGY},${WETH}`,
    { headers: { accept: "application/json" } }
  );
  if (!r.ok) throw new Error(`GeckoTerminal returned HTTP ${r.status} for GLHFSTR`);
  const prices = (await r.json())?.data?.attributes?.token_prices || {};
  const usd = parseFloat(prices[STRATEGY]);
  const ethUsd = parseFloat(prices[WETH]);
  if (!(usd > 0) || !(ethUsd > 0)) throw new Error("No GLHFSTR price found on GeckoTerminal");
  return { symbol: "GLHFSTR", contract: STRATEGY, usd, ethUsd, eth: usd / ethUsd };
}

// ETH price in USD (for the ETH/USD switch), via GeckoTerminal WETH price
async function ethUsdPrice() {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/eth/token_price/${WETH}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`GeckoTerminal returned HTTP ${r.status} for the ETH price`);
  const v = parseFloat((await r.json())?.data?.attributes?.token_prices?.[WETH]);
  if (!(v > 0)) throw new Error("No ETH price found");
  return v;
}

export default async function handler(req, res) {
  if (!KEY) {
    return res.status(500).json({ error: "Floors need an OpenSea API key. Add OPENSEA_API_KEY in Vercel's environment variables and redeploy." });
  }
  const results = [];
  const errors = [];
  let glhf = null;
  let strategy = null;
  let ethUsd = null;
  const [g, st, eu] = await Promise.allSettled([glhfFloor(), strategyPrice(), ethUsdPrice()]);
  if (eu.status === "fulfilled") ethUsd = eu.value; else errors.push(eu.reason.message);
  if (g.status === "fulfilled") glhf = g.value; else errors.push(g.reason.message);
  if (st.status === "fulfilled") strategy = st.value; else errors.push(st.reason.message);
  // A few at a time, to stay under OpenSea's rate limit
  for (let i = 0; i < COMBOS.length; i += 3) {
    const batch = await Promise.allSettled(COMBOS.slice(i, i + 3).map(([t, m]) => floorFor(t, m)));
    batch.forEach((b, k) => {
      if (b.status === "fulfilled") results.push(b.value);
      else {
        const [t, m] = COMBOS[i + k];
        results.push({ tier: t, memory: m, floor: null, currency: null, tokenId: null });
        errors.push(b.reason.message);
      }
    });
  }
  if (errors.length === COMBOS.length) {
    return res.status(502).json({ error: errors[0] });
  }
  const fresh = "fresh" in req.query;
  res.setHeader(
    "Cache-Control",
    fresh ? "no-store" : "public, s-maxage=3600, stale-while-revalidate=600"
  );
  return res.status(200).json({ slug: SLUG, updatedAt: new Date().toISOString(), glhf, strategy, ethUsd, floors: results, errors });
}
