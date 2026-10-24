import {assert} from '../common.js';

export const validId = (value) =>
  typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
export const labels = (fleet, id, game) => ({
  'io.lobby-goblin.fleet': fleet,
  'io.lobby-goblin.instance': id,
  'io.lobby-goblin.game': game,
});
export function resources(fleet, id, game) {
  assert(
    validId(fleet) && validId(id) && /^[a-z][a-z0-9-]*$/.test(game),
    'Invalid instance identity.',
  );
  return {
    container: `lobby-goblin-${game}-${id}`,
    controller: `lobby-goblin-controller-${id}`,
    volume: `lobby-goblin-${fleet}-${id}`,
    network: `lobby-goblin-${fleet}-${id}`,
  };
}
