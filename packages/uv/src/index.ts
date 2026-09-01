export const cubeFaceNames = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
] as const;

export type CubeFaceName = (typeof cubeFaceNames)[number];
