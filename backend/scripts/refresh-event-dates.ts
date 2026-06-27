/**
 * refresh-event-dates.ts
 *
 * Reactiva los eventos que aparecen como "finalizados" en la cartelera demo,
 * sin tocar el código de la tesis (este es un script de operaciones, igual que
 * cleanup-user-activity.ts).
 *
 * Un evento se ve finalizado cuando:
 *   - status != 'PUBLISHED' (p. ej. COMPLETED -> "El evento ya finalizó"), o
 *   - starts_at < ahora     (-> "El evento ya pasó").
 *
 * Este script toma SOLO los eventos finalizados (COMPLETED o con starts_at en
 * el pasado), los reparte en fechas futuras conservando su hora del día y su
 * orden relativo, y los vuelve a dejar en PUBLISHED. También alinea las
 * ventanas de venta (sales_start_at = ahora, sales_end_at = nueva fecha) tanto
 * del evento como de sus tipos de boleta, para que sean comprables.
 *
 * NO toca eventos ya futuros ni los CANCELLED (esos se cancelaron a propósito).
 *
 * Uso:
 *   tsx scripts/refresh-event-dates.ts              # dry-run (no escribe nada)
 *   tsx scripts/refresh-event-dates.ts --apply      # aplica los cambios
 *
 * Parámetros opcionales:
 *   --start-in-days=7   primer evento a N días desde hoy (default 7)
 *   --gap-days=4        separación entre eventos reactivados (default 4)
 */
import { PrismaClient, type event_status } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const apply = args.includes('--apply');
function numArg(name: string, def: number): number {
  const a = args.find(x => x.startsWith(`--${name}=`));
  if (!a) return def;
  const v = Number(a.split('=')[1]);
  return Number.isFinite(v) ? v : def;
}
const startInDays = numArg('start-in-days', 7);
const gapDays = numArg('gap-days', 4);

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_DURATION_MS = 4 * 60 * 60 * 1000;

/** Nueva fecha = fecha base (ahora + offset días) conservando la hora UTC original. */
function rebaseDate(original: Date, base: Date): Date {
  const d = new Date(base);
  d.setUTCHours(
    original.getUTCHours(),
    original.getUTCMinutes(),
    original.getUTCSeconds(),
    original.getUTCMilliseconds(),
  );
  return d;
}

async function main() {
  const masked = process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ':***@') ?? '(sin DATABASE_URL)';
  console.log(`refresh-event-dates  (${apply ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`DB: ${masked}`);

  const now = new Date();

  // Eventos "finalizados": COMPLETED o con starts_at en el pasado.
  // Excluimos CANCELLED (cancelados a propósito) y DRAFT (fixtures ocultos).
  const stale = await prisma.events.findMany({
    where: {
      OR: [
        { status: 'COMPLETED' as event_status },
        { AND: [{ starts_at: { lt: now } }, { status: { in: ['PUBLISHED', 'SOLD_OUT'] as event_status[] } }] },
      ],
    },
    select: { id: true, slug: true, title: true, status: true, starts_at: true },
    orderBy: { starts_at: 'asc' },
  });

  if (stale.length === 0) {
    console.log('\nNo hay eventos finalizados que reactivar. Nada que hacer.');
    return;
  }

  console.log(`\nEventos finalizados a reactivar: ${stale.length}\n`);

  const plan = stale.map((ev, i) => {
    const base = new Date(now.getTime() + (startInDays + i * gapDays) * DAY_MS);
    const newStartsAt = rebaseDate(ev.starts_at, base);
    const newEndsAt = new Date(newStartsAt.getTime() + EVENT_DURATION_MS);
    return { ev, newStartsAt, newEndsAt };
  });

  for (const { ev, newStartsAt } of plan) {
    console.log(
      `  ${ev.starts_at.toISOString().slice(0, 10)} ${String(ev.status).padEnd(10)} -> ` +
        `${newStartsAt.toISOString().slice(0, 10)} PUBLISHED   ${ev.slug}`,
    );
  }

  if (!apply) {
    console.log('\n--dry-run: no se escribió nada. Repite con --apply para aplicar.');
    return;
  }

  console.log('\nAplicando cambios...');
  let updated = 0;
  for (const { ev, newStartsAt, newEndsAt } of plan) {
    await prisma.$transaction(async tx => {
      await tx.events.update({
        where: { id: ev.id },
        data: {
          status: 'PUBLISHED' as event_status,
          starts_at: newStartsAt,
          ends_at: newEndsAt,
          sales_start_at: now,
          sales_end_at: newStartsAt,
          updated_at: new Date(),
        },
      });
      await tx.event_ticket_types.updateMany({
        where: { event_id: ev.id },
        data: {
          sales_start_at: now,
          sales_end_at: newStartsAt,
          is_active: true,
          updated_at: new Date(),
        },
      });
      // Realinea la ventana de reventa: si el evento tenía una política con
      // resale_ends_at anclado a la fecha vieja, quedaría en el pasado y la
      // reventa saldría "ya finalizó". La movemos junto con el evento.
      // updateMany es no-op si el evento no tiene política de reventa.
      await tx.event_resale_policies.updateMany({
        where: { event_id: ev.id },
        data: {
          resale_starts_at: now,
          resale_ends_at: newStartsAt,
          updated_at: new Date(),
        },
      });
    });
    updated += 1;
    console.log(`  OK: ${ev.slug}`);
  }

  console.log(`\nListo. ${updated} eventos reactivados y republicados.`);
}

main()
  .catch(err => {
    console.error('refresh-event-dates falló:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
