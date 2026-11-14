// WS16 task 2 (M2): the field shader, bands mode (DESIGN U2 implementation 2-4, §6.4). Lazy: only
// layer.ts imports it, and the planning map loads layer.ts with a dynamic import.
// CPU mirror + tests: decode.ts (decode, manual bilinear, band classification).
//
// Per fragment: fetch the four neighbours of each t_home texture with texelFetch (nearest; encoded
// bytes are never filtered), decode R*256 + G, interpolate the decoded counts bilinearly; any
// neighbour with A = 0 -> no value (-1). Cell state (own grid, nearest) decides the hatch:
// unknown terrain = grey hatch only, never a band or warning colour. Known terrain without a
// value (no route home) stays unfilled.
// Second cues (DESIGN §3.1): conservative = densest fill, nominal edge solid, optimistic edge
// dashed; the conservative edge is drawn (solid) only when it is the selected variant.

export const VS = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_pos;   // mercator offset from the grid's NW corner
in vec2 a_uv;    // grid uv, v = 0 north
out vec2 v_uv;
void main() { v_uv = a_uv; gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0); }`

export const FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_t0;    // t_home optimistic   (RGBA8, NEAREST)
uniform sampler2D u_t1;    // t_home nominal
uniform sampler2D u_t2;    // t_home conservative
uniform sampler2D u_state; // cell-state code (R8: 0 assessed, 1 blocked, 2 unknown), own grid
uniform vec2 u_size;       // field grid px
uniform vec2 u_stateSize;  // state grid px
uniform vec4 u_stateXf;    // state uv = xy + field uv * zw
uniform float u_hasState;  // 0: no cell-state grid published -> no hatch from this layer
uniform float u_scale;     // min per count
uniform float u_budget;    // 30 or 60
uniform float u_variant;   // selected: 0 opt, 1 nom, 2 con
uniform float u_showBands, u_showHatch;
uniform float u_hatchPx;   // CSS px
uniform float u_dpr;       // device px per CSS px
uniform float u_lineHalfPx; // CSS px
uniform vec3 u_safe, u_unknown;
uniform vec2 u_opacity;    // tokens overlayOpacity min, max
in vec2 v_uv;
out vec4 o;

float decode(sampler2D s, ivec2 p, out bool known) {
  vec4 c = texelFetch(s, p, 0);
  known = c.a > 0.5;
  return floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5);
}
// Manual bilinear on decoded values; -1 if any of the four neighbours has no value.
// g = analytic gradient (value per grid pixel), 0 where there is no value.
float field(sampler2D s, vec2 uv, out vec2 g) {
  vec2 p = uv * u_size - 0.5;
  vec2 i0 = floor(p);
  vec2 f = p - i0;
  ivec2 mx = ivec2(u_size) - 1;
  ivec2 a = ivec2(i0);
  bool k0, k1, k2, k3;
  float v0 = decode(s, clamp(a, ivec2(0), mx), k0);
  float v1 = decode(s, clamp(a + ivec2(1, 0), ivec2(0), mx), k1);
  float v2 = decode(s, clamp(a + ivec2(0, 1), ivec2(0), mx), k2);
  float v3 = decode(s, clamp(a + ivec2(1, 1), ivec2(0), mx), k3);
  g = vec2(0.0);
  if (!(k0 && k1 && k2 && k3)) return -1.0;
  g = vec2(mix(v1 - v0, v3 - v2, f.y), mix(v2 - v0, v3 - v1, f.x)) * u_scale;
  return mix(mix(v0, v1, f.x), mix(v2, v3, f.x), f.y) * u_scale;
}
// Screen-space gradient (per device px) from the grid gradient g and the grid-px derivatives J.
vec2 screenGrad(vec2 g, vec2 jx, vec2 jy) { return vec2(dot(g, jx), dot(g, jy)); }
// Coverage of a constant-width screen-space line where t crosses the budget (antialiased 1 px ramp).
// The width uses the analytic gradient, never fwidth(t): t jumps to -1 next to cells without a
// value, and fwidth would draw false lines there.
float edge(float t, vec2 sg) {
  if (t < 0.0) return 0.0;
  float w = max(abs(sg.x) + abs(sg.y), 1e-6);
  float d = abs(t - u_budget) / w; // device px from the contour
  return clamp(u_lineHalfPx * u_dpr + 0.5 - d, 0.0, 1.0);
}
void main() {
  // Derivatives first (uniform control flow): grid px per device px, smooth everywhere.
  vec2 gp = v_uv * u_size;
  vec2 jx = dFdx(gp);
  vec2 jy = dFdy(gp);
  vec2 gO, gN, gC;
  float to = field(u_t0, v_uv, gO);
  float tn = field(u_t1, v_uv, gN);
  float tc = field(u_t2, v_uv, gC);
  vec2 sO = screenGrad(gO, jx, jy);
  vec2 sN = screenGrad(gN, jx, jy);
  vec2 sC = screenGrad(gC, jx, jy);
  bool inside = all(greaterThanEqual(v_uv, vec2(0.0))) && all(lessThanEqual(v_uv, vec2(1.0)));

  vec2 suv = u_stateXf.xy + v_uv * u_stateXf.zw;
  ivec2 sp = clamp(ivec2(floor(suv * u_stateSize)), ivec2(0), ivec2(u_stateSize) - 1);
  bool stateIn = all(greaterThanEqual(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)));
  float code = floor(texelFetch(u_state, sp, 0).r * 255.0 + 0.5);
  bool unknownTerrain = u_hasState > 0.5 && (!stateIn || code > 1.5);

  vec2 q = gl_FragCoord.xy / u_dpr; // CSS px
  vec4 col = vec4(0.0);
  if (!inside) {
    col = vec4(0.0);
  } else if (unknownTerrain) {
    if (u_showHatch > 0.5) {
      // grey diagonal hatch in screen space (never a warning colour)
      float h = mod(q.x + q.y, u_hatchPx);
      float line = 1.0 - smoothstep(1.0, 2.0, h);
      col = vec4(u_unknown, u_opacity.y * line);
    }
  } else if (u_showBands > 0.5) {
    float a = 0.0;
    if (to >= 0.0 && to <= u_budget) a = u_opacity.x;
    if (tn >= 0.0 && tn <= u_budget) a = 0.5 * (u_opacity.x + u_opacity.y);
    if (tc >= 0.0 && tc <= u_budget) a = u_opacity.y;
    col = vec4(u_safe, a);
    // optimistic edge: dashed along the contour (tangent from the screen-space gradient)
    vec2 tang = normalize(vec2(-sO.y, sO.x) + 1e-9);
    float s = dot(q, tang);
    float dashOn = step(mod(s, u_hatchPx), 0.5 * u_hatchPx);
    float cov = edge(to, sO) * dashOn;
    cov = max(cov, edge(tn, sN)); // nominal edge: solid
    if (u_variant > 1.5) cov = max(cov, edge(tc, sC)); // conservative edge only when selected
    col = mix(col, vec4(u_safe, 1.0), cov);
  }
  o = vec4(col.rgb * col.a, col.a); // premultiplied
}`

export interface FieldTextureData {
  size: [number, number]
  scale: number
  /** RGBA8 bytes of the three t_home grids (opt, nom, con), encoded as the PNGs. */
  t: [Uint8Array, Uint8Array, Uint8Array]
  /** Cell-state codes (one byte per cell); null = not published (no hatch from this layer). */
  state: { code: Uint8Array; size: [number, number]; xform: [number, number, number, number] } | null
}

export interface BandsUniforms {
  budget: number
  variant: 0 | 1 | 2
  showBands: boolean
  showHatch: boolean
  hatchPx: number
  dpr: number
  lineHalfPx: number
  colors: { safe: [number, number, number]; unknown: [number, number, number] }
  opacity: [number, number]
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)
  if (!s) throw new Error('createShader failed')
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`field shader: ${gl.getShaderInfoLog(s)}`)
  return s
}

/** Upload bytes as a NEAREST texture (no premultiply, no colour conversion); the map shares this context. */
function upload(gl: WebGL2RenderingContext, bytes: Uint8Array, w: number, h: number, single: boolean): WebGLTexture {
  const tex = gl.createTexture()
  if (!tex) throw new Error('createTexture failed')
  gl.bindTexture(gl.TEXTURE_2D, tex)
  const prev = [gl.getParameter(gl.UNPACK_ALIGNMENT), gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL), gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL), gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL)]
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  if (single) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, bytes)
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, prev[0])
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prev[1])
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prev[2])
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, prev[3])
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

/** Program + textures + one vertex buffer; `draw` binds everything it uses. */
export class BandsProgram {
  private readonly prog: WebGLProgram
  private tex: WebGLTexture[] = []
  private readonly buf: WebGLBuffer
  private readonly vao: WebGLVertexArrayObject
  private readonly loc = new Map<string, WebGLUniformLocation | null>()
  private td: FieldTextureData | null = null
  private vertexCount = 0
  private readonly gl: WebGL2RenderingContext

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    const p = gl.createProgram()
    if (!p) throw new Error('createProgram failed')
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`field shader link: ${gl.getProgramInfoLog(p)}`)
    this.prog = p
    const buf = gl.createBuffer()
    const vao = gl.createVertexArray()
    if (!buf || !vao) throw new Error('buffer allocation failed')
    this.buf = buf
    this.vao = vao
  }

  setTextures(td: FieldTextureData): void {
    const gl = this.gl
    this.tex.forEach((t) => gl.deleteTexture(t))
    const [w, h] = td.size
    const st = td.state ?? { code: new Uint8Array(1), size: [1, 1] as [number, number] }
    this.tex = [...td.t.map((d) => upload(gl, d, w, h, false)), upload(gl, st.code, st.size[0], st.size[1], true)]
    this.td = td
  }

  /** Interleaved [x, y, u, v] triangle-strip vertices. */
  setVertices(data: Float32Array): void {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(this.prog, 'a_pos')
    const aUv = gl.getAttribLocation(this.prog, 'a_uv')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8)
    gl.bindVertexArray(null)
    this.vertexCount = data.length / 4
  }

  private u(name: string): WebGLUniformLocation | null {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.prog, name))
    return this.loc.get(name) ?? null
  }

  draw(un: BandsUniforms, matrix: Float32Array): void {
    const gl = this.gl
    const td = this.td
    if (!td) return
    gl.useProgram(this.prog)
    ;['u_t0', 'u_t1', 'u_t2', 'u_state'].forEach((name, i) => {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i])
      gl.uniform1i(this.u(name), i)
    })
    gl.uniformMatrix4fv(this.u('u_matrix'), false, matrix)
    gl.uniform2f(this.u('u_size'), td.size[0], td.size[1])
    gl.uniform2f(this.u('u_stateSize'), td.state?.size[0] ?? 1, td.state?.size[1] ?? 1)
    gl.uniform4fv(this.u('u_stateXf'), td.state?.xform ?? [0, 0, 1, 1])
    gl.uniform1f(this.u('u_hasState'), td.state ? 1 : 0)
    gl.uniform1f(this.u('u_scale'), td.scale)
    gl.uniform1f(this.u('u_budget'), un.budget)
    gl.uniform1f(this.u('u_variant'), un.variant)
    gl.uniform1f(this.u('u_showBands'), un.showBands ? 1 : 0)
    gl.uniform1f(this.u('u_showHatch'), un.showHatch ? 1 : 0)
    gl.uniform1f(this.u('u_hatchPx'), un.hatchPx)
    gl.uniform1f(this.u('u_dpr'), un.dpr)
    gl.uniform1f(this.u('u_lineHalfPx'), un.lineHalfPx)
    gl.uniform3fv(this.u('u_safe'), un.colors.safe)
    gl.uniform3fv(this.u('u_unknown'), un.colors.unknown)
    gl.uniform2f(this.u('u_opacity'), un.opacity[0], un.opacity[1])
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.vertexCount)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    this.tex.forEach((t) => gl.deleteTexture(t))
    gl.deleteBuffer(this.buf)
    gl.deleteVertexArray(this.vao)
    gl.deleteProgram(this.prog)
  }
}
