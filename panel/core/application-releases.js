import {assert} from '../common.js';
import {softwareDelivery, publicSoftwareDelivery} from './software-delivery.js';
import {
  applicationReleaseProviders,
  applicationReleasePolicies,
} from '../applications/releases.js';
export {boundedJSON} from './release-fetch.js';

// Public metadata only. Discovery never pulls images or changes an installation.
// Cache the upstream payload rather than installed-state comparisons.
export class ApplicationReleases {
  constructor({
    fetcher = fetch,
    now = Date.now,
    providers = applicationReleaseProviders,
  } = {}) {
    Object.assign(this, {fetcher, now, providers});
    this.cache = new Map();
    this.pending = new Map();
  }
  async read(game, policy = applicationReleasePolicies[game]) {
    policy = softwareDelivery(policy);
    const key = game + ':' + JSON.stringify(policy);
    assert(
      Object.hasOwn(this.providers, game),
      'Choose a supported application.',
    );
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < 15 * 60000) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = (async () => {
      try {
        const value = await this.providers[game]({
          fetcher: this.fetcher,
          software: policy,
        });
        const result = {
          ...value,
          software: publicSoftwareDelivery(policy),
          checkedAt: new Date(this.now()).toISOString(),
          stale: false,
        };
        this.cache.set(key, {at: this.now(), value: result});
        return result;
      } catch {
        const value = cached?.value || {game, choices: [], news: []};
        const result = {
          ...value,
          software: publicSoftwareDelivery(policy),
          stale: true,
          error:
            'Release discovery is unavailable. Retry later; installed applications are unchanged.',
        };
        // Failures are also cached, preventing every poll from hitting upstream.
        this.cache.set(key, {at: this.now(), value: result});
        return result;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, pending);
    return pending;
  }
}
