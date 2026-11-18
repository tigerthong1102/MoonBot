import subprocess
import sys

label = " ".join(sys.argv[2:5]) if sys.argv[2:4] == ["xcrun", "simctl"] else sys.argv[2]
print(f"Running: {label}", file=sys.stderr, flush=True)

try:
    result = subprocess.run(sys.argv[2:], timeout=float(sys.argv[1]), check=False)
    sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
except subprocess.TimeoutExpired:
    print(f"Timed out after {sys.argv[1]}s: {label}", file=sys.stderr)
    sys.exit(124)
