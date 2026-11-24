-- Prize competitions are denominated in Nigerian naira. Keep this invariant
-- in the database as well as the Worker so a future operations script cannot
-- create a non-NGN payout by bypassing the API.
CREATE TRIGGER IF NOT EXISTS competition_payouts_currency_ngn_insert
BEFORE INSERT ON competition_payouts
FOR EACH ROW WHEN NEW.currency <> 'NGN'
BEGIN
  SELECT RAISE(ABORT, 'competition payout currency must be NGN');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS competition_payouts_currency_ngn_update
BEFORE UPDATE OF currency ON competition_payouts
FOR EACH ROW WHEN NEW.currency <> 'NGN'
BEGIN
  SELECT RAISE(ABORT, 'competition payout currency must be NGN');
END;
