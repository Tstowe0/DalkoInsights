"""Probe DAT staging identity without printing secrets."""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.dat.staging"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def redact(value: object) -> object:
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        lower = value.lower()
        if "eyj" in lower[:8] or len(value) > 40:
            return f"{value[:6]}…({len(value)} chars)"
        if any(token in lower for token in ("password", "secret", "token")):
            return "(redacted)"
    return value


def post_json(url: str, payload: object, headers: dict[str, str]) -> tuple[int, object, dict[str, str]]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    for key, value in headers.items():
        req.add_header(key, value)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as res:
            raw = res.read().decode("utf-8", "replace")
            parsed: object
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw[:400]
            return res.status, parsed, dict(res.headers)
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw) if raw else {"error": err.reason}
        except json.JSONDecodeError:
            parsed = raw[:400]
        return err.code, parsed, dict(err.headers)


def pick_token(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("accessToken", "access_token", "token", "organizationToken", "orgToken"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    nested = payload.get("data")
    if isinstance(nested, dict):
        return pick_token(nested)
    return None


def main() -> None:
    env = load_env(ENV_PATH)
    org_url = env["DAT_ORG_TOKEN_URL"]
    user_url = env["DAT_USER_TOKEN_URL"]
    rate_url = env["DAT_RATE_LOOKUP_URL"]
    partner = env["DAT_PARTNER_ID"]
    org_user = env["DAT_ORG_USERNAME"]
    org_pass = env["DAT_ORG_PASSWORD"]
    user_name = env["DAT_USER_USERNAME"]

    org_bodies = [
        {"username": org_user, "password": org_pass},
        {"username": org_user, "password": org_pass, "partnerId": partner},
        {"email": org_user, "password": org_pass},
    ]
    org_header_sets = [
        {},
        {"x-partner-id": partner},
        {"X-DAT-Partner-Id": partner},
        {"partnerId": partner},
    ]

    print("ORG TOKEN")
    org_token = None
    org_ok = None
    for i, body in enumerate(org_bodies):
        for j, extra in enumerate(org_header_sets):
            status, parsed, _headers = post_json(org_url, body, extra)
            keys = list(body.keys())
            print(f"  try body={keys} headers={list(extra)} -> {status} {redact(parsed)}")
            token = pick_token(parsed)
            if status < 400 and token:
                org_token = token
                org_ok = (i, j)
                break
        if org_token:
            break

    if not org_token:
        print("ORG FAILED")
        return

    print(f"ORG OK combo={org_ok} token={redact(org_token)}")

    print("USER TOKEN")
    user_bodies = [
        {"username": user_name},
        {"username": user_name, "partnerId": partner},
        {"email": user_name},
    ]
    user_header_sets = [
        {"Authorization": f"Bearer {org_token}"},
        {"Authorization": f"Bearer {org_token}", "x-partner-id": partner},
    ]
    user_token = None
    for body in user_bodies:
        for extra in user_header_sets:
            status, parsed, _headers = post_json(user_url, body, extra)
            print(f"  try body={list(body.keys())} hdr={list(extra)} -> {status} {redact(parsed)}")
            token = pick_token(parsed)
            if status < 400 and token:
                user_token = token
                break
        if user_token:
            break

    if not user_token:
        print("USER FAILED")
        return

    print(f"USER OK token={redact(user_token)}")

    lookup = {
        "origin": {"city": "Chicago", "stateProvince": "IL", "postalCode": "60607", "country": "US"},
        "destination": {"city": "Dallas", "stateProvince": "TX", "postalCode": "75201", "country": "US"},
        "equipment": "VAN",
        "rateType": "SPOT",
    }
    lookup = [
        {
            "equipment": "VAN",
            "rateType": "SHIPPER_TO_BROKER_SPOT",
            "origin": {"city": "Dallas", "stateOrProvince": "TX", "postalCode": "75201"},
            "destination": {"city": "Pittsburgh", "stateOrProvince": "PA", "postalCode": "15212"},
        }
    ]
    print("RATE LOOKUP ARRAY")
    status, parsed, _headers = post_json(
        rate_url,
        lookup,
        {"Authorization": f"Bearer {user_token}"},
    )
    print(f"  -> {status}")
    print(json.dumps(redact(parsed), indent=2)[:4000])


if __name__ == "__main__":
    main()
