# Third-party notices

Factory Control is unofficial and is not affiliated with or endorsed by Wube
Software. Factorio names and trademarks belong to their respective owners.

- [Factorio](https://factorio.com/) is proprietary software from Wube Software.
  No game executables, artwork, mods, saves or verbatim game example configuration
  files are included in this source release. Users obtain the headless server
  separately through the game container image and need matching game clients.
- [factoriotools/factorio-docker](https://github.com/factoriotools/factorio-docker)
  supplies the external game image. Its Docker wrapper is MIT licensed; this
  does not relicense the Factorio game. It is referenced, not vendored here.
- [Node.js](https://nodejs.org/) and the Debian base image are external runtime
  dependencies. Their licenses and component notices remain in their images.

The compact world preset in `panel/world-defaults.json` contains the panel's
exposed configuration keys and numeric/boolean standard values. It is generated
from the project's field definitions, rather than redistributing the full game
example files. Omitted low-level tuning is supplied by the installed game.

The project has no npm dependencies or bundled third-party frontend assets.
