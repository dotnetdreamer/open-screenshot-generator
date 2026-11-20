/**
 * What the director's view draws over the stage: the path the video's camera
 * takes over the whole scene, a marker at each shot with a line to what it
 * looks at, and the camera as it is at the playhead, as a small pyramid
 * pointing where it looks. Thin lines and flat colours, drawn only while the
 * view looks from outside and never in a still.
 */

import * as THREE from 'three';
import { cameraAt } from '../animate';
import { cameraPose } from '../camera';
import type { LimelightScene } from '../types';

const PATH = 0x2f9e95;
const SHOT = 0x2f9e95;
const NOW = 0xf59e0b;

export class CameraGuides {
  readonly group = new THREE.Group();
  private readonly path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: PATH, transparent: true, opacity: 0.85, toneMapped: false }));
  private readonly aims = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: SHOT, transparent: true, opacity: 0.35, toneMapped: false }));
  private readonly markers = new THREE.Group();
  private readonly markerGeometry = new THREE.SphereGeometry(1, 16, 12);
  private readonly markerMaterial = new THREE.MeshBasicMaterial({ color: SHOT, toneMapped: false });
  private readonly now = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: NOW, toneMapped: false }));
  private drawnFor: LimelightScene | null = null;

  constructor() {
    this.group.add(this.path, this.aims, this.markers, this.now);
    this.group.visible = false;
    this.group.renderOrder = 10;
  }

  /** Draws the path and shots again when the scene changed, and the camera at `time` every time. */
  update(scene: LimelightScene, time: number) {
    const aspect = scene.format.width / scene.format.height;
    if (scene !== this.drawnFor) {
      this.drawnFor = scene;
      const samples = Math.max(24, Math.ceil(scene.format.duration * 12));
      const points: number[] = [];
      for (let i = 0; i <= samples; i++) {
        const p = cameraPose(cameraAt(scene.camera.shots, 0, (scene.format.duration * i) / samples), aspect).position;
        points.push(p.x, p.y, p.z);
      }
      this.path.geometry.dispose();
      this.path.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const aims: number[] = [];
      for (const child of [...this.markers.children]) this.markers.remove(child);
      // Markers sized for a camera tens of centimetres away, so a shot reads as a dot.
      const size = Math.max(0.5, Math.min(2.5, scene.camera.shots[0].camera.distance * 0.025));
      for (const shot of scene.camera.shots) {
        const pose = cameraPose(shot.camera, aspect);
        const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial);
        marker.position.set(pose.position.x, pose.position.y, pose.position.z);
        marker.scale.setScalar(size);
        this.markers.add(marker);
        aims.push(pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z);
      }
      this.aims.geometry.dispose();
      this.aims.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(aims, 3));
    }
    // The camera at the playhead: a pyramid from the lens toward what it sees, a quarter of the way there.
    const camera = cameraAt(scene.camera.shots, scene.camera.shake, time);
    const pose = cameraPose(camera, aspect);
    const reach = Math.max(2, camera.distance * 0.28);
    const forward = new THREE.Vector3(pose.target.x - pose.position.x, pose.target.y - pose.position.y, pose.target.z - pose.position.z).normalize();
    const up = new THREE.Vector3(pose.up.x, pose.up.y, pose.up.z);
    const right = new THREE.Vector3(pose.right.x, pose.right.y, pose.right.z);
    const halfV = Math.tan((pose.fov * Math.PI) / 360) * reach;
    const halfH = halfV * aspect;
    const apex = new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z);
    const middle = apex.clone().addScaledVector(forward, reach);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sy]) => middle.clone().addScaledVector(right, sx * halfH).addScaledVector(up, sy * halfV));
    const lines: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3) => lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let i = 0; i < 4; i++) {
      push(apex, corners[i]);
      push(corners[i], corners[(i + 1) % 4]);
    }
    // A tick on the top edge, so the pyramid shows which way is up in the picture.
    const top = middle.clone().addScaledVector(up, halfV);
    push(top, top.clone().addScaledVector(up, halfV * 0.35));
    this.now.geometry.dispose();
    this.now.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  }

  dispose() {
    this.path.geometry.dispose();
    (this.path.material as THREE.Material).dispose();
    this.aims.geometry.dispose();
    (this.aims.material as THREE.Material).dispose();
    this.markerGeometry.dispose();
    this.markerMaterial.dispose();
    this.now.geometry.dispose();
    (this.now.material as THREE.Material).dispose();
  }
}
