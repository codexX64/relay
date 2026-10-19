# Connecting a service to Relay

Relay is a reverse proxy control panel. Services installed by the Hub are published by the Hub itself; this contract is for services that publish themselves. A service that registers with it becomes
reachable at a public or local domain without anyone editing a proxy config by hand.

This document is written to be executed. An agent given this file, a service token and
a target repository should be able to wire the integration end to end without asking
further questions. Every endpoint below was exercised against a running panel; the
example responses are real shapes, not sketches.

---

## 1. What you need before starting

| Item | Where it comes from | Example |
|---|---|---|
| `RELAY_URL` | The panel's address | `https://relay.example.com` |
| `RELAY_TOKEN` | Relay → Services raccordés → **Raccorder un service** | `svc_xxxxxxxxxxxx` |
| `upstream` | Where your service actually listens, reachable **from the Relay host** | `192.0.2.20:8090` |

The token is displayed **once**, at creation, masked behind a *Show* button with a
*Copy* beside it. Relay stores only its SHA-256 digest, so it cannot display the value
again — that is the point: a stolen database yields no usable token.

While the panel stays open, the service's row carries a **show/hide** and a **copy**
button for the token just issued. After a reload both go grey: there is no clear value
left anywhere, so nothing can be revealed.

If the token is lost or exposed, « Nouveau jeton » in Relay (`POST /api/clients/<id>/tourner`)
issues a new one and invalidates the old immediately, keeping the service's routes. Revoking and re-adding
the service works too, and takes its routes with it.

**Stop and ask the operator if any of the three is missing.** Do not invent a token, do
not guess an upstream, do not fall back to `localhost` — Relay runs in its own container
and `localhost` there is not your service.

---

## 2. Scopes

A token is issued with one of two scopes, chosen when the service is added.

| Scope | Reaches | For |
|---|---|---|
| **Publish itself** | `/api/register`, `/api/heartbeat`, `/api/whoami` | An ordinary service that owns one or two domains. This is the default and the one this document describes |
| **Manage every route** | The full route API: `/api/etat`, `/api/routes`, `/api/appliquer` | A container manager that publishes on behalf of others |

Neither scope reaches the account, the settings, the device list or another
service's token. There is no scope that does.

Tokens are revoked one at a time. A token that leaks costs you that one service,
not every service — which is the reason there is no single shared key.

## 2b. What a publishing token can and cannot do

A service token with the default scope reaches exactly three endpoints:

- `POST /api/register` — publish or update **its own** route
- `DELETE /api/register` — unpublish its own route
- `GET /api/whoami` — read back what it owns
- `POST /api/heartbeat` — report liveness

Everything else is refused (`401` or `403`), including reads. A service token cannot list other
services, cannot see the settings, cannot create another token, and cannot touch a
domain owned by a different service. This is deliberate: a compromised service does not
become a compromised proxy.

```
GET /api/reglages   with a service token
→ 401 {"error":"Connexion requise."}
```

---

## 3. Authentication

Send the token on every call, in either form:

```
x-relay-key: svc_xxxxxxxxxxxx
```
```
Authorization: Bearer svc_xxxxxxxxxxxx
```

The token comes from the environment, never from source, never from a committed file:

```
RELAY_URL=https://relay.example.com
RELAY_TOKEN=svc_xxxxxxxxxxxx
```

If `RELAY_TOKEN` is absent, the integration disables itself, logs one line at startup
and the service keeps running. Publishing is never allowed to break a deployment.

---

## 4. Registering

### Request

```http
POST /api/register
x-relay-key: svc_xxxxxxxxxxxx
Content-Type: application/json

{
  "subdomain": "map",
  "upstream": "192.0.2.20:8090",
  "mode": "cloudflare",
  "name": "Network map"
}
```

| Field | Required | Meaning |
|---|---|---|
| `subdomain` | one of the two | Combined with the panel's first base domain |
| `host` | one of the two | Full domain, when you want to control it exactly |
| `upstream` | yes | `ip:port`, or `https://ip:port` when the target speaks TLS |
| `mode` | no, defaults to `cloudflare` | See the table below |
| `name` | no | Label shown in the panel; defaults to the service name |

### Modes

| `mode` | What Relay does | Use it when |
|---|---|---|
| `cloudflare` | Plain HTTP on port 80, plus the CNAME and the tunnel entry | The domain is served through a Cloudflare tunnel — the usual case |
| `public` | Let's Encrypt certificate | Ports 80 and 443 are open directly on the Relay host |
| `local` | Certificate signed by Relay's internal CA | A `.lan` name that never leaves the network |

Picking `public` behind a tunnel produces a redirect loop: port 80 answers `308` to
HTTPS, the tunnel follows it back to port 80, forever. If you are behind a tunnel and
unsure, use `cloudflare`.

### Response

```json
{ "ok": true, "created": true, "url": "https://map.example.com",
  "route": { "id": "68da260b", "host": "map.example.com", "upstream": "192.0.2.20:8090", "tls": "off", "cf": true } }
```

`created: true` on the first call, `updated: true` afterwards.

### Idempotence

Calling `POST /api/register` twice with the same `subdomain` **updates** the route; it
never creates a second one. Call it unconditionally at every boot and after every
deployment — that is the intended usage, not a special case. Do not add a "have I
already registered?" check; Relay answers that question correctly on its own.

### Errors

| Status | Body | What to do |
|---|---|---|
| `400` | `Champ « upstream » : obligatoire.` | Fill the field |
| `400` | `Cible refusée à un jeton de service : boucle locale, adresse non spécifiée ou de lien local.` | `upstream` is `localhost`, `127.x`, `0.x`, `169.254.x` or a non-canonical spelling of one: give the address the Relay host reaches your service at |
| `400` | `Give host, or subdomain with a base domain configured.` | Send a full `host`, or ask the operator to set a base domain in Relay → Réglages → Général |
| `401` | `Jeton invalide.` | The token is wrong or revoked |
| `403` | `Un jeton de service est exigé ici.` | No token was sent |
| `409` | `map.example.com is already routed by another service.` | Another service owns the domain. Pick a different one — never retry in a loop |
| `502` | Caddy's raw message | Surface it as-is; it names the actual problem |
| `200` with `warning` | Route exists, Cloudflare refused | Not a failure. Log the warning, keep going |

**Show error bodies verbatim.** They come from Relay, Caddy or Cloudflare and name the
real cause. Replacing them with "connection error" destroys the only useful signal.

---

## 5. Unpublishing

```http
DELETE /api/register?host=map.example.com
x-relay-key: svc_xxxxxxxxxxxx
```

Omit `host` to remove everything the service owns. Call this when the service is being
decommissioned — not when it merely stops. A stopped service should keep its route: the
panel will show it red and it recovers by itself on restart.

---

## 6. Reading back

```http
GET /api/whoami
→ { "service": "network-map", "id": "3f9a1c2e", "since": 1785030000000,
    "routes": [ { "host": "map.example.com", "upstream": "192.0.2.20:8090", "tls": "off", "cf": true } ] }
```

Use it at startup to reconcile: if `routes` is empty but your service believes it is
published, register again.

---

## 7. Keeping the upstream correct

Relay probes every route on a timer and marks it red when it stops answering, but it
does **not** know that your container moved to a different port. Whoever knows that must
say so.

If your service's address can change — a container with a dynamic published port, a
rolling deployment, a new host — re-register on every start:

```js
async function publish() {
  if (!process.env.RELAY_TOKEN) {
    console.warn('[relay] RELAY_TOKEN missing: publishing disabled');
    return;
  }
  const body = {
    subdomain: 'map',
    upstream: `${process.env.PUBLIC_HOST}:${process.env.PORT}`,
    mode: 'cloudflare'
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(`${process.env.RELAY_URL}/api/register`, {
        method: 'POST',
        headers: { 'x-relay-key': process.env.RELAY_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        console.log(`[relay] published on ${j.url}`);
        if (j.warning) console.warn(`[relay] ${j.warning}`);
        return;
      }
      console.error(`[relay] ${r.status} ${j.error || ''}`);
      if (r.status === 409 || r.status === 400 || r.status === 403) return;   // no point retrying
    } catch (e) {
      console.error(`[relay] ${e.message}`);
    }
    if (attempt === 1) await new Promise(r => setTimeout(r, 3000));
  }
}
```

Three properties of that function matter and should survive any rewrite: it returns
quietly when the token is absent, it never throws into the caller, and it stops retrying
on the errors that retrying cannot fix.

---

## 8. Checklist for the agent doing the wiring

- [ ] `RELAY_URL` and `RELAY_TOKEN` read from the environment, absent from the repository
- [ ] `.env.example` documents both, with no real value
- [ ] Registration runs at startup, after the service is actually listening
- [ ] `upstream` is the address **the Relay host can reach**, not `localhost`
- [ ] `mode` matches how the domain is served — `cloudflare` behind a tunnel
- [ ] A failed registration logs and continues; it never aborts startup
- [ ] Error bodies from Relay are surfaced unchanged
- [ ] No retry loop on `400`, `403` or `409`
- [ ] Decommissioning calls `DELETE /api/register`
- [ ] The token appears in no log line, no error message, no commit

---

## 9. Verifying, by hand

```bash
# what do I own?
curl -s -H "x-relay-key: $RELAY_TOKEN" "$RELAY_URL/api/whoami" | python3 -m json.tool

# publish
curl -s -X POST -H "x-relay-key: $RELAY_TOKEN" -H 'content-type: application/json' \
     -d '{"subdomain":"map","upstream":"192.0.2.20:8090","mode":"local"}' \
     "$RELAY_URL/api/register" | python3 -m json.tool

# the domain answers
curl -I "https://map.example.com"
```

A `502` on the last call means the route exists but the upstream is not answering: wrong
port, or the service is bound to `127.0.0.1` inside its own container and unreachable
from outside it.
