# syntax=docker/dockerfile:1
# Relay 2 : trois images, construites d'ici.
#   relay        : Node seul, aucune dépendance d'exécution (node:sqlite et
#                  Argon2id sont dans le moteur) ;
#   relay-caddy  : Caddy, binaire officiel vérifié par son empreinte SHA-512,
#                  posé seul sur une image vide, sans shell ni utilisateur root ;
#   relay-dns    : dnsmasq, pour que les noms servis par Relay mènent ici.
# Image de base épinglée par empreinte (index multi-architecture amd64 +
# arm64) : une étiquette peut être déplacée, une empreinte non.
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${NODE_IMAGE} AS caddy-binaire
ARG TARGETARCH
ARG CADDY_VERSION=2.10.2
# Empreintes publiées avec la version (caddy_2.10.2_checksums.txt).
ARG CADDY_SHA512_amd64=747df7ee74de188485157a383633a1a963fd9233b71fbb4a69ddcbcc589ce4e2cc82dacf5dbbe136cb51d17e14c59daeb5d9bc92487610b0f3b93680b2646546
ARG CADDY_SHA512_arm64=6ce061a690312ab38367df3c5d5f89a2e4a263e7300d300d87356211bb81e79b15933e6d6203e03fbf26f15cc0311f264805f336147dbdd24938d84b57a4421c
RUN set -eu; arch="${TARGETARCH:-amd64}"; \
    case "$arch" in amd64) sum="$CADDY_SHA512_amd64" ;; arm64) sum="$CADDY_SHA512_arm64" ;; *) echo "architecture $arch non prise en charge"; exit 1 ;; esac; \
    wget -q -O /tmp/caddy.tar.gz "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_${arch}.tar.gz"; \
    echo "$sum  /tmp/caddy.tar.gz" | sha512sum -c -; \
    tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy; \
    mkdir -p /racine/data /racine/config /racine/run/caddy /racine/tmp; \
    chown -R 10002:10002 /racine/data /racine/config /racine/run/caddy; chmod 755 /racine/run/caddy; chmod 1777 /racine/tmp

FROM scratch AS caddy
COPY --from=caddy-binaire /usr/local/bin/caddy /caddy
COPY --from=caddy-binaire /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=caddy-binaire /racine/ /
# Ni root ni capacité : les ports 80 et 443 s'ouvrent par le sysctl
# net.ipv4.ip_unprivileged_port_start du conteneur (compose).
USER 10002:10002
ENV XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config CADDY_ADMIN=unix//run/caddy/admin.sock|0666
EXPOSE 80 443 443/udp
ENTRYPOINT ["/caddy"]
CMD ["run", "--resume"]

# relay-dns : un résolveur pour la zone locale (tous ses noms vers cette
# machine), le reste transmis. dnsmasq seul, sans root : le port 53 s'ouvre par
# le sysctl net.ipv4.ip_unprivileged_port_start du conteneur (compose).
FROM ${NODE_IMAGE} AS dns
# /etc/relay-hosts : les noms que Relay y écrit (volume partagé, lu seul ici).
RUN apk add --no-cache dnsmasq && addgroup -S -g 10003 dns && adduser -S -G dns -u 10003 -H -s /sbin/nologin dns \
 && mkdir -p /etc/relay-hosts && chown 10001:10001 /etc/relay-hosts && chmod 755 /etc/relay-hosts
USER 10003:10003
EXPOSE 53/udp 53/tcp
ENTRYPOINT ["dnsmasq", "--keep-in-foreground", "--log-facility=-", "--pid-file=", "--no-hosts", "--no-resolv", "--domain-needed", "--bogus-priv", "--cache-size=1000", "--hostsdir=/etc/relay-hosts", "--server=1.1.1.1", "--server=9.9.9.9"]

FROM ${NODE_IMAGE} AS relay
RUN apk add --no-cache tini \
 && addgroup -S -g 10001 relay && adduser -S -G relay -u 10001 -H -s /sbin/nologin relay \
 && mkdir -p /data /run/caddy /run/dns && chown relay:relay /data /run/dns && chmod 700 /data && chmod 755 /run/dns && chown 10002:10002 /run/caddy && chmod 755 /run/caddy
WORKDIR /app
COPY package.json ./
COPY socle ./socle
COPY src ./src
COPY web ./web
USER relay
ENV NODE_ENV=production DATA_DIR=/data PORT=8095
EXPOSE 8095
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8095/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.js"]
