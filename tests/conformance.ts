import type {FromSchema} from 'json-schema-to-ts';
import {schemas} from '../packages/core/src/schemas.js';
import type {PaletteAsset, PaletteConfigAsset, TilesetAsset, ShapeAsset, AnimationAsset} from '@clementina/assets';
import type {ClementinaProjectManifest} from '@clementina/project';
import type {LoadPlan} from '@clementina/basic';
// Both directions must remain assignable. Numeric/string bounds are runtime rules.
type Assert<T extends true> = T;
type Both<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Palette = Assert<Both<PaletteAsset, FromSchema<typeof schemas.palette>>>;
type Config = Assert<Both<PaletteConfigAsset, FromSchema<typeof schemas['palette-config']>>>;
type Tileset = Assert<Both<TilesetAsset, FromSchema<typeof schemas.tileset>>>;
type Shape = Assert<Both<ShapeAsset, FromSchema<typeof schemas.shape>>>;
type Animation = Assert<Both<AnimationAsset, FromSchema<typeof schemas.animation>>>;
type Project = Assert<Both<ClementinaProjectManifest, FromSchema<typeof schemas.project>>>;
type Loading = Assert<Both<LoadPlan, FromSchema<typeof schemas['load-plan']>>>;
