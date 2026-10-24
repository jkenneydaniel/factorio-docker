const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ],
  );
export function welcomeView({username, origin, status, host}) {
  const ready = !!status?.ready,
    capacity = host?.dockerMemoryGiB,
    hosted = origin.startsWith('https:');
  return `<ol class="install-steps" aria-label="Installation progress"><li>1 · Host prepared</li><li>2 · Administrator created</li><li aria-current="step">3 · Make yourself at home</li></ol>
    <p class="eyebrow">WELCOME, ${esc(username.toUpperCase())}</p><h1>Your next adventure starts here.</h1><p>Your account is ready. Check your new home for game servers before inviting your friends.</p>
    <div class="welcome-layout"><section class="card"><h2>A home for your servers</h2>
    <dl class="install-readiness"><div><dt>Administrator</dt><dd>${esc(username)} · Ready</dd></div><div><dt>Host manager</dt><dd>${ready ? 'Connected' : 'Waiting for the host'}</dd></div><div><dt>Panel address</dt><dd><a href="${esc(origin)}">${esc(origin)}</a></dd></div><div><dt>Connection</dt><dd>${hosted ? 'HTTPS enabled' : 'Private local access'}</dd></div><div><dt>Game memory budget</dt><dd>${host ? esc(host.memoryBudgetGiB) + ' GiB' : 'Unavailable'}</dd></div><div><dt>Docker memory capacity</dt><dd>${capacity == null ? 'Unavailable' : esc(capacity.toFixed(1)) + ' GiB'}</dd></div></dl>
    <p class="hint">The game budget includes each server’s controller. Leave room for the operating system and other applications. You can adjust this in Host settings.</p></section>
    <section class="welcome-next"><h2>Start with something you’ll love.</h2><p>Create a Factorio factory or a Rust island when you’re ready. Choose a name and resources, then we’ll prepare its own world and storage.</p><p>Invite other administrators or viewers from Access. Panel invitations and joining a game are separate.</p><p class="hint">Create servers on this machine, or connect another game host from Hosts. A remote host runs a small agent; it does not need its own panel.</p></section></div>
    <div class="welcome-finish"><button id="finish-installation" class="primary" ${!ready ? 'disabled' : ''}>Open my panel</button><button id="retry-installation" class="quiet">Recheck host</button><span class="hint">You can create your first server later.</span></div>`;
}
