export function noManagedUpdater(current) {
  const status = () => ({
    current,
    busy: false,
    jobs: [],
    pendingRestore: null,
    supported: false,
    message:
      'This server belongs to the host manager. Standalone installation updates are disabled.',
  });
  const unavailable = async () => {
    throw Object.assign(
      Error(
        'Standalone installation updates are disabled for managed servers.',
      ),
      {status: 409},
    );
  };
  return {
    current,
    jobs: [],
    busy: false,
    pendingRestore: null,
    init: async () => {},
    refresh: async () => status(),
    status,
    plan: unavailable,
    install: unavailable,
    restored: async () => {},
  };
}
