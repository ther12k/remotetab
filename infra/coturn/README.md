# coturn — RemoteTab reference TURN

TURN is required for reliable WAN fallback (ADR-003). Credentials are
short-lived and minted by the signaling service (`POST /turn/credentials`,
coturn REST "use-auth-secret" mechanism) — the shared secret lives only on
the server side and is never shipped in the extension or PWA.

## Deployment

```sh
cd infra/coturn
echo 'TURN_SECRET=<64+ random hex chars>' > .env
docker compose up -d
```

Open in the firewall:

| Port | Protocol | Purpose |
|---|---|---|
| 3478 | udp + tcp | TURN listening |
| 5349 | tcp | TURN over TLS (optional; needs certs) |
| 49160–49200 | udp | Relay allocation range |

Then configure the signaling service with the same secret:

```sh
TURN_SECRET=<same value>
TURN_URLS=turn:<public-ip-or-host>:3478?transport=udp
```

Notes:

- `network_mode: host` keeps coturn's relay bindings simple; the relay port
  range above must still be reachable from the internet.
- The config denies relayed access to RFC1918/link-local ranges so the TURN
  cannot be used to probe the host's private network.
- Direct (host-host or UDP hole punching) remains preferred; TURN is only
  the fallback path, and WebRTC payloads stay DTLS-encrypted end to end.
