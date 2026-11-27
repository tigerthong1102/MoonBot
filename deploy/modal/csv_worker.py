"""One bounded read-only workload on a scale-to-zero Modal Function."""
import csv
import hashlib
import io
import time

import modal

app = modal.App("startupbot-csv-inspector")
MAX_BYTES = 1024 * 1024
_first_invocation = True


@app.function(image=modal.Image.debian_slim(python_version="3.13"),
              cpu=(0.125, 0.125), memory=(256, 256), min_containers=0, max_containers=1,
              buffer_containers=0, scaledown_window=2, retries=0, startup_timeout=60,
              timeout=30, block_network=True, restrict_modal_access=True)
def inspect_csv(data: bytes) -> dict:
    global _first_invocation
    started = time.monotonic()
    first = _first_invocation
    _first_invocation = False
    if not isinstance(data, bytes) or not 0 < len(data) <= MAX_BYTES:
        raise ValueError("CSV input must fit within 1 MiB.")
    csv.field_size_limit(MAX_BYTES)
    reader = csv.reader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True)
    header = next(reader, [])
    if not header:
        raise ValueError("CSV requires a header.")
    count = mismatched = 0
    for row in reader:
        count += 1
        mismatched += len(row) != len(header)
    return {"sha256": hashlib.sha256(data).hexdigest(), "inputBytes": len(data),
            "dataRows": count, "columns": len(header), "inconsistentRows": mismatched,
            "firstCallInContainer": first, "workerSeconds": time.monotonic() - started}
