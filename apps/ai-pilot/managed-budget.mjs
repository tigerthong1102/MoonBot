export function initializeManagedBudget(ledger) {
  const db = ledger.db;
  ledger.tx(() => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='managed_daily_cost'").get()) return;
    db.exec(`
      CREATE TABLE managed_daily_cost(day INTEGER PRIMARY KEY,micros INTEGER NOT NULL);
      INSERT INTO managed_daily_cost SELECT created/86400000,sum(cost) FROM requests WHERE state='settled' GROUP BY created/86400000;
      CREATE TRIGGER managed_cost_insert AFTER INSERT ON requests WHEN NEW.state='settled' BEGIN
        INSERT INTO managed_daily_cost VALUES (NEW.created/86400000,NEW.cost)
        ON CONFLICT(day) DO UPDATE SET micros=micros+excluded.micros;
      END;
      CREATE TRIGGER managed_cost_update AFTER UPDATE OF state,cost,created ON requests
      WHEN OLD.state='settled' OR NEW.state='settled' BEGIN
        UPDATE managed_daily_cost SET micros=micros-OLD.cost WHERE OLD.state='settled' AND day=OLD.created/86400000;
        INSERT INTO managed_daily_cost SELECT NEW.created/86400000,NEW.cost WHERE NEW.state='settled'
        ON CONFLICT(day) DO UPDATE SET micros=micros+excluded.micros;
      END;
      CREATE TRIGGER managed_cost_delete AFTER DELETE ON requests WHEN OLD.state='settled' BEGIN
        UPDATE managed_daily_cost SET micros=micros-OLD.cost WHERE day=OLD.created/86400000;
      END;
    `);
  });
}

export function budgetExposure(db, now = Date.now()) {
  const day = Math.floor(now / 86400000), month = new Date(now);
  month.setUTCDate(1);
  const firstDay = Math.floor(+month / 86400000);
  const paid = db.prepare(`SELECT coalesce(sum(micros),0) month,
    coalesce(sum(CASE WHEN day>=? THEN micros ELSE 0 END),0) day FROM managed_daily_cost WHERE day>=?`).get(day,firstDay);
  const held = db.prepare(`SELECT coalesce(sum((SELECT sum(held) FROM allocations a WHERE a.owner=r.owner AND a.request=r.id)),0) n
    FROM requests r WHERE r.state='held'`).get().n;
  return { day:paid.day+held, month:paid.month+held, held };
}
