import * as THREE from 'three';
import * as PP from 'postprocessing';
import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useCurrentFrame } from 'remotion';
import { redraw } from './util';

// Bloom picks up only HDR sources (> 1). By day an additive glow vanishes on a white page, so the glow is laid over
// the image in its own hue instead; at night it is added as light. Alpha is kept so the DOM backdrop shows through.
const FRAG = /* glsl */`
uniform sampler2D tBloom; uniform float mode; uniform float strength;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 g = texture2D(tBloom, uv).rgb * strength;
  float m = max(g.r, max(g.g, g.b));
  if (mode < .5) {
    float a = clamp(1. - exp(-1.6 * m), 0., .92);
    vec3 hue = m > 1e-4 ? g / m : vec3(0.);
    outputColor = vec4(inputColor.rgb * (1. - a) + hue * a, inputColor.a + a * (1. - inputColor.a));
  } else {
    outputColor = vec4(inputColor.rgb + g, clamp(inputColor.a + m, 0., 1.));
  }
}`;
class GlowBlend extends PP.Effect {
  constructor(bloom: THREE.Texture, mode: number, strength: number) {
    super('GlowBlend', FRAG, { blendFunction: PP.BlendFunction.SRC, uniforms: new Map<string, THREE.Uniform>([
      ['tBloom', new THREE.Uniform(bloom)], ['mode', new THREE.Uniform(mode)], ['strength', new THREE.Uniform(strength)]]) });
  }
}

/** Renders the scene through the composer on every frame change (R3F's own loop is not used while rendering). */
export function Post({ dark, strength = 1, multisampling = 4 }: { dark: boolean; strength?: number; multisampling?: number }) {
  const { gl, scene, camera, size } = useThree();
  const frame = useCurrentFrame();
  const { composer, blend } = useMemo(() => {
    const c = new PP.EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling, alpha: true });
    c.addPass(new PP.RenderPass(scene, camera));
    const bloom = new PP.BloomEffect({ blendFunction: PP.BlendFunction.DST, intensity: 1, luminanceThreshold: 1, luminanceSmoothing: .25, mipmapBlur: true, radius: .78, levels: 8 });
    const bl = new GlowBlend(bloom.texture, dark ? 1 : 0, strength);
    c.addPass(new PP.EffectPass(camera, bloom, bl));
    return { composer: c, blend: bl };
  }, [gl, scene, camera, dark, multisampling]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const f = () => composer.render(); redraw.add(f); return () => { redraw.delete(f); composer.dispose(); }; }, [composer]);
  useEffect(() => { composer.setSize(size.width, size.height); }, [composer, size]);
  (blend.uniforms.get('strength') as THREE.Uniform).value = strength;
  useEffect(() => { composer.render(); });
  useFrame(() => composer.render(), 1); // live preview in the Studio
  void frame;
  return null;
}
