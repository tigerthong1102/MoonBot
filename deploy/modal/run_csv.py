"""Submit a single CSV to a deployed worker and record per-attempt cost evidence locally."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import time
import uuid


def estimate(result, elapsed, rates):
    for key in ("containerUsdPerSecond", "egressUsdPerGB", "storageUsdPerJob"):
        v = rates[key]
        if type(v) not in (float, int) or not math.isfinite(v) or v < 0:
            raise ValueError("Cost assumptions must be finite nonnegative numbers.")
    size = len(json.dumps(result, separators=(",", ":")).encode())
    worker = result["workerSeconds"]
    overhead = max(0, elapsed - worker)
    compute = worker * rates["containerUsdPerSecond"]
    egress = size / 1_000_000_000 * rates["egressUsdPerGB"]
    return {"elapsedSeconds": elapsed, "unattributedQueueColdAndNetworkSeconds": overhead,
            "logicalResultBytes": size, "assumedStorageUsd": rates["storageUsdPerJob"],
            "workerEstimateUsd": compute, "logicalEgressEstimateUsd": egress,
            "estimateUsd": compute + egress + rates["storageUsdPerJob"],
            "estimateIncludingRoundTripAndTwoIdleSecondsUsd":
                (elapsed + 2) * rates["containerUsdPerSecond"] + egress + rates["storageUsdPerJob"]}


def execute(db, job, data, rates, retry, invoke):
    if not data or len(data) > 1024 * 1024:
        raise ValueError("CSV input must fit within 1 MiB.")
    # Validate assumptions before a billable action.
    estimate({"workerSeconds": 0}, 0, rates)
    digest = hashlib.sha256(data).hexdigest()
    db.execute("""CREATE TABLE IF NOT EXISTS attempts(job TEXT, attempt INTEGER, digest TEXT,
                  receipt TEXT, PRIMARY KEY(job,attempt))""")
    db.execute("BEGIN IMMEDIATE")
    try:
        rows = db.execute("SELECT digest,receipt FROM attempts WHERE job=? ORDER BY attempt", (job,)).fetchall()
        if rows and rows[0][0] != digest:
            raise ValueError("This job ID already refers to different input bytes.")
        if rows and not retry:
            db.commit()
            return [json.loads(row[1]) for row in rows]
        number = len(rows) + 1
        record = {"job": job, "attempt": number, "status": "unconfirmed", "rates": rates,
                  "issuedAtUnix": time.time(), "sha256": digest}
        db.execute("INSERT INTO attempts VALUES (?,?,?,?)", (job, number, digest, json.dumps(record)))
        db.commit()
    except Exception:
        db.rollback()
        raise
    start = time.monotonic()
    try:
        result = invoke(data)
        if result["sha256"] != digest:
            raise ValueError("Worker result does not match the submitted bytes.")
        record.update(result=result, cost=estimate(result, time.monotonic() - start, rates), status="completed")
    except Exception as exc:
        record.update(elapsedSeconds=time.monotonic() - start, errorType=type(exc).__name__)
    with db:
        db.execute("UPDATE attempts SET receipt=? WHERE job=? AND attempt=?", (json.dumps(record), job, number))
    return [json.loads(row[0]) for row in db.execute("SELECT receipt FROM attempts WHERE job=? ORDER BY attempt", (job,))]


if __name__ == "__main__":
    import modal

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--rates", required=True, type=Path)
    parser.add_argument("--job", default=str(uuid.uuid4()))
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    if not args.csv.is_file():
        parser.error("Choose a regular CSV file.")
    with args.csv.open("rb") as stream:
        data = stream.read(1024 * 1024 + 1)
    os.umask(0o077)
    with sqlite3.connect(args.ledger) as db:
        fn = modal.Function.from_name("startupbot-csv-inspector", "inspect_csv")
        receipts = execute(db, args.job, data, json.loads(args.rates.read_text()), args.retry, fn.remote)
    print(json.dumps(receipts, indent=2))
    raise SystemExit(0 if receipts[-1]["status"] == "completed" else 1)
