"""Poll Sarvam TTS until credits are live, then exit 0. Used to auto-detect
when a top-up lands so the agent can place the follow-up test call."""
import json, time, urllib.request, urllib.error

KEY = "sk_3sjlqqey_1ycKNqSTkeoDgLApPwuiM5q0"
BODY = json.dumps({
    "inputs": ["నమస్తే"], "target_language_code": "te-IN", "speaker": "manisha",
    "speech_sample_rate": 8000, "enable_preprocessing": True, "model": "bulbul:v2",
    "pace": 0.9, "pitch": 0,
}).encode()

MAX_CHECKS = 40           # 40 * 180s ~= 2 hours
INTERVAL = 180            # 3 minutes

for i in range(1, MAX_CHECKS + 1):
    req = urllib.request.Request(
        "https://api.sarvam.ai/text-to-speech", data=BODY,
        headers={"api-subscription-key": KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            d = json.loads(r.read().decode())
            if d.get("audios"):
                print(f"CREDITS_LIVE after {i} checks", flush=True)
                raise SystemExit(0)
            print(f"check {i}: 200 but empty audios", flush=True)
    except urllib.error.HTTPError as e:
        print(f"check {i}: HTTP {e.code} (not live)", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"check {i}: error {e}", flush=True)
    if i < MAX_CHECKS:
        time.sleep(INTERVAL)

print("TIMEOUT: no Sarvam credits after all checks", flush=True)
raise SystemExit(1)
