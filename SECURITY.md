# Security and deployment scope

v0.2.6-alpha is intended for a trusted LAN with trusted administrators. It has
not received an independent security audit. Internet exposure, public registration,
multiple replicas and multi-tenant hosting are unsupported.

The web app checks allowed hostnames, same-origin mutations, sessions, CSRF tokens
and roles. Registration requires invitations. These controls do not make an HTTP
connection confidential: use only a network you trust. Do not forward panel,
controller, Docker or RCON ports from a router. A production Internet deployment
would need further review and a TLS/access-control deployment design.

The controller mounts the Docker socket. A compromised controller or powerful
administrator can effectively control the Docker host. Do not treat container
capability restrictions as isolation from the host when a socket is mounted.
The web service does not receive that socket, game files or full backups.

Administrator-confirmed updates launch a temporary root worker with the Docker
socket and installation directory mounted. It can replace application source and
containers and retains private recovery copies under `.panel-data/updates/`.
Treat releases and the configured release repository as trusted host software.
Checksums detect damaged downloads; they do not authenticate a compromised
publisher. Only supported state contracts and unmodified source installations
are accepted. See [update scope and recovery](docs/UPDATES.md).

Game identity verification is off in the default LAN setup to allow LAN usernames.
Use a game password/whitelist if not everyone on your network should join.

Never publish `.env`, `data/`, `backups/`, `.panel-data/`, game/server logs,
registration links, packet captures or diagnostic dumps. Game image startup logs
can include the RCON password. Use the allowlisted release packager for archives.
An existing Git index can retain ignored files: review staged files before pushing.

For a suspected vulnerability, use the repository's GitHub private vulnerability
reporting feature when enabled. If unavailable, ask the maintainer for a private
reporting channel without posting exploitation details, tokens, passwords or saves
in a public issue. No reporting address or response-time commitment is set yet.
