import {assert} from '../../common.js';
// Historical mount descriptions are used only to identify and remove old helpers.
// New helpers allocate private controller workspaces.
export function legacyHelperMount(server, relative = '', target = '/factorio') {
  assert(
    !relative ||
      (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(relative) &&
        !relative.split('/').includes('..')),
    'Invalid worker directory.',
  );
  const mount = server.Mounts?.find((m) => m.Destination === '/factorio');
  assert(
    mount && ['bind', 'volume'].includes(mount.Type),
    'The Factorio data mount is unavailable.',
  );
  if (mount.Type === 'volume') {
    const config = server.HostConfig?.Mounts?.find(
      (m) => m.Target === '/factorio' && m.Type === 'volume',
    );
    assert(
      config?.Source === mount.Name,
      'Cannot verify the named data volume.',
    );
    const subpath = [config.VolumeOptions?.Subpath, relative]
      .filter(Boolean)
      .join('/');
    return {
      Type: 'volume',
      Source: mount.Name,
      Target: target,
      VolumeOptions: {NoCopy: true, ...(subpath ? {Subpath: subpath} : {})},
    };
  }
  let root = mount.Source.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(root))
    root = '/run/desktop/mnt/host/' + root[0].toLowerCase() + root.slice(2);
  return {
    Type: 'bind',
    Source: root.replace(/\/$/, '') + (relative ? '/' + relative : ''),
    Target: target,
  };
}
