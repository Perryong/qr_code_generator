/**
 * Seasons and colour palettes.
 *
 * A season sets the whole scene — sky, ground, bark, canopy. A palette then
 * shifts only the canopy and petals, so the two controls compose rather than
 * fighting each other.
 */

export const SEASONS = {
  spring: {
    label: 'Spring',
    sky: '#f6f1e7',
    fog: '#f6f1e7',
    dark: '#6f8f5c',
    light: '#e9e3d2',
    bark: '#6b5545',
    grass: '#8fae6b',
    canopy: ['#f7b7cd', '#f9cddc', '#efa0bd', '#ffd9e6'],
    ground: '#dcd6c4',
  },
  summer: {
    label: 'Summer',
    sky: '#eef4ea',
    fog: '#eef4ea',
    dark: '#4c7a48',
    light: '#e2ecdc',
    bark: '#5c4a3a',
    grass: '#6f9a55',
    canopy: ['#4f9b48', '#69b45c', '#3d8340', '#8ac96f'],
    ground: '#d3ddc9',
  },
  autumn: {
    label: 'Autumn',
    sky: '#f7efe2',
    fog: '#f7efe2',
    dark: '#8a6236',
    light: '#eee3d0',
    bark: '#5a4433',
    grass: '#a08341',
    canopy: ['#e0902f', '#d1652a', '#f0b243', '#b84a2a'],
    ground: '#e0d3ba',
  },
  winter: {
    label: 'Winter',
    sky: '#eef2f6',
    fog: '#eef2f6',
    dark: '#7d90a3',
    light: '#e8eef4',
    bark: '#4f4a48',
    grass: '#9fb0bf',
    canopy: ['#ffffff', '#eaf1f7', '#d8e5ef', '#f7fbff'],
    ground: '#dde5ed',
  },
};

/** Palettes override the canopy only. */
export const PALETTES = {
  natural: { label: 'Natural', canopy: null },
  lavender: { label: 'Lavender', canopy: ['#b39ddb', '#cbb8e8', '#9a7fc4', '#ded0f2'] },
  coral: { label: 'Coral', canopy: ['#ff8a6d', '#ffab90', '#e96a4d', '#ffc7b3'] },
  gold: { label: 'Gold', canopy: ['#e8b13a', '#f3c766', '#cf9420', '#f8dc9b'] },
  sky: { label: 'Sky', canopy: ['#6fb3e0', '#93c9ec', '#4a93c7', '#bfe0f5'] },
  snow: { label: 'Snow', canopy: ['#ffffff', '#f0f4f8', '#dde6ee', '#fbfdff'] },
};

export const DEFAULT_SEASON = 'spring';
export const DEFAULT_PALETTE = 'natural';

export function resolveTheme(seasonKey, paletteKey) {
  const season = SEASONS[seasonKey] || SEASONS[DEFAULT_SEASON];
  const palette = PALETTES[paletteKey] || PALETTES[DEFAULT_PALETTE];
  return { ...season, canopy: palette.canopy || season.canopy };
}
