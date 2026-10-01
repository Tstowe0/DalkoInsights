"""One local server for DALKO Insights: the site plus DAT RateView and FMCSA QCMobile.

Listens on the loopback only (127.0.0.1 and ::1), port 8080.
"""
from __future__ import annotations

import json
import re
import socket
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.dat.staging"
HOST = "127.0.0.1"
PORT = 8080
SAMPLE_LOOKUP = [
    {
        "equipment": "VAN",
        "rateType": "SHIPPER_TO_BROKER_SPOT",
        "origin": {"city": "Dallas", "stateOrProvince": "TX", "postalCode": "75201"},
        "destination": {"city": "Pittsburgh", "stateOrProvince": "PA", "postalCode": "15212"},
    }
]


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'").strip('"')
    return out


def parse_expiry(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def pick_token(payload: object) -> tuple[str | None, datetime | None]:
    if not isinstance(payload, dict):
        return None, None
    token = None
    for key in ("accessToken", "access_token", "token"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            token = value
            break
    return token, parse_expiry(payload.get("expiresWhen") or payload.get("expires_when"))


class DatClient:
    def __init__(self) -> None:
        self.env = load_env(ENV_PATH)
        self._lock = threading.Lock()
        self._org_token: str | None = None
        self._org_exp: datetime | None = None
        self._user_token: str | None = None
        self._user_exp: datetime | None = None

    def public_config(self) -> dict[str, object]:
        return {
            "env": self.env.get("DAT_ENV", "staging"),
            "partnerId": self.env.get("DAT_PARTNER_ID", ""),
            "orgUsername": self.env.get("DAT_ORG_USERNAME", ""),
            "userUsername": self.env.get("DAT_USER_USERNAME", ""),
            "orgTokenUrl": self.env.get("DAT_ORG_TOKEN_URL", ""),
            "userTokenUrl": self.env.get("DAT_USER_TOKEN_URL", ""),
            "rateLookupUrl": self.env.get("DAT_RATE_LOOKUP_URL", ""),
            "hasPassword": bool(self.env.get("DAT_ORG_PASSWORD")),
            "proxy": f"http://{HOST}:{PORT}",
        }

    def post_json(self, url: str, payload: object, headers: dict[str, str]) -> tuple[int, object]:
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
                return res.status, json.loads(raw) if raw else {}
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8", "replace")
            try:
                parsed = json.loads(raw) if raw else {"message": str(err.reason)}
            except json.JSONDecodeError:
                parsed = {"message": raw[:400]}
            return err.code, parsed

    def _fresh(self, token: str | None, exp: datetime | None) -> bool:
        if not token:
            return False
        if not exp:
            return True
        return exp > datetime.now(timezone.utc)

    def org_token(self) -> str:
        with self._lock:
            if self._fresh(self._org_token, self._org_exp):
                return self._org_token or ""
            status, payload = self.post_json(
                self.env["DAT_ORG_TOKEN_URL"],
                {"username": self.env["DAT_ORG_USERNAME"], "password": self.env["DAT_ORG_PASSWORD"]},
                {},
            )
            token, exp = pick_token(payload)
            if status >= 400 or not token:
                raise RuntimeError(f"Organization token failed ({status}).")
            self._org_token, self._org_exp = token, exp
            return token

    def user_token(self) -> str:
        with self._lock:
            if self._fresh(self._user_token, self._user_exp):
                return self._user_token or ""
        org = self.org_token()
        with self._lock:
            status, payload = self.post_json(
                self.env["DAT_USER_TOKEN_URL"],
                {"username": self.env["DAT_USER_USERNAME"]},
                {"Authorization": f"Bearer {org}"},
            )
            token, exp = pick_token(payload)
            if status >= 400 or not token:
                raise RuntimeError(f"User token failed ({status}).")
            self._user_token, self._user_exp = token, exp
            return token

    def lookup(self, body: object | None = None) -> tuple[int, object]:
        token = self.user_token()
        payload = body if body is not None else SAMPLE_LOOKUP
        return self.post_json(
            self.env["DAT_RATE_LOOKUP_URL"],
            payload,
            {"Authorization": f"Bearer {token}"},
        )


CLIENT = DatClient()
GRAPH_ME = "https://graph.microsoft.com/v1.0/me"
FMCSA_BASE = "https://mobile.fmcsa.dot.gov/qc/services"
FMCSA_TEST_DOT = "44110"


def name_key(value: object) -> str:
    return "".join(ch for ch in str(value or "").lower() if ch.isalpha())


def is_terry(me: dict) -> bool:
    mail = str(me.get("mail") or me.get("userPrincipalName") or "").strip().lower()
    if not mail.endswith("@shipdalko.com"):
        return False
    name = name_key(me.get("displayName") or "")
    local = mail.split("@", 1)[0].replace(".", "")
    return name in {"terrystowe", "stoweterry"} or local in {"tstowe", "terrystowe"}


def graph_me(token: str) -> dict | None:
    req = urllib.request.Request(GRAPH_ME, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as res:
            payload = json.loads(res.read().decode("utf-8", "replace") or "{}")
            return payload if isinstance(payload, dict) else None
    except urllib.error.HTTPError:
        return None
    except Exception:
        return None


def fmcsa_webkey() -> str:
    return str(CLIENT.env.get("FMCSA_WEBKEY") or "").strip()


def fmcsa_get(path: str, extra: dict[str, str] | None = None) -> tuple[int, object]:
    key = fmcsa_webkey()
    if not key:
        raise RuntimeError("FMCSA_WEBKEY is missing from .env.dat.staging.")
    query = {"webKey": key}
    if extra:
        query.update(extra)
    url = f"{FMCSA_BASE}{path}?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "DALKO-Insights-Carrier-Search")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as res:
            raw = res.read().decode("utf-8", "replace")
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw) if raw else {"message": str(err.reason)}
        except json.JSONDecodeError:
            parsed = {"message": raw[:400]}
        return err.code, parsed


def carrier_dict(item: object) -> dict | None:
    if not isinstance(item, dict):
        return None
    inner = item.get("carrier")
    if isinstance(inner, dict):
        return inner
    if "dotNumber" in item or "legalName" in item or "dotnumber" in item:
        return item
    return None


def as_carriers(payload: object) -> list[dict]:
    if isinstance(payload, list):
        return [c for c in (carrier_dict(x) for x in payload) if c]
    if not isinstance(payload, dict):
        return []
    content = payload.get("content", payload)
    if isinstance(content, list):
        return [c for c in (carrier_dict(x) for x in content) if c]
    if isinstance(content, dict):
        one = carrier_dict(content)
        if one:
            return [one]
        nested = content.get("carrier")
        if isinstance(nested, list):
            return [c for c in (carrier_dict(x) for x in nested) if c]
    return []


def first_str(row: dict, *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def public_carrier(row: dict) -> dict[str, object]:
    return {
        "dotNumber": first_str(row, "dotNumber", "dotnumber"),
        "legalName": first_str(row, "legalName", "legalname"),
        "dbaName": first_str(row, "dbaName", "dba"),
        "ein": first_str(row, "ein"),
        "phone": first_str(row, "telephone", "phone"),
        "street": first_str(row, "phyStreet"),
        "city": first_str(row, "phyCity"),
        "state": first_str(row, "phyState"),
        "zip": first_str(row, "phyZipcode", "phyZipCode"),
        "country": first_str(row, "phyCountry"),
        "safetyRating": first_str(row, "safetyRating"),
        "safetyRatingDate": first_str(row, "safetyRatingDate"),
        "allowedToOperate": first_str(row, "allowedToOperate"),
        "totalDrivers": row.get("totalDrivers"),
        "totalPowerUnits": row.get("totalPowerUnits"),
        "commonAuthority": first_str(row, "commonAuthorityStatus"),
        "contractAuthority": first_str(row, "contractAuthorityStatus"),
        "brokerAuthority": first_str(row, "brokerAuthorityStatus"),
        "bipdInsurance": first_str(row, "bipdInsuranceOnFile"),
        "cargoInsurance": first_str(row, "cargoInsuranceOnFile"),
        "bondInsurance": first_str(row, "bondInsuranceOnFile"),
    }


def classify_query(raw: str, mode: str) -> tuple[str, str]:
    query = raw.strip()
    digits = re.sub(r"\D", "", query)
    kind = (mode or "auto").strip().lower()
    if kind == "name":
        return "name", query
    if kind == "dot":
        return "dot", digits
    if kind == "mc":
        return "mc", digits
    compact = re.sub(r"[\s-]", "", query).upper()
    if compact.startswith("MC") and digits:
        return "mc", digits
    if re.fullmatch(r"\d{1,8}", query):
        return "dot", digits
    return "name", query


def fmcsa_search(raw: str, mode: str) -> tuple[int, dict[str, object]]:
    kind, value = classify_query(raw, mode)
    if kind == "dot":
        if not value:
            return 400, {"ok": False, "error": "Enter a USDOT number."}
        status, payload = fmcsa_get(f"/carriers/{value}")
    elif kind == "mc":
        if not value:
            return 400, {"ok": False, "error": "Enter an MC / docket number."}
        status, payload = fmcsa_get(f"/carriers/docket-number/{value}/")
    else:
        if len(value) < 2:
            return 400, {"ok": False, "error": "Enter at least two characters of a carrier name."}
        status, payload = fmcsa_get(f"/carriers/name/{urllib.parse.quote(value, safe='')}")
    if status == 401:
        return 401, {"ok": False, "error": "FMCSA rejected the web key. Check FMCSA_WEBKEY."}
    carriers = [public_carrier(row) for row in as_carriers(payload)]
    ok = 200 <= status < 300
    return 200 if ok else status, {
        "ok": ok and bool(carriers or status == 200),
        "mode": kind,
        "query": value,
        "carriers": carriers,
        "status": status,
        "error": None if ok else first_str(payload if isinstance(payload, dict) else {}, "message", "error")
        or f"FMCSA returned {status}.",
    }


def fmcsa_snapshot(dot: str) -> tuple[int, dict[str, object]]:
    if not re.fullmatch(r"\d{1,8}", dot):
        return 400, {"ok": False, "error": "USDOT must be numeric."}
    status, payload = fmcsa_get(f"/carriers/{dot}")
    carriers = [public_carrier(row) for row in as_carriers(payload)]
    if status == 401:
        return 401, {"ok": False, "error": "FMCSA rejected the web key. Check FMCSA_WEBKEY."}
    if not carriers:
        return 404, {"ok": False, "error": f"No FMCSA record for USDOT {dot}."}
    extras: dict[str, object] = {}
    for name, path in (
        ("basics", f"/carriers/{dot}/basics"),
        ("authority", f"/carriers/{dot}/authority"),
        ("oos", f"/carriers/{dot}/oos"),
        ("cargo", f"/carriers/{dot}/cargo-carried"),
        ("dockets", f"/carriers/{dot}/docket-numbers"),
    ):
        extra_status, body = fmcsa_get(path)
        extras[name] = body if 200 <= extra_status < 300 else None
    return 200, {"ok": True, "carrier": carriers[0], "extras": extras, "status": status}


def bearer_token(handler: BaseHTTPRequestHandler) -> str | None:
    raw = str(handler.headers.get("Authorization") or "")
    if raw.lower().startswith("bearer "):
        token = raw[7:].strip()
        return token or None
    return None


def cors_headers(origin: str | None) -> dict[str, str]:
    allowed = {
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    }
    use = origin if origin in allowed else "http://127.0.0.1:8080"
    return {
        "Access-Control-Allow-Origin": use,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "600",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: object) -> None:
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _is_api(self) -> bool:
        return urllib.parse.urlparse(self.path).path.startswith("/api/")

    def _is_hidden(self) -> bool:
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        return any(part.startswith(".") for part in path.split("/") if part not in ("", "."))

    def _send(self, code: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        headers = cors_headers(self.headers.get("Origin"))
        self.send_response(code)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self._is_api():
            self.send_error(404, "Not found")
            return
        headers = cors_headers(self.headers.get("Origin"))
        self.send_response(204)
        for key, value in headers.items():
            if key == "Content-Type":
                continue
            self.send_header(key, value)
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        if self._is_hidden() or self._is_api():
            self.send_error(404, "Not found")
            return
        super().do_HEAD()

    def do_GET(self) -> None:  # noqa: N802
        if self._is_hidden():
            self.send_error(404, "Not found")
            return
        if not self._is_api():
            super().do_GET()
            return
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = {key: values[0] if values else "" for key, values in urllib.parse.parse_qs(parsed.query).items()}
        if path == "/api/dat/status":
            cfg = CLIENT.public_config()
            cfg["ok"] = bool(cfg["hasPassword"] and cfg["orgUsername"] and cfg["userUsername"])
            self._send(200, cfg)
            return
        if path == "/api/dat/secrets":
            token = bearer_token(self)
            if not token:
                self._send(401, {"ok": False, "error": "Sign in required."})
                return
            me = graph_me(token)
            if not me:
                self._send(401, {"ok": False, "error": "Microsoft sign-in could not be verified."})
                return
            if not is_terry(me):
                self._send(403, {"ok": False, "error": "Only Terry Stowe can reveal these credentials."})
                return
            self._send(
                200,
                {
                    "ok": True,
                    "orgUsername": CLIENT.env.get("DAT_ORG_USERNAME", ""),
                    "orgPassword": CLIENT.env.get("DAT_ORG_PASSWORD", ""),
                    "userUsername": CLIENT.env.get("DAT_USER_USERNAME", ""),
                },
            )
            return
        if path == "/api/fmcsa/status":
            has_key = bool(fmcsa_webkey())
            self._send(
                200,
                {
                    "ok": has_key,
                    "hasKey": has_key,
                    "provider": "FMCSA QCMobile",
                    "base": FMCSA_BASE,
                },
            )
            return
        if path == "/api/fmcsa/test":
            if not fmcsa_webkey():
                self._send(
                    200,
                    {
                        "ok": False,
                        "needKey": True,
                        "error": "Add FMCSA_WEBKEY to .env.dat.staging, then restart run-server.bat.",
                    },
                )
                return
            try:
                status, payload = fmcsa_snapshot(FMCSA_TEST_DOT)
            except RuntimeError as err:
                self._send(502, {"ok": False, "error": str(err)})
                return
            carrier = payload.get("carrier") if isinstance(payload, dict) else None
            name = ""
            if isinstance(carrier, dict):
                name = str(carrier.get("legalName") or "")
            self._send(
                200 if payload.get("ok") else 502,
                {
                    "ok": bool(payload.get("ok")),
                    "status": status,
                    "detail": f"QCMobile answered for USDOT {FMCSA_TEST_DOT}"
                    + (f" ({name})." if name else "."),
                    "error": payload.get("error"),
                },
            )
            return
        if path == "/api/fmcsa/search":
            raw = str(query.get("q") or "").strip()
            mode = str(query.get("mode") or "auto")
            if not raw:
                self._send(400, {"ok": False, "error": "Enter a carrier name, USDOT, or MC number."})
                return
            if not fmcsa_webkey():
                self._send(
                    200,
                    {
                        "ok": False,
                        "needKey": True,
                        "error": "Add FMCSA_WEBKEY to .env.dat.staging, then restart run-server.bat.",
                    },
                )
                return
            try:
                status, payload = fmcsa_search(raw, mode)
            except RuntimeError as err:
                self._send(502, {"ok": False, "error": str(err)})
                return
            self._send(200 if payload.get("ok") or status == 200 else status, payload)
            return
        if path == "/api/fmcsa/carrier":
            dot = re.sub(r"\D", "", str(query.get("dot") or ""))
            if not dot:
                self._send(400, {"ok": False, "error": "USDOT is required."})
                return
            if not fmcsa_webkey():
                self._send(
                    200,
                    {
                        "ok": False,
                        "needKey": True,
                        "error": "Add FMCSA_WEBKEY to .env.dat.staging, then restart run-server.bat.",
                    },
                )
                return
            try:
                status, payload = fmcsa_snapshot(dot)
            except RuntimeError as err:
                self._send(502, {"ok": False, "error": str(err)})
                return
            self._send(200 if payload.get("ok") else status, payload)
            return
        self._send(404, {"ok": False, "error": "Not found."})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path != "/api/dat/test":
            if path.startswith("/api/"):
                self._send(404, {"ok": False, "error": "Not found."})
            else:
                self.send_error(404, "Not found")
            return
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b""
        extra = None
        if raw:
            try:
                extra = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                extra = None
        try:
            status, payload = CLIENT.lookup(extra if isinstance(extra, list) else None)
        except RuntimeError as err:
            self._send(502, {"ok": False, "error": str(err)})
            return
        except KeyError:
            self._send(500, {"ok": False, "error": "DAT staging env file is missing a required key."})
            return
        ok = 200 <= status < 300
        self._send(200 if ok else 502, {"ok": ok, "status": status, "result": payload})


class ThreadingHTTPServerV6(ThreadingHTTPServer):
    address_family = socket.AF_INET6


def _serve(host: str) -> ThreadingHTTPServer | None:
    server_cls = ThreadingHTTPServerV6 if ":" in host else ThreadingHTTPServer
    try:
        httpd = server_cls((host, PORT), Handler)
    except OSError as err:
        print(f"Could not bind {host}:{PORT} ({err})", flush=True)
        return None
    threading.Thread(target=httpd.serve_forever, name=f"http-{host}", daemon=True).start()
    label = "localhost" if host == "::1" else host
    print(f"DALKO Insights http://{label}:{PORT}", flush=True)
    return httpd


def main() -> None:
    if not ENV_PATH.exists():
        raise SystemExit(f"Missing {ENV_PATH.name}. Copy .env.example to .env.dat.staging.")
    servers = [httpd for host in ("127.0.0.1", "::1") if (httpd := _serve(host))]
    if not servers:
        raise SystemExit(f"Could not listen on port {PORT}.")
    print("Site, DAT RateView, and FMCSA QCMobile. Press Ctrl+C to stop.", flush=True)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nStopping.", flush=True)
        for httpd in servers:
            httpd.shutdown()


if __name__ == "__main__":
    main()
