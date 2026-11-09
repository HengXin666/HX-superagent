"""Save and check the gateway's github_user instance; print its id. Run from the checkout (reads .env).

    python3 deploy/github-user-instance.py <owner/repo> <cli inside the gateway> <id file> <backend port>

Logs in as the gateway admin from .env, calls POST /api/v1/router/github_user/save (admin only; the
gateway runs the setup check: CLI runs, account readable, pull + push on the repository) and keeps the
instance id in <id file> so reruns update the same instance. Nothing secret is printed.
"""

import json
import sys
import urllib.error
import urllib.request

repo, cli, id_file, port = sys.argv[1:5]
env = dict(line.rstrip("\n").split("=", 1) for line in open(".env", encoding="utf-8") if "=" in line and not line.startswith("#"))
base = f"http://127.0.0.1:{port}/api/v1"


def post(path, body, token=None):
    req = urllib.request.Request(base + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, json.load(resp)
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")[:300]


status, login = post("/auth/login", {"username": env.get("HX_EMAIL_ADMIN_USERNAME", "admin"), "password": env.get("HX_EMAIL_ADMIN_PASSWORD", "")})
if status != 200:
    sys.exit(f"gateway admin login failed ({status})")
try:
    old = int(open(id_file, encoding="utf-8").read().strip())
except (OSError, ValueError):
    old = 0
body = {"cli": cli, "repository": repo, "instance_id": old, "name": f"superagent GitHub ({repo})"}
status, result = post("/router/github_user/save", body, login["access_token"])
if status != 200:
    sys.exit(f"github_user/save: {status} {result}")
report, instance = result.get("report", {}), result.get("instance", {})
print(f"check: {report.get('code')} {report.get('message')} missing_scopes={report.get('missing_scopes')}", file=sys.stderr)
if not report.get("ok"):
    sys.exit(f"github_user check failed: {report.get('hint')}")
with open(id_file, "w", encoding="utf-8") as fh:
    fh.write(str(instance["id"]))
print(instance["id"])
