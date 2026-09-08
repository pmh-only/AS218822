"""Exercise startup retries and error propagation without making measurements."""

import json
import os
from pathlib import Path
import subprocess
import tempfile


links = json.loads(subprocess.check_output(["ip", "-j", "link"], text=True))
assert Path("/.dockerenv").exists() and [link["ifname"] for link in links] == ["lo"]
key = Path("/run/wireguard/private.key")
assert not key.exists()
key.write_text("test fixture, not a WireGuard key\n")

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    scripts = {
        "ip": "exit 0\n",
        "sleep": "exit 0\n",
        "wg": """if [ "$1" = set ]; then
    count=$(cat "$MOCK_ATTEMPTS")
    count=$((count + 1))
    printf '%s' "$count" > "$MOCK_ATTEMPTS"
    if [ "$count" -lt 3 ] || [ "${MOCK_PERMANENT_FAILURE:-0}" = 1 ]; then
        echo 'endpoint temporarily unavailable' >&2
        exit 1
    fi
else
    printf 'peer\\t1\\n'
fi
""",
        "spoofer-prober": """printf '%s' "$*" > "$MOCK_PROBER"
kill -PIPE "$$"
exit 17
""",
    }
    for name, body in scripts.items():
        executable = root / name
        executable.write_text("#!/bin/sh\nset -eu\n" + body)
        executable.chmod(0o755)

    attempts = root / "attempts"
    prober = root / "prober-called"
    env = {
        **os.environ,
        "PATH": f"{directory}:{os.environ['PATH']}",
        "MOCK_ATTEMPTS": str(attempts),
        "MOCK_PROBER": str(prober),
        "SPOOFER_ADDRESS": "2a06:9801:ff0:100::2",
        "SPOOFER_PEERING_ADDRESS": "fd00:218:822:38::1/127",
        "SPOOFER_ENDPOINT": "router.example:51830",
        "SPOOFER_SERVER_PUBLIC_KEY": "test fixture",
    }
    attempts.write_text("0")
    result = subprocess.run(["sh", "/routing/spoofer/run-spoofer"], env=env,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 17, result.stdout + result.stderr
    assert attempts.read_text() == "3"
    assert prober.read_text() == "-6 -s1 -r0"
    assert "CAIDA client exit status: 17" in result.stdout
    print("PASS transient endpoint failures retried; client errors and privacy flags preserved")

    attempts.write_text("0")
    prober.unlink()
    env["MOCK_PERMANENT_FAILURE"] = "1"
    result = subprocess.run(["sh", "/routing/spoofer/run-spoofer"], env=env,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 1, result.stdout + result.stderr
    assert attempts.read_text() == "120"
    assert not prober.exists(), "Measurement started without a usable endpoint"
    print("PASS endpoint retries bounded; no measurement on setup failure")

key.unlink()
