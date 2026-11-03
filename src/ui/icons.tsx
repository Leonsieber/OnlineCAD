import {
  IconPencil,
  IconCode,
  IconGrain,
  IconBrush,
  IconArrowBarUp,
  IconRotateClockwise2,
  IconRoute,
  IconStack3,
  IconAngle,
  IconArrowsMove,
  IconBorderRadius,
  IconBox,
  IconBoxModel,
  IconCone,
  IconCube,
  IconCylinder,
  IconEgg,
  IconFileImport,
  IconFlipVertical,
  IconGridDots,
  IconLayersIntersect,
  IconLayersSubtract,
  IconLayersUnion,
  IconLifebuoy,
  IconPrism,
  IconPyramid,
  IconRotate360,
  IconSphere,
  IconTrash,
  IconTriangle,
  IconCircleDot,
  IconCopy,
  type Icon,
} from '@tabler/icons-react';
import type { BooleanOp, Feature, PrimitiveKind } from '../model/types';

export const PRIMITIVE_ICONS: Record<PrimitiveKind, Icon> = {
  box: IconCube,
  cylinder: IconCylinder,
  sphere: IconSphere,
  cone: IconCone,
  torus: IconLifebuoy,
  tube: IconCircleDot,
  wedge: IconTriangle,
  pyramid: IconPyramid,
  prism: IconPrism,
  ellipsoid: IconEgg,
};

export const BOOLEAN_ICONS: Record<BooleanOp, Icon> = {
  union: IconLayersUnion,
  subtract: IconLayersSubtract,
  intersect: IconLayersIntersect,
};

export function featureIcon(f: Feature): Icon {
  switch (f.type) {
    case 'primitive':
      return PRIMITIVE_ICONS[f.kind];
    case 'boolean':
      return BOOLEAN_ICONS[f.op];
    case 'fillet':
      return IconBorderRadius;
    case 'chamfer':
      return IconAngle;
    case 'shell':
      return IconBoxModel;
    case 'transform':
      return f.copy ? IconCopy : IconArrowsMove;
    case 'mirror':
      return IconFlipVertical;
    case 'linearPattern':
      return IconGridDots;
    case 'circularPattern':
      return IconRotate360;
    case 'import':
      return IconFileImport;
    case 'deleteParts':
      return IconTrash;
    case 'sketch':
      return IconPencil;
    case 'extrude':
      return IconArrowBarUp;
    case 'revolve':
      return IconRotateClockwise2;
    case 'sweep':
      return IconRoute;
    case 'loft':
      return IconStack3;
    case 'meshEdit':
      return IconGrain;
    case 'sculpt':
      return IconBrush;
    case 'script':
      return IconCode;
    default:
      return IconBox;
  }
}
