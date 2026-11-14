// "Look" of the 3D view (F20): Mars sky gradient with the sun, distance haze, curvature drop and
// the far-skyline ring curtain. Rendering only: nothing here produces a number shown as a result.
// Imported only by view.ts, so it ships in the lazy Three.js chunk.
import * as THREE from 'three'
import type { Fp3dConfig } from './config'
import type { RingCurtain } from './ring'
import type { Anchor } from './terrain'

/** sRGB 0-255 config colour -> THREE.Color (linear working space). */
export const rgb = (c: readonly number[]) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace)

/**
 * Bend a material's vertices down by the curvature drop d^2 / 2R, d = horizontal distance to the
 * camera (the same term WS3's horizon engine uses), so far terrain and the ring sit where the
 * computed horizon expects them.
 */
export function withCurvature<M extends THREE.Material>(m: M, radiusM: number): M {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.curvR = { value: radiusM }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float curvR;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        `{
  vec3 wpC = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec2 ddC = wpC.xz - cameraPosition.xz;
  transformed.y -= dot(ddC, ddC) / (2.0 * curvR);
}
#include <project_vertex>`,
      )
  }
  m.customProgramCacheKey = () => `curv${radiusM}`
  return m
}

/** exp2 fog density giving 50 % haze at `halfM`: 1 - exp(-(k d)^2) = 0.5. */
export function hazeDensity(halfM: number): number {
  return Math.sqrt(Math.LN2) / halfM
}

export interface Sky {
  mesh: THREE.Mesh
  /** horizon (= haze) colour at the current brightness */
  horizon: THREE.Color
  update(camera: THREE.Camera, sunDir: THREE.Vector3, brightness: number): void
  dispose(): void
}

/** Sky dome around the camera: horizon -> zenith gradient, sun glow and disc. */
export function createSky(cfg: Fp3dConfig, radius: number): Sky {
  const horizon0 = rgb(cfg.skyRgb)
  const uniforms = {
    zenith: { value: rgb(cfg.sky.zenithRgb) },
    horizon: { value: horizon0.clone() },
    glow: { value: rgb(cfg.sky.sunGlowRgb) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    glowCos: { value: Math.cos((cfg.sky.sunGlowDeg * Math.PI) / 180) },
    discCos: { value: Math.cos((cfg.sky.sunDiscDeg * Math.PI) / 180) },
    brightness: { value: 1 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir;
uniform float glowCos; uniform float discCos; uniform float brightness;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(horizon, zenith, pow(up, 0.6));
  float ca = dot(d, normalize(sunDir));
  float g = clamp((ca - glowCos) / (1.0 - glowCos), 0.0, 1.0);
  c = mix(c, glow, g * g * 0.85);
  c *= brightness;
  if (ca > discCos && sunDir.y > -0.02) c = vec3(1.0, 0.98, 0.94);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
  })
  const geo = new THREE.SphereGeometry(radius, 48, 24)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  const horizon = horizon0.clone()
  return {
    mesh,
    horizon,
    update(camera, sunDir, brightness) {
      mesh.position.copy(camera.position)
      uniforms.sunDir.value.copy(sunDir)
      uniforms.brightness.value = brightness
      horizon.copy(horizon0).multiplyScalar(brightness)
      uniforms.horizon.value.copy(horizon0)
    },
    dispose() {
      geo.dispose()
      mat.dispose()
    },
  }
}

/** Triangle strip geometry of the ring curtain (top = skyline points, bottom = skirt). */
export function ringGeometry(c: RingCurtain, anchor: Anchor): THREE.BufferGeometry | null {
  const pos: number[] = []
  const idx: number[] = []
  c.segments.forEach((seg, si) => {
    const base = pos.length / 3
    seg.forEach((p, k) => {
      const z = -(p.y - anchor.y)
      pos.push(p.x - anchor.x, p.z - anchor.h, z, p.x - anchor.x, c.bottoms[si][k] - anchor.h, z)
    })
    for (let k = 0; k + 1 < seg.length; k++) {
      const a = base + 2 * k // top k
      const b = a + 1 // bottom k
      const t2 = a + 2 // top k+1
      const b2 = a + 3 // bottom k+1
      idx.push(a, b, t2, t2, b, b2)
    }
  })
  if (!idx.length) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}
