// GET /api/wallet?address=0x...
// Finds the Gigaverse ROMs a wallet holds on Abstract and returns their Tier + Memory.
//
// How it finds the wallet's tokens:
//   1. Asks the contract directly (balanceOf + tokenOfOwnerByIndex), which needs no API key.
//   2. If the contract doesn't support that, it uses the Etherscan V2 API (chain 2741 = Abstract),
//      which needs ETHERSCAN_API_KEY set in Vercel's environment variables.

const CONTRACT = (process.env.ROM_CONTRACT || "0x59eec556cef447e13edf4bfd3d4433d8dad8a7a5").toLowerCase();
const RPC_URL = process.env.ABSTRACT_RPC_URL || "https://api.mainnet.abs.xyz";
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || "";
const CHAIN_ID = 2741;

const SEL = {
  balanceOf: "0x70a08231",
  tokenOfOwnerByIndex: "0x2f745c59",
  tokenURI: "0xc87b56dd",
  ownerOf: "0x6352211e",
};

const pad = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const toHex = (n) => BigInt(n).toString(16);

let rpcId = 1;
async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
  });
  if (!res.ok) throw new Error(`Abstract RPC returned HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

const call = (data) => rpc("eth_call", [{ to: CONTRACT, data }, "latest"]);

function decodeString(hex) {
  const h = hex.replace(/^0x/, "");
  const offset = parseInt(h.slice(0, 64), 16) * 2;
  const len = parseInt(h.slice(offset, offset + 64), 16);
  return Buffer.from(h.slice(offset + 64, offset + 64 + len * 2), "hex").toString("utf8");
}

// Run async jobs with limited parallelism
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

async function tokensViaEnumerable(owner) {
  const bal = parseInt(await call(SEL.balanceOf + pad(owner)), 16);
  if (bal === 0) return [];
  const idx = Array.from({ length: bal }, (_, i) => i);
  return pool(idx, 8, async (i) =>
    BigInt(await call(SEL.tokenOfOwnerByIndex + pad(owner) + pad(toHex(i)))).toString()
  );
}

async function tokensViaEtherscan(owner) {
  if (!ETHERSCAN_KEY) {
    throw new Error(
      "This contract can't list tokens by owner directly. Add an ETHERSCAN_API_KEY in Vercel to enable wallet lookups."
    );
  }
  const held = new Set();
  let page = 1;
  // tokennfttx returns transfers oldest-first; replay them to get current holdings
  while (true) {
    const url =
      `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=account&action=tokennfttx` +
      `&contractaddress=${CONTRACT}&address=${owner}&page=${page}&offset=1000&sort=asc&apikey=${ETHERSCAN_KEY}`;
    const j = await (await fetch(url)).json();
    if (j.status !== "1") {
      if (/no transactions/i.test(j.message || "")) break;
      throw new Error(`Etherscan: ${j.result || j.message}`);
    }
    for (const t of j.result) {
      if (t.to.toLowerCase() === owner) held.add(t.tokenID);
      if (t.from.toLowerCase() === owner) held.delete(t.tokenID);
    }
    if (j.result.length < 1000) break;
    page++;
  }
  // Double-check ownership on-chain
  const ids = [...held];
  const owners = await pool(ids, 8, (id) => call(SEL.ownerOf + pad(toHex(id))).catch(() => null));
  return ids.filter((_, i) => owners[i] && "0x" + owners[i].slice(-40).toLowerCase() === owner);
}

function resolveUri(uri) {
  if (uri.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + uri.slice(7).replace(/^ipfs\//, "");
  if (uri.startsWith("ar://")) return "https://arweave.net/" + uri.slice(5);
  return uri;
}

async function metadata(id) {
  try {
    const uri = decodeString(await call(SEL.tokenURI + pad(toHex(id))));
    let json;
    if (uri.startsWith("data:application/json;base64,")) {
      json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString("utf8"));
    } else if (uri.startsWith("data:application/json")) {
      json = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)));
    } else {
      const r = await fetch(resolveUri(uri));
      json = await r.json();
    }
    const attrs = Object.fromEntries(
      (json.attributes || []).map((a) => [String(a.trait_type).toLowerCase(), String(a.value)])
    );
    return { id, tier: attrs.tier || null, memory: attrs.memory || null };
  } catch {
    return { id, tier: null, memory: null };
  }
}

export default async function handler(req, res) {
  const address = String(req.query.address || "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return res.status(400).json({ error: "That isn't a valid wallet address. It should start with 0x and be 42 characters long." });
  }
  try {
    let ids;
    try {
      ids = await tokensViaEnumerable(address);
    } catch {
      ids = await tokensViaEtherscan(address);
    }
    const roms = await pool(ids, 8, metadata);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ address, count: roms.length, roms });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Lookup failed." });
  }
}
