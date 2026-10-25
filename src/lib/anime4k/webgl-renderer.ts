/**
 * Anime4K on WebGL2, for WebViews without WebGPU (macOS 15, iOS 18 and
 * older): bloc97's original GLSL (MIT, see glsl/LICENSE), CNN restore and
 * x2 upscale at the M size, run as fragment passes into half-float targets.
 * Highlight clamping and the large networks stay WebGPU-only.
 *
 * Loaded on demand, like the WebGPU renderer.
 */
import restoreSource from "./glsl/Anime4K_Restore_CNN_M.glsl?raw";
import upscaleSource from "./glsl/Anime4K_Upscale_CNN_x2_M.glsl?raw";
import { evaluateSize, fragmentSource, parseHookShader, type HookPass } from "./glsl/mpv-hook";
import type { Anime4KEvent, Anime4KQuality, FrameSource } from "./renderer";
import { OUTPUT_LIMITS, targetSize, upscalePasses, type OutputLimits, type Size } from "./sizing";
import { MAX_IN_FLIGHT, PaceMeter } from "./pace";

const VERTEX = `#version 300 es
out vec2 v_pos;
void main() {
  // One triangle covering the target; v_pos runs 0..1 across the picture.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_pos = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const PRESENT = `#version 300 es
precision highp float;
in vec2 v_pos;
out vec4 fragColor;
uniform sampler2D image;
void main() {
  // Textures hold the picture top row first; the canvas draws bottom-up.
  fragColor = vec4(texture(image, vec2(v_pos.x, 1.0 - v_pos.y)).rgb, 1.0);
}`;

type Program = { program: WebGLProgram; pass: HookPass; samplers: { name: string; sampler: WebGLUniformLocation | null; texel: WebGLUniformLocation | null }[] };
type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer | null; size: Size };
type Step = { program: Program; save: string; size: Size; target: Target };

const restorePasses = parseHookShader(restoreSource);
const upscalePassesList = parseHookShader(upscaleSource);

export class Anime4KWebGLRenderer {
  readonly source: FrameSource = "video";
  private gl: WebGL2RenderingContext;
  private programs = new Map<HookPass, Program>();
  private present: WebGLProgram;
  private frame: WebGLTexture;
  private steps: Step[] | null = null;
  private chainNative: Size | null = null;
  private chainUpscales = -1;
  private frameHandle = 0;
  private stopped = false;
  /** Frames not yet finished on the GPU, oldest first (see pace.ts). */
  private fences: WebGLSync[] = [];
  private pace = new PaceMeter(() => this.onEvent({ type: "slow", quality: "fast" }));
  private onLost = (event: Event) => {
    event.preventDefault();
    if (!this.stopped) this.onEvent({ type: "error", message: "WebGL context lost" });
  };

  private constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private onEvent: (event: Anime4KEvent) => void,
  ) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not available");
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) throw new Error("WebGL2 cannot render to half-float textures");
    this.gl = gl;
    this.present = this.link(PRESENT);
    this.frame = this.texture();
    canvas.addEventListener("webglcontextlost", this.onLost);
  }

  static async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, _quality: Anime4KQuality, onEvent: (event: Anime4KEvent) => void) {
    const renderer = new Anime4KWebGLRenderer(video, canvas, onEvent);
    renderer.schedule();
    return renderer;
  }

  /** WebGL2 always runs the M networks. */
  setQuality(_quality: Anime4KQuality) {}

  /** After a seek the decoder catches up for a moment; do not judge that. */
  restartPacing() {
    this.pace.reset();
  }

  resize(box: Size, limits: OutputLimits = OUTPUT_LIMITS.quality, pixelRatio = window.devicePixelRatio || 1) {
    const native = { width: this.video.videoWidth, height: this.video.videoHeight };
    if (!native.width || !native.height || !box.width || !box.height) return;
    // Phones: cap the backing store; the GPU budget goes to the network.
    const target = targetSize(box, native, pixelRatio, limits);
    if (this.canvas.width !== target.width || this.canvas.height !== target.height) {
      this.canvas.width = target.width;
      this.canvas.height = target.height;
    }
    if (this.video.paused) this.draw();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if ("cancelVideoFrameCallback" in this.video) this.video.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.disposeChain();
    const gl = this.gl;
    for (const fence of this.fences) gl.deleteSync(fence);
    this.fences = [];
    gl.deleteTexture(this.frame);
    for (const { program } of this.programs.values()) gl.deleteProgram(program);
    gl.deleteProgram(this.present);
    // No WEBGL_lose_context here: forcing a loss can upset some WebKit
    // builds; the context goes with its canvas, which every start replaces.
  }

  private schedule() {
    if (this.stopped) return;
    if ("requestVideoFrameCallback" in this.video) {
      this.frameHandle = this.video.requestVideoFrameCallback(() => {
        this.draw();
        this.schedule();
      });
    } else {
      this.frameHandle = requestAnimationFrame(() => { if (!this.video.paused) this.draw(); this.schedule(); });
    }
  }

  private compile(type: number, source: string) {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Anime4K shader: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  }

  private link(fragment: string) {
    const gl = this.gl;
    const program = gl.createProgram()!;
    const vertex = this.compile(gl.VERTEX_SHADER, VERTEX);
    const shader = this.compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, shader);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(shader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Anime4K program: ${gl.getProgramInfoLog(program)}`);
    return program;
  }

  private programFor(pass: HookPass): Program {
    let program = this.programs.get(pass);
    if (!program) {
      const linked = this.link(fragmentSource(pass));
      program = {
        program: linked,
        pass,
        samplers: pass.binds.map((name) => ({ name, sampler: this.gl.getUniformLocation(linked, `${name}_raw`), texel: this.gl.getUniformLocation(linked, `${name}_pt`) })),
      };
      this.programs.set(pass, program);
    }
    return program;
  }

  private texture() {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private target(size: Size): Target {
    const gl = this.gl;
    const texture = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size.width, size.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("WebGL2 cannot render to half-float textures");
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, size };
  }

  /** Lays out every pass with its target size, following the shaders' SAVE/WIDTH rules. */
  private build(native: Size, upscales: number): Step[] {
    const files = [restorePasses, ...Array.from({ length: upscales }, () => upscalePassesList)];
    const sizes: Record<string, Size> = { MAIN: native };
    const steps: Step[] = [];
    for (const passes of files) {
      for (const pass of passes) {
        const fallback = sizes[pass.binds[0]];
        const size = {
          width: pass.width ? evaluateSize(pass.width, sizes) : fallback.width,
          height: pass.height ? evaluateSize(pass.height, sizes) : fallback.height,
        };
        steps.push({ program: this.programFor(pass), save: pass.save, size, target: this.target(size) });
        sizes[pass.save] = size;
      }
    }
    return steps;
  }

  private disposeChain() {
    const gl = this.gl;
    for (const step of this.steps ?? []) {
      gl.deleteFramebuffer(step.target.framebuffer);
      gl.deleteTexture(step.target.texture);
    }
    this.steps = null;
    this.pace.reset();
  }

  private draw() {
    if (this.stopped) return;
    const gl = this.gl;
    const native = { width: this.video.videoWidth, height: this.video.videoHeight };
    if (!native.width || !native.height || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || gl.isContextLost()) return;
    while (this.fences.length && gl.getSyncParameter(this.fences[0], gl.SYNC_STATUS) === gl.SIGNALED) {
      gl.deleteSync(this.fences.shift()!);
    }
    if (this.fences.length >= MAX_IN_FLIGHT) {
      // Still busy: drop this frame; when paused, look again shortly so the
      // last frame still gets drawn.
      if (this.video.paused) setTimeout(() => this.draw(), 16);
      else this.pace.record(false);
      return;
    }
    const upscales = upscalePasses(native, { width: this.canvas.width, height: this.canvas.height });
    try {
      if (!this.steps || this.chainUpscales !== upscales || this.chainNative?.width !== native.width || this.chainNative?.height !== native.height) {
        this.disposeChain();
        this.steps = this.build(native, upscales);
        this.chainNative = native;
        this.chainUpscales = upscales;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.frame);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
    } catch (reason) {
      this.onEvent({ type: "error", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }
    const textures: Record<string, Target> = { MAIN: { texture: this.frame, framebuffer: null, size: native } };
    for (const step of this.steps) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, step.target.framebuffer);
      gl.viewport(0, 0, step.size.width, step.size.height);
      gl.useProgram(step.program.program);
      step.program.samplers.forEach(({ name, sampler, texel }, unit) => {
        const input = textures[name];
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, input.texture);
        gl.uniform1i(sampler, unit);
        gl.uniform2f(texel, 1 / input.size.width, 1 / input.size.height);
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      textures[step.save] = step.target;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.present);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.MAIN.texture);
    gl.uniform1i(gl.getUniformLocation(this.present, "image"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (fence) this.fences.push(fence);
    gl.flush();
    if (!this.video.paused) this.pace.record(true);
  }
}
