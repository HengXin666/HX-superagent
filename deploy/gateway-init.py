"""One-shot init for the superagent compose: make sure a working hxr_ router key sits in the shared volume.

A key already in the file is kept while the gateway still accepts it (GET /api/v1/router/sources).
Otherwise: admin login (POST /api/v1/auth/login), issue a key (POST /api/v1/router/api-keys),
write it with mode 0600 (the image runs as the superagent uid; as root it chowns to SUPERAGENT_UID). The key is never printed.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("HX_ROUTER_BASE_URL", "http://127.0.0.1:18090").rstrip("/")
TOKEN_FILE = os.environ.get("HX_ROUTER_TOKEN_FILE", "/shared/hx_router_token")
KEY_NAME = os.environ.get("HX_ROUTER_KEY_NAME", "dsh-superagent")
USERNAME = os.environ.get("HX_EMAIL_ADMIN_USERNAME", "admin")
PASSWORD = os.environ.get("HX_EMAIL_ADMIN_PASSWORD", "admin")
UID = int(os.environ.get("SUPERAGENT_UID", "1000"))  # only used when run as root


def request(method, path, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + "/api/v1" + path, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"null")
        except ValueError:
            return error.code, raw.decode("utf-8", "replace")[:300]


def wait_ready(seconds=120):
    deadline = time.monotonic() + seconds
    while True:
        try:
            with urllib.request.urlopen(BASE + "/healthz", timeout=5):
                return
        except Exception as error:  # noqa: BLE001 - any failure means not ready yet
            if time.monotonic() > deadline:
                sys.exit("gateway-init: gateway at %s not ready: %s" % (BASE, error))
            time.sleep(2)


def current_key():
    try:
        with open(TOKEN_FILE, encoding="utf-8") as fh:
            return fh.read().strip()
    except FileNotFoundError:
        return ""


def write_key(key):
    directory = os.path.dirname(TOKEN_FILE) or "."
    os.makedirs(directory, exist_ok=True)
    tmp = TOKEN_FILE + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(key + "\n")
    if os.geteuid() == 0:
        os.chown(tmp, UID, UID)
    os.replace(tmp, TOKEN_FILE)


def main():
    wait_ready()
    key = current_key()
    if key:
        status, _ = request("GET", "/router/sources", token=key)
        if status == 200:
            print("gateway-init: existing router key accepted")
            return
        print("gateway-init: existing router key refused (%s); issuing a new one" % status)
    status, body = request("POST", "/auth/login", {"username": USERNAME, "password": PASSWORD})
    if status != 200 or not isinstance(body, dict) or "access_token" not in body:
        sys.exit("gateway-init: admin login failed (%s); check HX_EMAIL_ADMIN_USERNAME/PASSWORD" % status)
    session = body["access_token"]
    status, body = request("POST", "/router/api-keys", {"name": KEY_NAME}, token=session)
    if status == 409:
        sys.exit("gateway-init: key limit reached; revoke an old key on the gateway's subscriptions page")
    if status != 201 or not isinstance(body, dict) or not str(body.get("key", "")).startswith("hxr_"):
        sys.exit("gateway-init: issuing a router key failed (%s): %s" % (status, body))
    write_key(body["key"])
    print("gateway-init: issued router key id %s (%s…) into %s" % (body.get("id"), body.get("key_prefix"), TOKEN_FILE))


if __name__ == "__main__":
    main()
