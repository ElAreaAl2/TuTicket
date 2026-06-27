/**
 * cleanup-user-activity.ts
 *
 * Borra la actividad de TODOS los usuarios para dejar la base limpia antes
 * del demo: tickets (Mis Entradas), órdenes (Mis Compras), reventas P2P,
 * carritos, holds, check-ins, PQRs, transaction_intents, eventos on-chain,
 * y resetea el inventario de sillas a AVAILABLE.
 *
 * NO toca: users, events, ticket_types, organizers, venues, secciones, seats,
 * ciudades ni categorías.
 *
 * Uso:
 *   tsx scripts/cleanup-user-activity.ts --dry-run   # solo muestra conteos
 *   tsx scripts/cleanup-user-activity.ts --yes       # ejecuta sin preguntar
 *   tsx scripts/cleanup-user-activity.ts             # pide confirmación
 */
import { PrismaClient } from '@prisma/client';
import { rpc } from '@stellar/stellar-sdk';
import readline from 'node:readline';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipPrompt = args.has('--yes') || args.has('-y');

async function counts() {
  const [
    tickets,
    orders,
    orderItems,
    payments,
    carts,
    cartItems,
    seatHolds,
    checkins,
    pqrMessages,
    pqrClaims,
    txIntents,
    onchainEvents,
    walletChallenges,
    seatsSoldOrHeld,
  ] = await Promise.all([
    prisma.tickets.count(),
    prisma.orders.count(),
    prisma.order_items.count(),
    prisma.payments.count(),
    prisma.carts.count(),
    prisma.cart_items.count(),
    prisma.seat_holds.count(),
    prisma.checkins.count(),
    prisma.pqr_claim_messages.count(),
    prisma.pqr_claims.count(),
    prisma.transaction_intents.count(),
    prisma.onchain_events.count(),
    prisma.wallet_challenges.count(),
    prisma.event_seat_inventory.count({ where: { status: { in: ['SOLD', 'HELD', 'BLOCKED'] } } }),
  ]);

  return {
    tickets,
    orders,
    orderItems,
    payments,
    carts,
    cartItems,
    seatHolds,
    checkins,
    pqrMessages,
    pqrClaims,
    txIntents,
    onchainEvents,
    walletChallenges,
    seatsSoldOrHeld,
  };
}

function printCounts(label: string, c: Awaited<ReturnType<typeof counts>>) {
  console.log(`\n[${label}]`);
  console.log(`  tickets ................. ${c.tickets}`);
  console.log(`  orders .................. ${c.orders}`);
  console.log(`  order_items ............. ${c.orderItems}`);
  console.log(`  payments ................ ${c.payments}`);
  console.log(`  carts ................... ${c.carts}`);
  console.log(`  cart_items .............. ${c.cartItems}`);
  console.log(`  seat_holds .............. ${c.seatHolds}`);
  console.log(`  checkins ................ ${c.checkins}`);
  console.log(`  pqr_claim_messages ...... ${c.pqrMessages}`);
  console.log(`  pqr_claims .............. ${c.pqrClaims}`);
  console.log(`  transaction_intents ..... ${c.txIntents}`);
  console.log(`  onchain_events .......... ${c.onchainEvents}`);
  console.log(`  wallet_challenges ....... ${c.walletChallenges}`);
  console.log(`  seats SOLD/HELD/BLOCKED . ${c.seatsSoldOrHeld}  (se resetean a AVAILABLE)`);
}

async function confirm(): Promise<boolean> {
  if (skipPrompt) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\n¿Confirmar borrado? Escribe "BORRAR" para continuar: ', answer => {
      rl.close();
      resolve(answer.trim() === 'BORRAR');
    });
  });
}

async function purge() {
  // Consultar el ledger actual ANTES de la transacción (Soroban RPC).
  const server = new rpc.Server(RPC_URL);
  const latestInfo = await server.getLatestLedger();
  const latestLedger = latestInfo.sequence;
  console.log(`Avanzando indexer cursor a ledger ${latestLedger} (red: ${RPC_URL}).`);

  // El orden importa por las FKs (tickets -> order_items -> orders, etc.)
  await prisma.$transaction(
    async tx => {
      await tx.checkins.deleteMany({});
      await tx.pqr_claim_messages.deleteMany({});
      await tx.pqr_claims.deleteMany({});

      // tickets antes que order_items (FK fk_tickets_order_item)
      await tx.tickets.deleteMany({});

      await tx.payments.deleteMany({});
      await tx.order_items.deleteMany({});
      await tx.orders.deleteMany({});

      // holds antes que carts e inventory updates
      await tx.seat_holds.deleteMany({});
      await tx.cart_items.deleteMany({});
      await tx.carts.deleteMany({});

      await tx.transaction_intents.deleteMany({});
      await tx.onchain_events.deleteMany({});
      await tx.wallet_challenges.deleteMany({});

      // Liberar sillas vendidas/bloqueadas/en hold
      await tx.event_seat_inventory.updateMany({
        where: { status: { in: ['SOLD', 'HELD', 'BLOCKED'] } },
        data: { status: 'AVAILABLE', updated_at: new Date() },
      });

      // El indexer reproyecta tickets desde la blockchain, así que apuntamos el
      // cursor al ledger actual de la red. Si lo dejamos en 0, vuelve a leer
      // todos los eventos pasados y recrea tickets que ya borramos (los NFTs
      // siguen vivos on-chain y no se pueden borrar desde la DB).
      await tx.indexer_state.upsert({
        where: { id: 1 },
        update: { last_ledger: latestLedger, updated_at: new Date() },
        create: { id: 1, last_ledger: latestLedger },
      });
    },
    { timeout: 120_000 },
  );
}

async function main() {
  console.log('cleanup-user-activity: prepara la base para grabar demo.');
  console.log(`DB: ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@') ?? '(sin DATABASE_URL)'}`);

  const before = await counts();
  printCounts('ANTES', before);

  if (dryRun) {
    console.log('\n--dry-run: no se ejecuta ningún borrado.');
    return;
  }

  const ok = await confirm();
  if (!ok) {
    console.log('Cancelado. No se borró nada.');
    return;
  }

  console.log('\nEjecutando limpieza en transacción...');
  await purge();

  const after = await counts();
  printCounts('DESPUÉS', after);
  console.log('\nListo. Usuarios, eventos, tipos de boleta y sillas (catálogo) intactos.');
}

main()
  .catch(err => {
    console.error('cleanup-user-activity falló:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
