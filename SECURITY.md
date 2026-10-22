# Security and deployment scope

Lobby Goblin is intended for trusted administrators and has not received an
independent security audit. Standalone setup targets a trusted LAN. The separate
[host-manager installer](docs/INSTALLATION.md) offers experimental hosted HTTPS
for a single owner. Public self-registration, multiple replicas and multi-tenant
hosting remain unsupported.

The web app checks allowed hostnames, same-origin mutations, sessions, CSRF tokens
and roles. Registration requires invitations. These controls do not make an HTTP
connection confidential: use only a network you trust. Do not forward standalone
panel, controller, Docker or RCON ports from a router. Hosted setup publishes only
its HTTPS gateway, keeps the application port on loopback, and declares the
expected public origin for same-origin checks and Secure cookies. It does not
trust client forwarding headers or configure your firewall. Production Internet
deployment still needs a security review and deployment acceptance.

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

Factorio identity verification is off in the default LAN setup to allow LAN usernames.
Use a game password/whitelist if not everyone on your network should join.

Never publish `.env`, `data/`, `backups/`, `.panel-data/`, game/server logs,
registration links, packet captures or diagnostic dumps. Rust installations also
keep private credentials and accounts in `rust.env` and `control/`; keep those
out of public source and archives. Game image startup logs
can include the RCON password. Use the allowlisted release packager for archives.
An existing Git index can retain ignored files: review staged files before pushing.

For a suspected vulnerability, use the repository's GitHub private vulnerability
reporting feature when enabled. If unavailable, ask the maintainer for a private
reporting channel without posting exploitation details, tokens, passwords or saves
in a public issue. No reporting address or response-time commitment is set yet.
