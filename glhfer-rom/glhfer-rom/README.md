# GLHFER ROM Value

Calculator + wallet checker for Gigaverse ROMs on Abstract.
24 points = 1 GLHFER. Paste a wallet address to see which ROMs it holds and what they're worth.

## Files
- `index.html` — the page (calculator, wallet box, price list)
- `api/wallet.js` — server function: `/api/wallet?address=0x…`
- `api/floors.js` — server function: `/api/floors` (OpenSea floor per Tier + Memory)
- `vercel.json`, `package.json` — Vercel config (no dependencies to install)

## Deploy on Vercel
1. Create a free account on github.com and make a new repository (e.g. `glhfer-rom`).
2. Upload these files to it ("Add file" → "Upload files", drag the whole folder contents in, commit).
3. Create a free account on vercel.com and sign in with GitHub.
4. Click **Add New → Project**, pick the repo, leave every setting as is, click **Deploy**.
5. Your site is live at `https://<project-name>.vercel.app`.

Every later change you commit to GitHub goes live automatically.

## Floor prices (needs an OpenSea API key)
The price list shows the current OpenSea floor for each Tier + Memory, and the wallet check shows what its ROMs are worth at floor.
1. Get a free API key from OpenSea (opensea.io → your profile → Settings → Developer, or docs.opensea.io).
2. In Vercel: Project → **Settings → Environment Variables**, add `OPENSEA_API_KEY` with your key.
3. Redeploy (Deployments → ⋯ → Redeploy).

Floors refresh on their own every hour. The **Update floors** button fetches them right away.
The **Set 1 GLHFER = Void 128 MB floor** button fills in the GLHFER value from the market.

## If the wallet check says it needs an API key
The checker first asks the ROM contract directly which tokens a wallet holds (no key needed).
If the contract doesn't support that, it falls back to the Etherscan API:
1. Get a free key at etherscan.io/myapikey.
2. In Vercel: Project → **Settings → Environment Variables**, add `ETHERSCAN_API_KEY` with your key.
3. Redeploy (Deployments → ⋯ → Redeploy).

## Optional settings (environment variables)
- `ROM_CONTRACT` — defaults to `0x59eec556cef447e13edf4bfd3d4433d8dad8a7a5`
- `ABSTRACT_RPC_URL` — defaults to `https://api.mainnet.abs.xyz`
- `OPENSEA_SLUG` — defaults to `gigaverse-roms-abstract`

## Changing point values
Edit the `ROMS` list near the top of the script in `index.html`.
