import type { Device3DPose } from '@/types/artboard';

/**
 * The angles behind each 3D pose preset, in degrees.
 *
 * Read by two renderers. Device3DRenderer draws the posed devices from the
 * Devices palette with them, and the 3D Studio device (device3dStudio.ts)
 * starts from them, so a studio look named "Tilted" is the same angle as the
 * tilted tile next to it.
 *
 * Yaw spins the device toward its exposed rail (mirrored for side 'right'),
 * pitch reclines it back toward the camera so it reads as viewed from above,
 * roll leans the projected long axis diagonally in the image plane (also
 * mirrored). Values eyeballed against common 3D-mockup panels. Without
 * bodyAspect the device body's proportions follow the element box (the device
 * fills the box); bodyAspect pins true phone proportions instead, used by the
 * rolled poses where a box-derived body reads visibly squat.
 */
export const DEVICE_3D_POSE_ANGLES: Record<Device3DPose, { yaw: number; pitch: number; roll?: number; bodyAspect?: number }> = {
  classic: { yaw: 24, pitch: 0 },
  // Dead-on product shot with no rotation at all, only the perspective of the
  // camera itself (band tips foreshorten, rails stay hidden).
  front: { yaw: 0, pitch: 0 },
  upright: { yaw: 34, pitch: 0 },
  side: { yaw: 54, pitch: 0 },
  tilted: { yaw: 30, pitch: 26 },
  reclined: { yaw: 33, pitch: 48 },
  laying: { yaw: 28, pitch: 66 },
  floating: { yaw: 34, pitch: 36, roll: -20, bodyAspect: 2.05 },
  drifting: { yaw: 32, pitch: 46, roll: -35, bodyAspect: 2.05 },
  // Gentle diagonal rest: mild yaw toward the exposed rail, slight backward
  // pitch, strong in-image lean (clockwise on side 'left'). Long axis runs
  // diagonally but the screen stays ~90% visible.
  leaning: { yaw: 21, pitch: 10, roll: -31, bodyAspect: 2.05 },
  // Dramatic float: deeper yaw, NEGATIVE pitch (camera above the face, top
  // edge toward the viewer) and a heavy opposite lean (counter-clockwise on
  // side 'right'). Reads as a phone sailing diagonally across the canvas.
  soaring: { yaw: 35, pitch: -15, roll: -36, bodyAspect: 2.05 },
  // Exact yaw/pitch/roll decomposition of the classic 2D isometric mockup
  // projection: spin the phone 60° on the table, then view the table from
  // arccos(0.6) ≈ 53° above (SVG equivalent: rotate(∓60) scale(1, 0.6)).
  // The NEGATIVE pitch is what puts the camera above the face. The laying
  // poses use positive pitch and read as shot from below the plane.
  isometric: { yaw: 49.107, pitch: -23.578, roll: 70.893, bodyAspect: 2.05 },
};
