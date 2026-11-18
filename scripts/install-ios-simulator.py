import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import time


def identity(app):
    with (app / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    executable = info["CFBundleExecutable"]
    if Path(executable).name != executable:
        raise ValueError("Invalid simulator executable name")
    debug = app / f"{executable}.debug.dylib"
    binaries = [app / executable] + ([debug] if debug.is_file() else [])
    return {
        "bundleId": info["CFBundleIdentifier"],
        "version": info["CFBundleShortVersionString"],
        "build": info["CFBundleVersion"],
        "binariesSha256": {binary.name: hashlib.sha256(binary.read_bytes()).hexdigest() for binary in binaries},
    }


def run(command, seconds):
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=seconds, check=False)
        return result.returncode, result.stdout
    except subprocess.TimeoutExpired:
        return 124, ""


def installed_payload(simulator, expected, command=run, pause=time.sleep):
    for attempt in range(3):
        code, output = command(["xcrun", "simctl", "get_app_container", simulator, expected["bundleId"], "app"], 30)
        if code == 0 and output.strip():
            try:
                actual = identity(Path(output.strip()))
            except (OSError, ValueError, KeyError, plistlib.InvalidFileException):
                actual = None
            if actual == expected:
                return actual
        if attempt < 2:
            pause(2)
    return None


def install(simulator, app, command=run, pause=time.sleep):
    expected = identity(app)
    if expected["bundleId"] != "ai.startupbot.ios":
        raise ValueError("Only the StartupBot simulator fixture may be installed")
    attempts = []
    for seconds in (90, 180):
        code, _ = command(["xcrun", "simctl", "install", simulator, str(app)], seconds)
        attempts.append(code)
        if code not in (0, 124):
            raise RuntimeError(f"Simulator install failed with exit {code}")
        actual = installed_payload(simulator, expected, command, pause)
        if actual is not None:
            return {"status": "PASS", "installExitCodes": attempts, "verifiedInstalledPayload": actual}
        if code == 0:
            break
    raise RuntimeError("Simulator did not expose the exact built payload within the installation deadline")


if __name__ == "__main__":
    result = install(sys.argv[1], Path(sys.argv[2]))
    Path(sys.argv[3]).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
