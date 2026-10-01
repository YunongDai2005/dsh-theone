import * as THREE from 'three';
import { useLayoutEffect } from 'react';
import { ThreeCanvas } from '@remotion/three';
import { useThree } from '@react-three/fiber';
import { getRemotionEnvironment } from 'remotion';
import { D, seg } from '../lib/timeline';
import { makeCamera, VW, VH, type Shot } from '../lib/camera';
import type { Theme } from '../lib/theme';
import { World } from './World';
import { Post } from './Post';

function Rig({ shot }: { shot: Shot }) {
  const { camera } = useThree();
  useLayoutEffect(() => {
    const c = makeCamera(shot), cam = camera as THREE.PerspectiveCamera;
    cam.position.copy(c.position); cam.quaternion.copy(c.quaternion); cam.fov = c.fov; cam.near = c.near; cam.far = c.far; cam.aspect = VW / VH;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  }, [shot, camera]);
  return null;
}
// software GL (CI, containers) cannot multisample float targets
const MSAA = typeof window !== 'undefined' && /swiftshader|llvmpipe/i.test((() => { try { const g = document.createElement('canvas').getContext('webgl2'); const x = g?.getExtension('WEBGL_debug_renderer_info'); return g && x ? String(g.getParameter(x.UNMASKED_RENDERER_WEBGL)) : ''; } catch { return ''; } })()) ? 0 : 4;

export function Scene3D({ t, shot, theme }: { t: number; shot: Shot; theme: Theme }) {
  const camQ = makeCamera(shot).quaternion;
  void getRemotionEnvironment;
  return (
    <ThreeCanvas width={VW} height={VH} style={{ position: 'absolute', inset: 0, opacity: seg(t, D - .01, D) }} gl={{ alpha: true, antialias: false, premultipliedAlpha: true }}
      camera={{ fov: shot.fov, near: 10, far: 40000, position: shot.pos }}>
      <Rig shot={shot} />
      <World t={t} theme={theme} camQ={camQ} />
      <Post dark={theme === 'dark'} multisampling={MSAA} />
    </ThreeCanvas>
  );
}
