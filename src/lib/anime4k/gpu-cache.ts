/**
 * Compiled shaders, layouts and compute pipelines, kept for the renderer's
 * lifetime. A rebuild (resizing, fullscreen, another pass count) then only
 * allocates textures instead of recompiling every network layer, which is
 * what stalls the page. Layouts are shared by descriptor, so a cached
 * pipeline always gets bind groups made from its own layout objects.
 */
export class GpuCache {
  modules = new Map<string, GPUShaderModule>();
  layouts = new Map<string, GPUBindGroupLayout | GPUPipelineLayout>();
  pipelines = new Map<string, GPUComputePipeline>();
  /** A short id per cached module or layout, for building pipeline keys. */
  keys = new WeakMap<object, string>();
  next = 0;
}

function layoutKey(entries: Iterable<GPUBindGroupLayoutEntry>): string {
  return JSON.stringify(Array.from(entries, (entry) => ({ ...entry })));
}

/**
 * The device the vendored pipelines see: records the textures they allocate
 * (so a rebuild can free them) and reuses compiled objects from `cache`.
 * With `warming`, pipelines compile asynchronously into the cache and the
 * chain it builds is only a template, never run.
 */
export function cachingDevice(device: GPUDevice, textures: GPUTexture[], cache: GpuCache, warming?: Promise<unknown>[]): GPUDevice {
  const remember = <T extends object>(key: string, make: () => T, store: Map<string, T>) => {
    let value = store.get(key);
    if (!value) {
      value = make();
      store.set(key, value);
      cache.keys.set(value, `#${cache.next++}`);
    }
    return value;
  };
  return new Proxy(device, {
    get(target, property) {
      switch (property) {
        case "createTexture":
          return (descriptor: GPUTextureDescriptor) => {
            const texture = target.createTexture(descriptor);
            textures.push(texture);
            return texture;
          };
        case "createShaderModule":
          return (descriptor: GPUShaderModuleDescriptor) => remember(`m:${descriptor.code}`, () => target.createShaderModule(descriptor), cache.modules);
        case "createBindGroupLayout":
          return (descriptor: GPUBindGroupLayoutDescriptor) => remember(`b:${layoutKey(descriptor.entries)}`, () => target.createBindGroupLayout(descriptor), cache.layouts as Map<string, GPUBindGroupLayout>);
        case "createPipelineLayout":
          return (descriptor: GPUPipelineLayoutDescriptor) => {
            const groups = Array.from(descriptor.bindGroupLayouts, (layout) => (layout ? cache.keys.get(layout) : "-"));
            if (groups.some((key) => key === undefined)) return target.createPipelineLayout(descriptor);
            return remember(`p:${groups.join("|")}`, () => target.createPipelineLayout(descriptor), cache.layouts as Map<string, GPUPipelineLayout>);
          };
        case "createComputePipeline":
          return (descriptor: GPUComputePipelineDescriptor) => {
            const module = cache.keys.get(descriptor.compute.module);
            const layout = descriptor.layout === "auto" ? undefined : cache.keys.get(descriptor.layout);
            const key = module && layout ? `c:${module}|${descriptor.compute.entryPoint ?? ""}|${layout}` : undefined;
            const cached = key ? cache.pipelines.get(key) : undefined;
            if (cached) return cached;
            if (warming && key) {
              warming.push(target.createComputePipelineAsync(descriptor).then((pipeline) => { cache.pipelines.set(key, pipeline); }));
              // The template chain is discarded unrun; nothing reads this.
              return null as unknown as GPUComputePipeline;
            }
            const pipeline = target.createComputePipeline(descriptor);
            if (key) cache.pipelines.set(key, pipeline);
            return pipeline;
          };
        default: {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
}
