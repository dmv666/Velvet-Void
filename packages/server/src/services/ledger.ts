import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client.js';
import { accounts, ledgerEntries, ledgerTx, LEDGER_KINDS } from '../db/schema.js';

/**
 * Ledger de doble entrada. El saldo NO es un campo que se actualiza: es el `balance_after`
 * de la última entrada inmutable de la cuenta. Toda operación mueve dinero de una cuenta a
 * otra (jugador ↔ casa, regalos → jugador) y cada transacción suma cero.
 */

type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface Party {
  accountId: string;
  /** Solo las cuentas de jugador llevan cadena de saldos. */
  isPlayer: boolean;
}

/**
 * Bloquea la cuenta del jugador hasta el final de la transacción (SELECT … FOR UPDATE).
 * Cualquier otra petición del mismo jugador espera aquí: es lo que impide el doble gasto
 * por carrera (dos apuestas leyendo el mismo saldo a la vez).
 */
export async function lockPlayerAccount(tx: Tx, userId: string): Promise<Party> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.kind, 'player')))
    .for('update');
  if (!row) throw new Error(`el usuario ${userId} no tiene cuenta de jugador`);
  return { accountId: row.id, isPlayer: true };
}

/** Id de la cuenta del jugador SIN bloquear (para lecturas). */
export async function playerAccountId(db: Pick<Tx, 'select'>, userId: string): Promise<string> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.kind, 'player')));
  if (!row) throw new Error(`el usuario ${userId} no tiene cuenta de jugador`);
  return row.id;
}

const systemCache = new Map<string, string>();
export async function systemAccount(tx: Tx, kind: 'house' | 'grants'): Promise<Party> {
  let id = systemCache.get(kind);
  if (!id) {
    const [row] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(isNull(accounts.userId), eq(accounts.kind, kind)));
    if (!row) throw new Error(`falta la cuenta de sistema ${kind}`);
    id = row.id;
    systemCache.set(kind, id);
  }
  return { accountId: id, isPlayer: false };
}

export async function getBalance(tx: Pick<Tx, 'select'>, accountId: string): Promise<bigint> {
  const [row] = await tx
    .select({ balance: ledgerEntries.balanceAfter })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.accountId, accountId))
    .orderBy(desc(ledgerEntries.id))
    .limit(1);
  return row?.balance ?? 0n;
}

/**
 * Mueve `amount` de `from` a `to` como UNA transacción contable con dos patas.
 * Precondición: si alguna parte es jugador, su cuenta ya está bloqueada por el llamante.
 */
export async function transfer(
  tx: Tx,
  args: { kind: LedgerKind; from: Party; to: Party; amount: bigint; roundId?: string },
): Promise<void> {
  if (args.amount <= 0n) throw new Error('el importe debe ser positivo');
  const [t] = await tx
    .insert(ledgerTx)
    .values({ kind: args.kind, roundId: args.roundId ?? null })
    .returning({ id: ledgerTx.id });
  const legs: [Party, bigint][] = [
    [args.from, -args.amount],
    [args.to, args.amount],
  ];
  for (const [party, amount] of legs) {
    const balanceAfter = party.isPlayer ? (await getBalance(tx, party.accountId)) + amount : null;
    await tx.insert(ledgerEntries).values({ txId: t!.id, accountId: party.accountId, amount, balanceAfter });
  }
}
