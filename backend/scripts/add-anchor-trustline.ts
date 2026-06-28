// One-time setup: add a trustline from the custodial ORGANIZER account to the
// anchor asset, so SEP-24 deposits can settle. Run once before the e2e test:
//   npx tsx scripts/add-anchor-trustline.ts
import dotenv from 'dotenv';
import { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';

dotenv.config();

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const ORGANIZER_SECRET = process.env.ORGANIZER_SECRET;
const ASSET_CODE = process.env.ANCHOR_ASSET_CODE || 'SRT';
const ASSET_ISSUER = process.env.ANCHOR_ASSET_ISSUER;

async function main() {
  if (!ORGANIZER_SECRET) throw new Error('Falta ORGANIZER_SECRET en .env');
  if (!ASSET_ISSUER) throw new Error('Falta ANCHOR_ASSET_ISSUER en .env');

  const keypair = Keypair.fromSecret(ORGANIZER_SECRET);
  const server = new Horizon.Server(HORIZON_URL);
  const asset = new Asset(ASSET_CODE, ASSET_ISSUER);

  const account = await server.loadAccount(keypair.publicKey());
  const already = account.balances.some(
    (b: any) => b.asset_code === ASSET_CODE && b.asset_issuer === ASSET_ISSUER,
  );
  if (already) {
    console.log(`Trustline ${ASSET_CODE} ya existe en ${keypair.publicKey()}`);
    return;
  }

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);

  const res = await server.submitTransaction(tx);
  console.log(`Trustline ${ASSET_CODE} añadido. tx: ${res.hash}`);
}

main().catch((e) => { console.error(e?.response?.data ?? e); process.exit(1); });
