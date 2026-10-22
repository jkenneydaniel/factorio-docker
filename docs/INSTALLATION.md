# Install Lobby Goblin

Use this installer for a **new, separate host manager**. It prepares the panel,
private account storage and a game-host budget. You create the administrator in
your browser, then create game servers when ready. Installation does not need a
world, game password or default administrator password.

Existing standalone Factorio/Rust installations remain separate. The installer
does not adopt their containers, accounts, configuration or worlds. Continue
using [standalone setup](SETUP.md) for those installations.

## Choose a location

Run the installer **on the computer that will host Lobby Goblin**:

- **This computer:** private panel access at `http://localhost:8082`.
- **Hosted server:** panel access at an HTTPS domain. Run the same installer in
  an SSH session on that machine. Point the domain's DNS at it first.

This installer manages game servers on that machine's Docker engine. A central
panel connecting several machines, SSH host enrollment from the panel, provider
provisioning and outbound agent pairing are future work. Installing the panel on
a remote server does not make a home Docker engine reachable automatically.

The current host manager requires x86-64 Linux containers, Docker Engine 26+,
Compose 2.24+ and the configured memory budget plus at least 2 GiB of management
headroom. Leave more memory for the operating system and other applications.
Windows/macOS use Docker Desktop; Linux uses Docker Engine. Existing ARM
standalone Factorio setup remains available; this installer does not provision
ARM fleet hosts.

## Guided installation

Download/extract the complete source release. Use the release's matching runtime
image: installer support must be published in that image before installation can
start. No development checkout or existing manager is rebuilt automatically.

Windows PowerShell:

```powershell
./Install.ps1
```

macOS/Linux:

```sh
sh ./Install.sh
```

On macOS, `Install.command` also opens the guided installer. Node 22+ can run the
installer directly; when Node is absent, the launchers use the published Docker
runtime as a temporary installer. Docker and access to its socket are then
required even for preparing files. That helper is separate from panel/game
containers. With the Docker fallback, keep the destination under your current
working directory; Windows accepts relative destination paths in this mode.

The guided flow asks for local/hosted access, a game address and a memory budget.
It displays the plan and asks before starting the new manager. Declining leaves
prepared files for later. Administrator credentials are entered only in your
browser using a private one-time invitation. It expires after 24 hours.

The first administrator sees a welcome screen with the host connection, panel
address and memory budget. Completion is explicit and saved. Creating a game
server is optional; existing users are not forced through onboarding again.

## Docker missing on an Ubuntu server

Check without installing:

```sh
sh ./scripts/install/Install-Docker.sh --check
```

On a fresh supported Ubuntu 22.04/24.04/26.04 LTS x86-64 server, explicitly install
Docker Engine, Compose and Buildx from Docker's official package repository:

```sh
sudo sh ./scripts/install/Install-Docker.sh --install
```

Or start guided setup with that installation step:

```sh
sudo sh ./Install.sh --install-docker
```

When run through `sudo`, setup keeps newly prepared installation files owned by
the invoking user, so later installer runs can use that account.

Existing Docker is reused. The bootstrap does not upgrade/restart an existing
daemon, remove conflicting container runtimes or add users to the Docker group.
It stops for manual review when conflicting packages or repository files exist.
An interrupted package installation may also need manual review before retrying.
Package installation requires administrator privileges; subsequent setup needs
Docker access. Do not add unattended passwordless administrator access solely
for setup. Other operating systems should install Docker through their supported
installation process first. See [Docker's Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/).

## Prepare, inspect, then start

These examples prepare a new installation without starting the panel or games:

```sh
sh ./Install.sh --prepare --directory ./goblin --memory 4
sh ./Install.sh --prepare --directory ./hosted-goblin --mode hosted --domain games.example.com --address play.example.com --memory 8
```

Inspect that directory's `fleet.compose.yaml`, `install.compose.json`,
`.env.install` and `installation.json`. Keep the directory private and outside
version control. Defaults use the ignored `lobby-goblin-installation/` directory.

Check Docker without writing files or starting any containers:

```sh
sh ./Install.sh --check
```

Then explicitly start the prepared installation:

```sh
sh ./Install.sh --start --directory ./goblin
```

Use the same arguments with `./Install.ps1` on Windows. Experienced users with
Node 22+ can also run `node panel/install.js --help`. Node-backed checks accept
`--directory` to verify a previously prepared installation.

Settings, image version and installation identity survive reruns. Changed files
or mismatched settings stop the installer instead of being replaced. If the
installation already has containers, `--start` does not recreate/restart them.
An interrupted deployment with existing containers needs inspection and manual
recovery; repeated setup is not an upgrade mechanism. No pruning, volume
deletion, game creation or automatic adoption is part of installation.

The runtime capability check refuses an older panel image missing HTTPS-origin
support. Publish a matching release image or provide a reviewed matching version
with `--image ghcr.io/jkenneydaniel/lobby-goblin:VERSION`. This installer does not
silently fall back to an older runtime or build one from local source.

## Hosted reachability

Hosted mode adds Caddy with persistent certificate storage and HTTP-to-HTTPS
redirects. DNS A/AAAA records must resolve to this server and TCP ports 80/443
must reach it. Correct or remove stale IPv6 records. Existing services using
those ports need a separately reviewed proxy configuration; setup never stops
them or edits firewall rules. See [Caddy's HTTPS prerequisites](https://caddyserver.com/docs/automatic-https).

The application port remains bound to loopback; only the gateway exposes the
panel publicly. Controllers, Docker and RCON are not published. Game ports need
separate firewall rules when you later create servers; Docker-published ports
can bypass some host firewall configurations. Use appropriate provider/host
firewall rules, and keep SSH restricted to administrators.

The declared public origin enables HTTPS same-origin checks and Secure session
cookies without trusting client-provided forwarding headers. Treat this as an
experimental single-owner deployment, not a security-audited multi-tenant
service. Browser HTTPS success and joining from another network require real
deployment checks; healthy containers alone prove neither.

## Finish or recover administrator setup

After a fresh start the installer prints a one-time administrator invitation.
Open it in your browser, choose a username/password, confirm the password, then
finish the welcome screen. Passwords are hashed by the existing account system;
there are no generated default passwords or credentials passed on the command
line. Invitations create only the role granted by that invitation.

If the link expires, explicitly replace it without replacing existing accounts:

```sh
sh ./Install.sh --registration-link --directory ./goblin
```

Keep that link private. The source release and installer logs should never
contain your real account data, controller tokens, SSH credentials or links.

## Verification boundary

The matching Linux amd64 runtime was built and the installer exercised in a
fresh, isolated Ubuntu 24.04 environment. Real Docker package installation,
Node-free guided setup, image download, healthy manager startup, administrator
registration, onboarding, recovery and persistence passed. The Linux regression
suite finished with 264 passing tests, zero failures and one Lua test skipped.
Testing found and corrected the temporary helper's user permissions.

Hosted HTTPS account flows, redirects, Secure cookies and certificate persistence
passed using an explicit test-only Caddy internal CA. Public ACME issuance and
external reachability remain unverified. Windows/macOS launcher execution and
ARM fleet hosts are outside this acceptance result. No games were created.

See [the acceptance record](INSTALLER_ACCEPTANCE.md) for the exact isolation,
image artifact and remaining boundaries. The runtime was built locally and was
not published; a matching release image must be published before ordinary
installation. Existing servers and worlds were not accessed or changed.
