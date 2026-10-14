-- Defensas a nivel de base de datos. La aplicación ya hace lo correcto; esto garantiza que
-- un bug, un script manual o un atacante con la credencial de la app tampoco pueda romperlo.

-- 1) Tablas append-only: ni UPDATE, ni DELETE, ni TRUNCATE. -------------------------------
CREATE FUNCTION vv_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'la tabla % es append-only (% prohibido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER rounds_append_only BEFORE UPDATE OR DELETE ON rounds
  FOR EACH ROW EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint
CREATE TRIGGER rounds_no_truncate BEFORE TRUNCATE ON rounds
  FOR EACH STATEMENT EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_tx_append_only BEFORE UPDATE OR DELETE ON ledger_tx
  FOR EACH ROW EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_tx_no_truncate BEFORE TRUNCATE ON ledger_tx
  FOR EACH STATEMENT EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint
-- accounts se bloquea con SELECT … FOR UPDATE (que exige privilegio UPDATE), pero nunca se modifica.
CREATE TRIGGER accounts_immutable BEFORE UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION vv_append_only();
--> statement-breakpoint

-- 2) Cadena de saldos del jugador: balance_after = anterior + amount, y nunca negativo. -------
CREATE FUNCTION vv_ledger_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  acc_kind text;
  prev bigint;
BEGIN
  SELECT kind INTO acc_kind FROM accounts WHERE id = NEW.account_id;
  IF acc_kind <> 'player' THEN
    -- Cuentas de sistema: sin cadena (evita que todas las apuestas compitan por un mismo lock).
    IF NEW.balance_after IS NOT NULL THEN
      RAISE EXCEPTION 'las cuentas de sistema no llevan balance_after';
    END IF;
    RETURN NEW;
  END IF;

  -- Bloqueo (reentrante si la app ya lo tiene): serializa los movimientos de este jugador.
  PERFORM 1 FROM accounts WHERE id = NEW.account_id FOR UPDATE;
  SELECT balance_after INTO prev FROM ledger_entries
    WHERE account_id = NEW.account_id ORDER BY id DESC LIMIT 1;
  prev := COALESCE(prev, 0);

  IF NEW.balance_after IS DISTINCT FROM prev + NEW.amount THEN
    RAISE EXCEPTION 'cadena de saldo rota: % + % <> %', prev, NEW.amount, NEW.balance_after
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.balance_after < 0 THEN
    RAISE EXCEPTION 'saldo insuficiente' USING ERRCODE = 'check_violation', HINT = 'VV_INSUFFICIENT_FUNDS';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_chain BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION vv_ledger_chain();
--> statement-breakpoint

-- 3) Doble entrada: cada transacción suma cero. Se comprueba al COMMIT (DEFERRABLE),
--    porque durante la transacción las patas se insertan de una en una.
CREATE FUNCTION vv_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total FROM ledger_entries WHERE tx_id = NEW.tx_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'transacción % descuadrada (suma %)', NEW.tx_id, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vv_ledger_balanced();
--> statement-breakpoint

-- 4) seed_pairs: lo único que puede cambiar es el nonce (+1) y el revelado, que debe
--    corresponder al hash publicado. La BD comprueba el compromiso por sí misma.
CREATE FUNCTION vv_seed_pair_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'seed_pairs no se borran' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.server_seed_enc <> OLD.server_seed_enc
     OR NEW.server_seed_hash <> OLD.server_seed_hash OR NEW.client_seed <> OLD.client_seed
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'campo inmutable de seed_pairs modificado';
  END IF;
  IF OLD.status = 'revealed' THEN
    RAISE EXCEPTION 'un par revelado es definitivo';
  END IF;
  IF NEW.next_nonce NOT IN (OLD.next_nonce, OLD.next_nonce + 1) THEN
    RAISE EXCEPTION 'el nonce solo avanza de uno en uno';
  END IF;
  IF NEW.status = 'revealed' AND encode(sha256(decode(NEW.server_seed, 'hex')), 'hex') <> NEW.server_seed_hash THEN
    RAISE EXCEPTION 'la semilla revelada no corresponde al compromiso';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER seed_pairs_guard BEFORE UPDATE OR DELETE ON seed_pairs
  FOR EACH ROW EXECUTE FUNCTION vv_seed_pair_guard();
--> statement-breakpoint

-- 5) Cuentas de sistema (contrapartida de todas las apuestas y regalos).
INSERT INTO accounts (kind) VALUES ('house'), ('grants');
--> statement-breakpoint

-- 6) Privilegios mínimos para el rol de la aplicación.
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO velvet_app;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO velvet_app;
--> statement-breakpoint
GRANT UPDATE ON seed_pairs TO velvet_app;
--> statement-breakpoint
GRANT UPDATE ON accounts TO velvet_app;
--> statement-breakpoint
GRANT DELETE ON sessions TO velvet_app;
