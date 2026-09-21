# Video architecture

- logical display: 320×200
- tile size: 8×8
- visible grid: 40×25
- layers: scrolling background, sprites, fixed overlay

## MIA video RAM

| Range | Size | Purpose |
| --- | ---: | --- |
| `$00000-$0001F` | 32 | local control |
| `$00020-$0003F` | 32 | render control |
| `$00100-$001FF` | 256 | palettes |
| `$00200-$0C1FF` | 49,152 | 8 CHR banks |
| `$0C200-$0E13F` | 8,000 | 8 BG nametables |
| `$0E140-$1007F` | 8,000 | 8 BG attributes |
| `$10080-$10467` | 1,000 | overlay nametable |
| `$10468-$1084F` | 1,000 | overlay attributes |
| `$10850-$10D4F` | 1,280 | 256 OAM records |

## Palettes / CHR

There are 16 global palette banks of 8 RGB565 colors each.

There are 8 CHR banks, 6,144 bytes each. A bank is either 3bpp or 1bpp.
3bpp gives 256 8-color tiles. 1bpp interprets the three planes as three
independent 256-tile monochrome pages.

Color index 0 is visible on the background and transparent for sprites/overlay.

## Background

Eight 40×25 tables form two sets of four. Viewport modes expose:

0. 40×25
1. 80×25
2. 40×50
3. 160×25
4. 40×100
5. 80×50

`SCROLL_X/Y` are pixel coordinates.

## Sprites

256 OAM records, five bytes each. One hardware sprite is 8×8.
X is signed 10-bit (-512..511); Y signed 9-bit (-256..255).

Higher OAM indexes draw over lower ones.

Background/overlay attributes: palette 0-3, flip-X 4, flip-Y 5, priority 6,
alternate-CHR 7.

Sprite attr: palette 0-3, priority 4, flip-X 5, flip-Y 6.
Sprite ext: X-high 0-1, Y-high 2, disable 3.

Stable visual order:
backdrop → background → sprites → priority background pixels → overlay.

## Synchronization

Video sync is client-paced dirty-page transfer, not raw pixels. Pages are 32 bytes.
Default video UDP port is 6502.

Direct OAM descriptors are available contiguously at `$C0-$DF` for sprites 0-31.
