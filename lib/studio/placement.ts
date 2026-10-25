// Where the viewer puts a placed part (pure, shared by the viewer and the tests).
//
// Layout space has z = 0 on the case floor; enclosure space (the shell, the
// cut-outs) has the floor top at z = contentOffset[2] (= wall). The viewer draws
// the shell and the parts in ONE Z-up content group, so a part's group goes to
// layout pos + contentOffset and turns by rotZ about Z (counter-clockwise, the
// same sense as layout.ts rotateXY). Without a case the offset is 0.

import type { LayoutItem } from "./schema";
import type { Vec3 } from "./layout";

export type PartPlacement = {
  /** Group position (mm, Z-up content frame). */
  position: Vec3;
  /** Group rotation about Z (radians). */
  rotationZ: number;
};

const ZERO: Vec3 = [0, 0, 0];

/** contentOffset of a built case, or 0 when there is none. */
export function contentOffsetOf(dims: { contentOffset: Vec3 } | null | undefined): Vec3 {
  return dims?.contentOffset ?? ZERO;
}

/** The transform the viewer gives a part's outer group. */
export function placePart(item: Pick<LayoutItem, "pos" | "rotZ">, offset: Vec3 = ZERO): PartPlacement {
  return {
    position: [item.pos[0] + offset[0], item.pos[1] + offset[1], item.pos[2] + offset[2]],
    rotationZ: (item.rotZ * Math.PI) / 180,
  };
}
