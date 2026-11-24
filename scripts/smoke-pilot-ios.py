from pathlib import Path
import json
import os
import re
import subprocess
import time

def simctl(*args, timeout=25):
    return subprocess.check_output(["xcrun", "simctl", *args], text=True, timeout=timeout)

data = json.loads(simctl("list", "devices", "available", "-j"))["devices"]
candidates = [
    (tuple(map(int, re.findall(r"\d+", runtime.split(".")[-1]))), device)
    for runtime, devices in data.items() if ".iOS-" in runtime
    for device in devices if device["name"].startswith("iPhone") and device["isAvailable"]
]
assert candidates, "No supported iPhone simulator on this runner"
_, chosen = min(candidates, key=lambda entry: (entry[1]["state"] != "Booted", entry[0]))
device = chosen["udid"]
print("Using", chosen["name"], chosen["state"], flush=True)
if chosen["state"] != "Booted":
    simctl("boot", device, timeout=50)
scratch = Path(os.environ["RUNNER_TEMP"])
bundle = scratch / "startupbot-derived/Build/Products/Debug-iphonesimulator/StartupBot.app"
for attempt in range(1, 41):
    try:
        simctl("install", device, str(bundle), timeout=15)
        print("Installed StartupBot", flush=True)
        break
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f"Simulator install attempt {attempt}: {error}", flush=True)
        time.sleep(3)
else:
    raise SystemExit("The iOS Simulator did not accept the app")

result = simctl("launch", device, "ai.startupbot.ios", timeout=50)
print(result, flush=True)
assert re.search(r"ai\.startupbot\.ios: \d+", result)
screen = scratch / "pilot-ios.png"
time.sleep(2)
print(simctl("io", device, "screenshot", str(screen), timeout=35), flush=True)
assert screen.stat().st_size > 0
