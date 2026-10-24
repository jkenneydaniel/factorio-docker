# Docker isolation verification

The source remains uncommitted on `codex/panel-product-foundation`, based on
`3b484c5`. Existing installations and real game servers/worlds were excluded.
Current runtime and image identities are recorded in
[runtime verification](runtime-definitions.md).

## Boundary reviewed

New local/hosted/agent-only layouts give the daemon socket only to a separate
broker. Host and instance credentials have distinct scopes, with no fallback to
the daemon. Registered package policies select owned images, commands, archive
reads, storage subpaths and resource limits beneath the broker's fixed ceilings.
Managers never adopt unrelated containers, volumes or existing installations.

The source/transport tests exercise actual Unix HTTP requests, authentication
before request bodies, revocation/restart, cross-instance denial, filtered reads,
foreign-volume/driver refusal, privileged/host-path refusal, bounded workers and
serialized memory/creation reservations. Shared controller and manager paths run
through that boundary. Application-specific grants remain independently enforced.

## Disposable Linux acceptance

A fresh isolated Ubuntu 24.04 amd64 machine, `lobby-platform-completion-20261024`,
uses Docker 29.9.2 and the default containerd overlay image store. Initial engine
inspection confirmed zero containers. Calls select this machine explicitly;
the user's normal Docker context is not used.

The latest conformance build provisions two synthetic Arena instances through the
actual broker, then verifies volume subpaths, private credential separation,
reduced inspection and six cross-instance/host/creation denials. Capability
rotation preserves the instance while rejecting its old credential. Immutable
container IDs, images, mounts, start timestamps and fixture-world hashes are
recorded for subsequent read-only comparison.

A separate real-container helper fixture exercises the Factorio helper code with
a test-only executable. It verifies private workspace mounts, nested unpacked-mod
inputs, removal of three real orphaned preview/map/creation helpers, preservation
of old game-owned scratch bytes, rejection of linked output targeting private
storage and unchanged private/world sentinels. The first harness attempt lacked
required inspection metadata; a corrected fresh scope passed. Only its three
identified synthetic helper processes were retired; their volumes were retained.
This proves filesystem/mount behavior, not native Factorio rendering or gameplay.

Management updates use a separate explicit operator process; panel/broker clients
cannot invoke its metadata worker. The tested workflow excludes application and
backup/library mounts. See [management updates](../MANAGEMENT_UPDATES.md) for
replacement, rollback, interruption and installation-start behavior.

## Evidence limits

This is synthetic workload and actual Linux/Docker boundary evidence. It does not
prove native Factorio/Rust gameplay, production Laravel hosting or protection from
a broker/runtime/kernel compromise. Games still share the host kernel and host
management remains trusted with its fleet. Disk/egress isolation and hostile-tenant
VM hosting remain separate deployment concerns.

Legacy direct-socket installations retain their existing behavior. The broker
conversion planner remains review-only and no operational conversion is performed
by this work. No image was published and no existing installation was upgraded.
