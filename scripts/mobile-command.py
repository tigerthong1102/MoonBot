import subprocess
import sys

try:
    result = subprocess.run(sys.argv[2:], timeout=float(sys.argv[1]), check=False)
    sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
except subprocess.TimeoutExpired:
    print(f"Timed out after {sys.argv[1]}s: {sys.argv[2]}", file=sys.stderr)
    sys.exit(124)
