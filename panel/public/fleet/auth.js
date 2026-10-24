import {createEventScope} from '../shared/events.js';
export function createFleetAuth({
  sessionController,
  request,
  error,
  authenticated,
  load,
  onSignedOut,
}) {
  const $ = (selector) => document.querySelector(selector),
    events = createEventScope((problem) => error(problem.message));
  let generation = 0,
    reading = new AbortController();
  const api = (route, body) =>
    request(
      route,
      body === undefined
        ? {signal: reading.signal}
        : {method: 'POST', body, signal: reading.signal},
    );
  function showSignIn() {
    generation++;
    reading.abort();
    reading = new AbortController();
    $('#login').hidden = false;
    $('#register').hidden = true;
    $('#register').reset();
    $('#register-toggle').hidden = false;
    $('#back-to-login').hidden = true;
    $('#register-submit').disabled = false;
    $('#register-submit').textContent = 'Create account';
    $('#invitation-field').hidden = false;
    $('#auth-title').textContent = 'A home for your servers.';
    $('#auth-description').textContent =
      'Sign in to create and manage your Factorio and Rust servers.';
    error('');
  }
  events.set($('#login'), 'submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await sessionController.signIn(Object.fromEntries(new FormData(form)));
      form.reset();
      authenticated();
      await load();
    } catch (e) {
      error(e.message);
    }
  });
  events.set($('#register-toggle'), 'click', () => {
    $('#register').hidden = !$('#register').hidden;
  });
  events.set($('#back-to-login'), 'click', () => showSignIn());
  events.set($('#register'), 'submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      button = $('#register-submit');
    button.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(form));
      if (data.password !== data.confirmPassword)
        throw Error('The passwords do not match. Please enter them again.');
      data.token =
        data.token.match(/#register=([A-Za-z0-9_-]+)/)?.[1] || data.token;
      await sessionController.register(data);
      form.reset();
      history.replaceState(null, '', '/');
      authenticated();
      await load();
    } catch (e) {
      error(e.message);
    } finally {
      button.disabled = false;
    }
  });
  events.set($('#logout'), 'click', async () => {
    try {
      await sessionController.signOut();
    } finally {
      sessionController.set(null);
      onSignedOut();
      showSignIn();
      authenticated();
    }
  });

  return {
    showSignIn,
    async bootstrap() {
      const invitation = location.hash.match(
        /^#register=([A-Za-z0-9_-]+)$/,
      )?.[1];
      if (invitation) {
        const version = generation;
        $('#register').hidden = false;
        $('#login').hidden = true;
        $('#register-toggle').hidden = true;
        $('#back-to-login').hidden = false;
        $('#register').elements.token.value = invitation;
        history.replaceState(null, '', '/');
        authenticated();
        try {
          const details = await api('/registration', {token: invitation});
          if (version !== generation) return;
          $('#auth-title').textContent = details.owner
            ? 'Create your administrator account.'
            : 'You’re invited.';
          $('#auth-description').textContent = details.owner
            ? 'Choose your own sign-in details. This private installation link can be used once.'
            : 'Create an account to join this panel. Your invitation determines your access.';
          $('#invitation-field').hidden = true;
          $('#register-submit').textContent = details.owner
            ? 'Create administrator account'
            : 'Create account';
        } catch (e) {
          if (version !== generation) return;
          error(e.message);
          $('#register-submit').disabled = true;
        }
      } else
        try {
          const initial = await sessionController.bootstrap();
          authenticated();
          if (initial) await load();
        } catch {
          authenticated();
        }
    },
    dispose() {
      generation++;
      reading.abort();
      events.clear();
    },
  };
}
