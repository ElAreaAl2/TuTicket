// Anchor Platform (SEP-10 auth + SEP-24 interactive deposit) client.
// On/off-ramp integration: fiat -> Stellar asset, settled into the custodial
// ORGANIZER account. Uses the global fetch (Node 18+) and @stellar/stellar-sdk
// already in the project — no new dependency.
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';

// Read env lazily inside functions, not at module load: imported modules are
// evaluated before the entrypoint runs dotenv.config(), so top-level consts
// would capture empty strings.
const cfg = () => ({
  sep10: process.env.ANCHOR_SEP10_URL || '',
  sep24: process.env.ANCHOR_SEP24_URL || '',
  assetCode: process.env.ANCHOR_ASSET_CODE || 'SRT',
  assetIssuer: process.env.ANCHOR_ASSET_ISSUER || '',
});

export function isAnchorConfigured(): boolean {
  const { sep10, sep24 } = cfg();
  return Boolean(sep10 && sep24);
}

// SEP-10: fetch challenge, sign with the custodial keypair, exchange for a JWT.
async function getToken(keypair: Keypair): Promise<string> {
  const { sep10 } = cfg();
  const account = keypair.publicKey();
  const challengeRes = await fetch(`${sep10}?account=${account}`);
  if (!challengeRes.ok) throw new Error(`SEP-10 challenge failed: ${challengeRes.status}`);
  const { transaction, network_passphrase } = await challengeRes.json();

  const tx = TransactionBuilder.fromXDR(transaction, network_passphrase);
  tx.sign(keypair);

  const tokenRes = await fetch(sep10, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction: tx.toEnvelope().toXDR('base64') }),
  });
  if (!tokenRes.ok) throw new Error(`SEP-10 token failed: ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  if (!token) throw new Error('SEP-10 returned no token');
  return token;
}

// SEP-24: open an interactive deposit. Returns the hosted URL the buyer pays at
// and the transaction id we poll for completion.
// amount is intentionally not sent: the SEP-24 interactive flow collects it, and
// hard amounts can exceed a test asset's per-tx limit. Order total stays in COP.
export async function startDeposit(
  keypair: Keypair,
): Promise<{ interactiveUrl: string; transactionId: string }> {
  const { sep24, assetCode, assetIssuer } = cfg();
  const token = await getToken(keypair);
  const body: Record<string, string> = {
    asset_code: assetCode,
    account: keypair.publicKey(),
  };
  if (assetIssuer) body.asset_issuer = assetIssuer;

  const res = await fetch(`${sep24}/transactions/deposit/interactive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SEP-24 deposit failed: ${res.status}`);
  const data = await res.json();
  if (!data.url || !data.id) throw new Error('SEP-24 deposit returned no url/id');
  return { interactiveUrl: data.url, transactionId: data.id };
}

export async function getStatus(keypair: Keypair, transactionId: string): Promise<string> {
  const { sep24 } = cfg();
  const token = await getToken(keypair);
  const res = await fetch(`${sep24}/transaction?id=${encodeURIComponent(transactionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`SEP-24 status failed: ${res.status}`);
  const data = await res.json();
  return data.transaction?.status ?? 'unknown';
}

// Map a SEP-24 transaction status to our order outcome.
// Full status list: developers.stellar.org/docs/anchoring-assets/sep-24
export function mapStatus(sep24Status: string): 'PAID' | 'FAILED' | 'PENDING' {
  if (sep24Status === 'completed') return 'PAID';
  if (sep24Status === 'error' || sep24Status === 'refunded' || sep24Status === 'expired') return 'FAILED';
  return 'PENDING';
}

// ponytail: re-auth (getToken) on every call instead of caching the JWT.
// Cache by keypair with the token's exp if anchor calls ever get chatty.

// Runnable self-check: node -r ts-node/register src/anchor.ts  (or via tsx)
function demo() {
  const assert = (c: boolean, m: string) => { if (!c) throw new Error(m); };
  assert(mapStatus('completed') === 'PAID', 'completed -> PAID');
  assert(mapStatus('error') === 'FAILED', 'error -> FAILED');
  assert(mapStatus('expired') === 'FAILED', 'expired -> FAILED');
  assert(mapStatus('refunded') === 'FAILED', 'refunded -> FAILED');
  assert(mapStatus('pending_user_transfer_start') === 'PENDING', 'in-flight -> PENDING');
  assert(mapStatus('incomplete') === 'PENDING', 'incomplete -> PENDING');
  console.log('anchor.ts self-check passed');
}

if (require.main === module) demo();
