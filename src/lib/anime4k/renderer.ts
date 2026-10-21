/**
 * Real-time Anime4K for the player: decoded video frames go through Anime4K's
 * CNN restore and x2 upscale passes on the GPU (WebGPU) and are drawn to a
 * canvas laid exactly over the <video>. Shader ports are vendored from
 * Anime4K-WebGPU (MIT, see vendor/LICENSE.md), after bloc97's Anime4K (MIT).
 *
 * Loaded on demand: nothing here is in the main bundle.
 */
import vertexWGSL from "./vendor/renderer/shaders/fullscreenTexturedQuad.wgsl?raw";
import fragmentWGSL from "./vendor/renderer/shaders/sampleExternalTexture.wgsl?raw";
import { ClampHighlights } from "./vendor/pipelines/helpers/ClampHighlights";
import type { Anime4KPipeline } from "./vendor/pipelines/interfaces";
import { CNNM } from "./vendor/pipelines/restore/CNNM";
import { CNNx2M } from "./vendor/pipelines/upscale/CNNx2M";

type Network = new (descriptor: { device: GPUDevice; inputTexture: GPUTexture }) => Anime4KPipeline;
type Networks = { restore: Network; upscale: Network };

const FAST: Networks = { restore: CNNM, upscale: CNNx2M };
let hqNetworks: Promise<Networks> | undefined;

/** The large (VL) networks are ~400 kB of shader weights; load them only for HQ. */
function loadNetworks(quality: Anime4KQuality): Promise<Networks> {
  if (quality === "fast") return Promise.resolve(FAST);
  hqNetworks ??= Promise.all([
    import("./vendor/pipelines/restore/CNNVL"),
    import("./vendor/pipelines/upscale/CNNx2VL"),
  ]).then(([restore, upscale]) => ({ restore: restore.CNNVL, upscale: upscale.CNNx2VL }));
  return hqNetworks;
}

import { targetSize, upscalePasses, type Anime4KQuality, type Size } from "./sizing";

export type { Anime4KQuality } from "./sizing";

/**
 * How frames reach the GPU. "video" copies straight from the <video> (the
 * fast path); "bitmap" goes through createImageBitmap first, for WebViews
 * whose video decoder cannot share frames with WebGPU directly.
 */
export type FrameSource = "video" | "bitmap";

export type Anime4KEvent =
  | { type: "slow"; quality: Anime4KQuality }
  | { type: "error"; message: string };

type Chain = { input: GPUTexture; passes: Anime4KPipeline[]; bindGroup: GPUBindGroup; textures: GPUTexture[]; native: Size; upscales: number };

/** GPU textures the vendored pipelines allocate, so a rebuild can free them. */
function trackingDevice(device: GPUDevice, textures: GPUTexture[]): GPUDevice {
  return new Proxy(device, {
    get(target, property) {
      if (property === "createTexture") {
        return (descriptor: GPUTextureDescriptor) => {
          const texture = target.createTexture(descriptor);
          textures.push(texture);
          return texture;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class Anime4KRenderer {
  private chain: Chain | null = null;
  private frameHandle = 0;
  private stopped = false;
  private slowFrames = 0;
  private measured = 0;
  private renderPipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private format: GPUTextureFormat;

  private constructor(
    // Held for the renderer's lifetime: some WebGPU implementations lose the
    // device once its adapter is garbage-collected.
    readonly adapter: GPUAdapter,
    private device: GPUDevice,
    private context: GPUCanvasContext,
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private quality: Anime4KQuality,
    private onEvent: (event: Anime4KEvent) => void,
    readonly source: FrameSource,
    private networks: Networks,
  ) {
    this.format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: this.format, alphaMode: "opaque" });
    this.renderPipeline = device.createRenderPipeline({
      label: "anime4k present",
      layout: "auto",
      vertex: { module: device.createShaderModule({ code: vertexWGSL }), entryPoint: "vert_main" },
      fragment: { module: device.createShaderModule({ code: fragmentWGSL }), entryPoint: "main", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
    });
    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    device.lost.then((info) => {
      if (!this.stopped) onEvent({ type: "error", message: `GPU device lost: ${info.message || info.reason}` });
    });
  }

  static async start(video: HTMLVideoElement, canvas: HTMLCanvasElement, quality: Anime4KQuality, onEvent: (event: Anime4KEvent) => void, source: FrameSource = "video") {
    const networks = await loadNetworks(quality);
    // Some WebViews answer only the default request (no power preference).
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
      ?? await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error("WebGPU is not available");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    if (!context) {
      device.destroy();
      throw new Error("Could not create a WebGPU canvas");
    }
    const renderer = new Anime4KRenderer(adapter, device, context, video, canvas, quality, onEvent, source, networks);
    renderer.schedule();
    return renderer;
  }

  /** Step down to the fast networks (used when HQ cannot keep up). */
  setQuality(quality: Anime4KQuality) {
    if (quality === this.quality) return;
    this.quality = quality;
    if (quality === "fast") this.networks = FAST;
    this.disposeChain();
  }

  /** Match the canvas backing store to the box the video occupies on screen. */
  resize(box: Size, pixelRatio = window.devicePixelRatio || 1) {
    const native = { width: this.video.videoWidth, height: this.video.videoHeight };
    if (!native.width || !native.height || !box.width || !box.height) return;
    // Cap at 2x: a 3x phone screen triples the CNN work for little gain.
    const target = targetSize(box, native, Math.min(pixelRatio, 2));
    if (this.canvas.width !== target.width || this.canvas.height !== target.height) {
      this.canvas.width = target.width;
      this.canvas.height = target.height;
    }
    if (this.chain && this.chain.upscales !== upscalePasses(native, target)) this.disposeChain();
    if (this.video.paused) this.draw();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if ("cancelVideoFrameCallback" in this.video) this.video.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
    this.disposeChain();
    this.context.unconfigure();
    this.device.destroy();
  }

  private schedule() {
    if (this.stopped) return;
    // Render once per decoded frame where supported; rAF otherwise.
    if ("requestVideoFrameCallback" in this.video) {
      this.frameHandle = this.video.requestVideoFrameCallback(() => { this.draw(); this.schedule(); });
    } else {
      this.frameHandle = requestAnimationFrame(() => { if (!this.video.paused) this.draw(); this.schedule(); });
    }
  }

  private build(native: Size): Chain {
    const textures: GPUTexture[] = [];
    const device = trackingDevice(this.device, textures);
    const input = device.createTexture({
      label: "anime4k frame",
      size: [native.width, native.height, 1],
      format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const upscales = upscalePasses(native, { width: this.canvas.width, height: this.canvas.height });
    const passes: Anime4KPipeline[] = [];
    let current = input;
    const add = (pass: Anime4KPipeline) => { passes.push(pass); current = pass.getOutputTexture(); };
    add(new ClampHighlights({ device, inputTexture: current }));
    add(new this.networks.restore({ device, inputTexture: current }));
    if (upscales >= 1) add(new this.networks.upscale({ device, inputTexture: current }));
    if (upscales >= 2) add(new CNNx2M({ device, inputTexture: current }));
    const bindGroup = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: current.createView() },
      ],
    });
    return { input, passes, bindGroup, textures, native, upscales };
  }

  private disposeChain() {
    for (const texture of this.chain?.textures ?? []) texture.destroy();
    this.chain = null;
  }

  private bitmapPending = false;
  /** One frame on the GPU at a time: queueing more starves the page's own
   *  compositing, so taps would update the controls but never show them. */
  private inFlight = false;
  private redraw = false;

  private draw() {
    if (this.stopped) return;
    if (this.inFlight) {
      if (this.video.paused) this.redraw = true;
      else this.measure(Infinity);
      return;
    }
    if (this.source === "bitmap") {
      if (this.bitmapPending || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      this.bitmapPending = true;
      void createImageBitmap(this.video)
        .then((frame) => { this.process(frame, { width: frame.width, height: frame.height }); frame.close(); })
        .catch((reason) => this.onEvent({ type: "error", message: reason instanceof Error ? reason.message : String(reason) }))
        .finally(() => { this.bitmapPending = false; });
      return;
    }
    const native = { width: this.video.videoWidth, height: this.video.videoHeight };
    if (!native.width || !native.height || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.process(this.video, native);
  }

  private process(frame: HTMLVideoElement | ImageBitmap, native: Size) {
    if (this.stopped) return;
    if (this.chain && (this.chain.native.width !== native.width || this.chain.native.height !== native.height)) this.disposeChain();
    try {
      this.chain ??= this.build(native);
      this.device.queue.copyExternalImageToTexture({ source: frame }, { texture: this.chain.input }, [native.width, native.height]);
    } catch (reason) {
      this.onEvent({ type: "error", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }
    const encoder = this.device.createCommandEncoder();
    for (const pass of this.chain.passes) pass.pass(encoder);
    const present = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
    });
    present.setPipeline(this.renderPipeline);
    present.setBindGroup(0, this.chain.bindGroup);
    present.draw(6);
    present.end();
    const submitted = performance.now();
    this.device.queue.submit([encoder.finish()]);
    this.inFlight = true;
    void this.device.queue.onSubmittedWorkDone().then(() => {
      this.inFlight = false;
      if (!this.video.paused) this.measure(performance.now() - submitted);
      if (this.redraw && !this.stopped) { this.redraw = false; this.draw(); }
    }, () => { this.inFlight = false; });
  }

  /** Report when the GPU cannot keep up with playback: most frames over
   *  budget, or dropped because the previous one was still running. */
  private measure(elapsedMs: number) {
    if (this.stopped) return;
    const budget = 1000 / 30;
    this.measured += 1;
    if (elapsedMs > budget) this.slowFrames += 1;
    if (this.measured < 90) return;
    const slow = this.slowFrames / this.measured > 0.5;
    this.measured = 0;
    this.slowFrames = 0;
    if (slow) this.onEvent({ type: "slow", quality: this.quality });
  }
}
