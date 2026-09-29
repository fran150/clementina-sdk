# @clementina/assets

Portable asset types, validation, and binary encoders for Clementina projects. The package checks version 1 JSON assets against the schemas in [`specs/schema`](../../specs/schema/) and encodes palette, CHR, map, sprite, song, and sound data for the SDK builder and runtime.

Portable assets belong in files listed by a project's `clementina.yaml` manifest. Editor session state belongs outside those files. `@clementina/project` loads and checks the manifest and its cross-asset references; `@clementina/assets` can validate individual assets or an assembled `PortableAssetSet`.

## Requirements

- Node.js 20 or newer, or a browser bundler that supports ES modules.
- `@clementina/core` is installed with this package.
- Asset JSON follows the version 1 formats in [`specs/schema`](../../specs/schema/). A tileset is one 6,144-byte CHR bank; a palette has eight RGB565 colors.

## Use

```js
import {checkAsset, encodePalette, encodePaletteConfig} from '@clementina/assets';

const palette = {
  format: 'clementina-palette', version: 1,
  id: 'palette:main', name: 'Main',
  colors: [0x0000, 0xffff, 0xf800, 0x07e0, 0x001f, 0xffe0, 0xf81f, 0x07ff],
};
const checked = checkAsset(palette);
if (!checked.ok) throw new Error(JSON.stringify(checked.diagnostics));

const bankBytes = encodePalette(palette); // 16 RGB565 bytes, little-endian
const config = {
  format: 'clementina-palette-config', version: 1,
  id: 'palette-config:main', name: 'MainBanks',
  banks: ['palette:main', ...Array(15).fill(null)],
};
const paletteMemory = encodePaletteConfig(config, [palette]); // 256 bytes
```

Use `checkAssetSet(set)` for nonthrowing structural and cross-asset diagnostics, or `validateAssetSet(set)` to throw on invalid data. The set has arrays named `palettes`, `paletteConfigs`, `tilesets`, `backgrounds`, `overlays`, `shapes`, `animations`, `instruments`, `sounds`, and `songs`. Shape and animation references must resolve, and an animation's shapes must share one tileset.

Audio helpers are also available from `@clementina/assets/audio`:

```js
import {compileSong, soundWrites} from '@clementina/assets/audio';

// Given portable song, instrument, and sound records loaded from the project:
const compiled = compileSong(song, instruments);
// compiled.voices has one sequencer track per voice, or null for an empty voice.
const frameWrites = soundWrites(sound);
// Each entry holds register/value pairs for one 60 Hz frame, plus a release entry.
```

`encodeSongFile` and `encodeSoundFile` wrap those outputs for the SDK runtime. The song compiler resolves steps to 24 kHz sample boundaries and writes the sequencer's encoded duration as the desired sample count minus one. Callers choose MIA RAM locations for tracks; this package does not allocate memory.

For portable asset layouts and hardware constraints, see the [asset model](../../docs/gamedev/asset-model.md), [builder file formats](../../docs/gamedev/builder.md), [video architecture](../../docs/architecture/video.md), and [audio architecture](../../docs/architecture/audio.md).

## Development

From the repository root:

```sh
npm install
npm run build -w @clementina/core
npm run build -w @clementina/assets
npm run typecheck -w @clementina/assets
node --test tests/asset-build.test.mjs tests/assets-refactor.test.mjs
```

Build before running the tests: they import the package's generated `dist` files. Run `npm test` for the full SDK validation and test suite.
