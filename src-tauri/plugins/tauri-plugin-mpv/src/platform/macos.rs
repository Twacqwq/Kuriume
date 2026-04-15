//! macOS native video view: OpenGL (mpv render) → IOSurface → Metal (display).
//!
//! Architecture:
//! 1. mpv renders via its OpenGL render API into an offscreen FBO backed by an
//!    IOSurface. This is a hard constraint of libmpv — GL is the only supported
//!    render API type (`MPV_RENDER_API_TYPE_OPENGL`).
//! 2. A Metal texture wraps the same IOSurface (zero-copy, no pixel readback).
//! 3. A dedicated render thread uses a Metal blit command encoder to copy the
//!    IOSurface texture onto a CAMetalLayer drawable, then presents it.
//! 4. The main thread is never involved in frame rendering — only lightweight
//!    NSView frame updates dispatch there via GCD.
//!
//! This gives us a fully Metal display pipeline while keeping only the
//! unavoidable GL render call for mpv. No CGL lock contention, no main-thread
//! jank during macOS fullscreen transitions.

use kuriume_mpv::GpuRenderer;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::ffi::{c_int, c_void};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;

// ── CGL / OpenGL FFI (offscreen mpv rendering only) ─────────────

type CGLPixelFormatObj = *mut c_void;
type CGLContextObj = *mut c_void;

const K_CGL_PFA_ACCELERATED: c_int = 73;
const K_CGL_PFA_COLOR_SIZE: c_int = 8;
const K_CGL_PFA_ALPHA_SIZE: c_int = 11;
const K_CGL_PFA_OPENGL_PROFILE: c_int = 99;
const K_CGL_OGL_PVERSION_3_2_CORE: c_int = 0x3200;

extern "C" {
    fn CGLChoosePixelFormat(
        attribs: *const c_int,
        pix: *mut CGLPixelFormatObj,
        npix: *mut c_int,
    ) -> c_int;
    fn CGLCreateContext(
        pix: CGLPixelFormatObj,
        share: CGLContextObj,
        ctx: *mut CGLContextObj,
    ) -> c_int;
    fn CGLDestroyPixelFormat(pix: CGLPixelFormatObj) -> c_int;
    fn CGLSetCurrentContext(ctx: CGLContextObj) -> c_int;
    fn CGLDestroyContext(ctx: CGLContextObj) -> c_int;
    fn CGLGetCurrentContext() -> CGLContextObj;

    fn glGenFramebuffers(n: c_int, framebuffers: *mut u32);
    fn glBindFramebuffer(target: u32, framebuffer: u32);
    fn glGenTextures(n: c_int, textures: *mut u32);
    fn glBindTexture(target: u32, texture: u32);
    fn glFramebufferTexture2D(
        target: u32,
        attachment: u32,
        textarget: u32,
        texture: u32,
        level: c_int,
    );
    fn glDeleteFramebuffers(n: c_int, framebuffers: *const u32);
    fn glDeleteTextures(n: c_int, textures: *const u32);
    fn glViewport(x: c_int, y: c_int, width: c_int, height: c_int);
    /// Submit pending GL commands for cross-API (GL → Metal) IOSurface sync.
    fn glFlush();

    /// Bind an IOSurface as a GL texture (OpenGL.framework).
    fn CGLTexImageIOSurface2D(
        ctx: CGLContextObj,
        target: u32,
        internal_format: u32,
        width: u32,
        height: u32,
        format: u32,
        ty: u32,
        io_surface: IOSurfaceRef,
        plane: u32,
    ) -> c_int;
}

const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_COLOR_ATTACHMENT0: u32 = 0x8CE0;
const GL_TEXTURE_RECTANGLE: u32 = 0x84F5;
const GL_BGRA: u32 = 0x80E1;
const GL_UNSIGNED_INT_8_8_8_8_REV: u32 = 0x8367;
const GL_RGBA8: u32 = 0x8058;

// ── IOSurface FFI ────────────────────────────────────────────────

type IOSurfaceRef = *mut c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFNumberRef = *const c_void;
type CFAllocatorRef = *const c_void;
type CFTypeRef = *const c_void;

const K_CF_NUMBER_SI32_TYPE: i32 = 3;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[link(name = "IOSurface", kind = "framework")]
extern "C" {
    fn IOSurfaceCreate(properties: CFDictionaryRef) -> IOSurfaceRef;
    fn CFRelease(cf: CFTypeRef);

    fn CFDictionaryCreate(
        allocator: CFAllocatorRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        num_values: i64,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> CFDictionaryRef;

    fn CFNumberCreate(
        allocator: CFAllocatorRef,
        the_type: i32,
        value_ptr: *const c_void,
    ) -> CFNumberRef;

    fn CFStringCreateWithCString(
        alloc: CFAllocatorRef,
        c_str: *const u8,
        encoding: u32,
    ) -> CFStringRef;

    static kCFAllocatorDefault: CFAllocatorRef;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
}

fn io_surface_key(name: &str) -> CFStringRef {
    unsafe {
        CFStringCreateWithCString(
            kCFAllocatorDefault,
            format!("{name}\0").as_ptr(),
            K_CF_STRING_ENCODING_UTF8,
        )
    }
}

fn cf_number_i32(val: i32) -> CFNumberRef {
    unsafe {
        CFNumberCreate(
            kCFAllocatorDefault,
            K_CF_NUMBER_SI32_TYPE,
            &val as *const i32 as *const c_void,
        )
    }
}

/// Create an IOSurface with the given dimensions (BGRA, 4 bytes/pixel).
unsafe fn create_io_surface(width: i32, height: i32) -> IOSurfaceRef {
    let k_width = io_surface_key("IOSurfaceWidth");
    let k_height = io_surface_key("IOSurfaceHeight");
    let k_bpe = io_surface_key("IOSurfaceBytesPerElement");
    let k_bpr = io_surface_key("IOSurfaceBytesPerRow");
    let k_pf = io_surface_key("IOSurfacePixelFormat");

    let v_width = cf_number_i32(width);
    let v_height = cf_number_i32(height);
    let v_bpe = cf_number_i32(4);
    let v_bpr = cf_number_i32(width * 4);
    // 'BGRA' = 0x42475241
    let v_pf = cf_number_i32(0x42475241_u32 as i32);

    let keys: [CFTypeRef; 5] = [
        k_width as CFTypeRef,
        k_height as CFTypeRef,
        k_bpe as CFTypeRef,
        k_bpr as CFTypeRef,
        k_pf as CFTypeRef,
    ];
    let values: [CFTypeRef; 5] = [
        v_width as CFTypeRef,
        v_height as CFTypeRef,
        v_bpe as CFTypeRef,
        v_bpr as CFTypeRef,
        v_pf as CFTypeRef,
    ];

    unsafe {
        let dict = CFDictionaryCreate(
            kCFAllocatorDefault,
            keys.as_ptr(),
            values.as_ptr(),
            5,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        );

        let surface = IOSurfaceCreate(dict);

        CFRelease(dict as CFTypeRef);
        for k in &keys {
            CFRelease(*k);
        }
        for v in &values {
            CFRelease(*v);
        }

        surface
    }
}

// ── Metal FFI ────────────────────────────────────────────────────

/// MTLPixelFormatBGRA8Unorm — matches the IOSurface BGRA pixel format.
const MTL_PIXEL_FORMAT_BGRA8_UNORM: u64 = 80;

#[link(name = "Metal", kind = "framework")]
extern "C" {
    fn MTLCreateSystemDefaultDevice() -> *mut AnyObject;
}

// ── ObjC runtime (autorelease pool for render thread) ────────────

extern "C" {
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}

// ── GCD dispatch FFI (for set_frame only) ────────────────────────

type DispatchQueue = *mut c_void;

extern "C" {
    static _dispatch_main_q: c_void;
    fn dispatch_async_f(
        queue: DispatchQueue,
        context: *mut c_void,
        work: unsafe extern "C" fn(*mut c_void),
    );
    fn dispatch_sync_f(
        queue: DispatchQueue,
        context: *mut c_void,
        work: unsafe extern "C" fn(*mut c_void),
    );
}

#[inline]
unsafe fn dispatch_get_main_queue() -> DispatchQueue {
    unsafe { &_dispatch_main_q as *const c_void as *mut c_void }
}

// ── Render context ───────────────────────────────────────────────

/// Shared state between the render thread and the main struct.
struct RenderCtx {
    // -- OpenGL (offscreen mpv rendering) --
    cgl_ctx: CGLContextObj,
    renderer: GpuRenderer,
    fbo: u32,
    gl_texture: u32,
    io_surface: IOSurfaceRef,
    // -- Metal (display pipeline) --
    /// `id<MTLDevice>` — retained.
    metal_device: *mut AnyObject,
    /// `id<MTLCommandQueue>` — retained.
    metal_queue: *mut AnyObject,
    /// `CAMetalLayer *` — owned by the NSView layer hierarchy.
    metal_layer: *mut AnyObject,
    /// `id<MTLTexture>` wrapping the IOSurface — retained.
    metal_src_tex: *mut AnyObject,
    // -- Dimensions (backing pixels) --
    surface_width: AtomicI32,
    surface_height: AtomicI32,
    /// Desired backing-pixel dimensions, set by `set_frame()`.
    /// The render thread detects changes and recreates the IOSurface /
    /// GL texture / Metal texture to match.
    target_width: AtomicI32,
    target_height: AtomicI32,
    /// Window backing scale factor (e.g. 2.0 on Retina).
    backing_scale: f64,
    // -- Lifecycle --
    alive: AtomicBool,
    /// Set by mpv callback when a new frame is ready.
    needs_render: AtomicBool,
    /// Condvar to wake the render thread.
    wake: std::sync::Condvar,
    wake_lock: std::sync::Mutex<bool>,
}

// SAFETY: The CGL context is only used on the dedicated render thread.
// Metal objects (device, queue, textures) are inherently thread-safe.
// The CAMetalLayer is only mutated during init (main thread) and read
// from the render thread via nextDrawable (thread-safe per Apple docs).
unsafe impl Send for RenderCtx {}
unsafe impl Sync for RenderCtx {}

/// A native `NSView` backed by `CAMetalLayer` for video display.
///
/// mpv renders via OpenGL into an IOSurface, and a Metal blit copies
/// each frame onto the CAMetalLayer drawable for presentation.
pub struct NativeVideoView {
    view: Retained<NSView>,
    render_ctx: Arc<RenderCtx>,
    render_thread: Option<std::thread::JoinHandle<()>>,
}

unsafe impl Send for NativeVideoView {}
unsafe impl Sync for NativeVideoView {}

impl NativeVideoView {
    /// Create the native video view and start the render thread.
    ///
    /// # Safety
    /// - `parent_ptr` must be a valid `NSView *` attached to an `NSWindow`.
    /// - `mpv_handle` must be a valid `mpv_handle *`.
    /// - Must be called on the **main thread**.
    pub unsafe fn new(parent_ptr: *mut c_void, mpv_handle: *mut c_void) -> Result<Self, String> {
        unsafe {
            let parent_view = &*(parent_ptr as *mut NSView);

            let ns_window: *mut AnyObject = msg_send![parent_view, window];
            if ns_window.is_null() {
                return Err("NSView has no parent window".into());
            }
            let content_view: *mut NSView = msg_send![&*ns_window, contentView];
            let content_view_ref = &*content_view;
            let bounds: NSRect = msg_send![content_view_ref, bounds];

            let _mtm = MainThreadMarker::new().ok_or("must be called on main thread")?;

            // ── Metal device + command queue ─────────────────────
            let metal_device = MTLCreateSystemDefaultDevice();
            if metal_device.is_null() {
                return Err("MTLCreateSystemDefaultDevice returned null".into());
            }

            let metal_queue: *mut AnyObject = msg_send![metal_device, newCommandQueue];
            if metal_queue.is_null() {
                let _: () = msg_send![metal_device, release];
                return Err("Failed to create Metal command queue".into());
            }

            // ── Offscreen CGL context for mpv render API ─────────
            let attrs: [c_int; 8] = [
                K_CGL_PFA_ACCELERATED,
                K_CGL_PFA_OPENGL_PROFILE,
                K_CGL_OGL_PVERSION_3_2_CORE,
                K_CGL_PFA_COLOR_SIZE,
                24,
                K_CGL_PFA_ALPHA_SIZE,
                8,
                0, // terminator
            ];

            let mut pix_fmt: CGLPixelFormatObj = std::ptr::null_mut();
            let mut npix: c_int = 0;
            let err = CGLChoosePixelFormat(attrs.as_ptr(), &mut pix_fmt, &mut npix);
            if err != 0 || pix_fmt.is_null() {
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!("CGLChoosePixelFormat failed: {err}"));
            }

            let mut cgl_ctx: CGLContextObj = std::ptr::null_mut();
            let err = CGLCreateContext(pix_fmt, std::ptr::null_mut(), &mut cgl_ctx);
            CGLDestroyPixelFormat(pix_fmt);
            if err != 0 || cgl_ctx.is_null() {
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!("CGLCreateContext failed: {err}"));
            }

            // ── NSView + CAMetalLayer ────────────────────────────
            let mtm = MainThreadMarker::new().unwrap();
            let view: Retained<NSView> =
                msg_send![NSView::alloc(mtm), initWithFrame: bounds];

            // Create a CAMetalLayer and set it as the view's backing layer.
            let metal_layer: *mut AnyObject =
                msg_send![objc2::class!(CAMetalLayer), layer];

            let _: () = msg_send![&view, setWantsLayer: true];
            let _: () = msg_send![&view, setLayer: metal_layer];
            let _: () = msg_send![&view, setAutoresizingMask: 0usize];

            // Configure the Metal layer
            let _: () = msg_send![metal_layer, setDevice: metal_device];
            let _: () = msg_send![metal_layer, setPixelFormat: MTL_PIXEL_FORMAT_BGRA8_UNORM];
            let _: () = msg_send![metal_layer, setFramebufferOnly: false];
            let _: () = msg_send![metal_layer, setOpaque: true];

            // Opaque black background — prevents transparency bleeding
            // through when the window has `transparent: true`.
            let cg_black: *mut AnyObject = msg_send![
                objc2::class!(NSColor), blackColor
            ];
            let cg_color: *mut c_void = msg_send![cg_black, CGColor];
            let _: () = msg_send![metal_layer, setBackgroundColor: cg_color];

            // Match the window's retina scale factor
            let scale: f64 = msg_send![&*ns_window, backingScaleFactor];
            let _: () = msg_send![metal_layer, setContentsScale: scale];

            // contentsGravity = kCAGravityResize — mpv handles aspect ratio
            // internally via letterboxing, so we stretch the drawable to fill
            // the layer. Dynamic resize keeps drawable dimensions in sync with
            // the view's backing pixel size.
            let gravity: *mut AnyObject = msg_send![objc2::class!(NSString),
                stringWithUTF8String: c"resize".as_ptr()];
            let _: () = msg_send![metal_layer, setContentsGravity: gravity];

            // Insert below WKWebView
            let subviews: Retained<AnyObject> = msg_send![content_view_ref, subviews];
            let count: usize = msg_send![&subviews, count];
            if count > 0 {
                let first: *mut AnyObject =
                    msg_send![&subviews, objectAtIndex: 0usize];
                let _: () = msg_send![
                    content_view_ref,
                    addSubview: &*view,
                    positioned: -1isize,
                    relativeTo: &*first
                ];
            } else {
                content_view_ref.addSubview(&view);
            }

            // ── IOSurface + GL FBO ───────────────────────────────
            let backing: NSRect = msg_send![&view, convertRectToBacking: bounds];
            let init_w = (backing.size.width as i32).max(1);
            let init_h = (backing.size.height as i32).max(1);

            // Fix the drawable size to the IOSurface dimensions.
            // Once set explicitly, CAMetalLayer ignores bounds/contentsScale
            // for drawable sizing — it stretches the drawable to fill the layer.
            let _: () = msg_send![
                metal_layer,
                setDrawableSize: NSSize::new(init_w as f64, init_h as f64)
            ];

            let prev_ctx = CGLGetCurrentContext();
            CGLSetCurrentContext(cgl_ctx);

            let io_surface = create_io_surface(init_w, init_h);
            if io_surface.is_null() {
                CGLSetCurrentContext(prev_ctx);
                CGLDestroyContext(cgl_ctx);
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err("Failed to create IOSurface".into());
            }

            // Create GL FBO + texture backed by the IOSurface
            let mut fbo: u32 = 0;
            let mut gl_texture: u32 = 0;
            glGenFramebuffers(1, &mut fbo);
            glGenTextures(1, &mut gl_texture);

            glBindFramebuffer(GL_FRAMEBUFFER, fbo);
            glBindTexture(GL_TEXTURE_RECTANGLE, gl_texture);

            let err = CGLTexImageIOSurface2D(
                cgl_ctx,
                GL_TEXTURE_RECTANGLE,
                GL_RGBA8,
                init_w as u32,
                init_h as u32,
                GL_BGRA,
                GL_UNSIGNED_INT_8_8_8_8_REV,
                io_surface,
                0,
            );
            if err != 0 {
                CGLSetCurrentContext(prev_ctx);
                CGLDestroyContext(cgl_ctx);
                CFRelease(io_surface as CFTypeRef);
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!("CGLTexImageIOSurface2D failed: {err}"));
            }

            glFramebufferTexture2D(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_RECTANGLE,
                gl_texture,
                0,
            );

            // ── Metal texture wrapping the IOSurface ─────────────
            // This is a zero-copy view: the MTLTexture shares storage
            // with the IOSurface, so GL writes are visible to Metal
            // after a glFlush.
            let tex_desc: *mut AnyObject = msg_send![
                objc2::class!(MTLTextureDescriptor),
                texture2DDescriptorWithPixelFormat: MTL_PIXEL_FORMAT_BGRA8_UNORM,
                width: init_w as u64,
                height: init_h as u64,
                mipmapped: false
            ];
            // MTLTextureUsageShaderRead = 1 — required for blit source.
            let _: () = msg_send![tex_desc, setUsage: 1u64];

            let metal_src_tex: *mut AnyObject = msg_send![
                metal_device,
                newTextureWithDescriptor: tex_desc,
                iosurface: io_surface,
                plane: 0u64
            ];
            if metal_src_tex.is_null() {
                CGLSetCurrentContext(prev_ctx);
                CGLDestroyContext(cgl_ctx);
                CFRelease(io_surface as CFTypeRef);
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err("Failed to create Metal texture from IOSurface".into());
            }

            // ── mpv renderer (OpenGL render API) ─────────────────
            let renderer = GpuRenderer::new(mpv_handle)
                .map_err(|e| format!("GpuRenderer::new: {e}"))?;

            CGLSetCurrentContext(prev_ctx);

            // ── Build shared render context ──────────────────────
            let render_ctx = Arc::new(RenderCtx {
                cgl_ctx,
                renderer,
                fbo,
                gl_texture,
                io_surface,
                metal_device,
                metal_queue,
                metal_layer,
                metal_src_tex,
                surface_width: AtomicI32::new(init_w),
                surface_height: AtomicI32::new(init_h),
                target_width: AtomicI32::new(init_w),
                target_height: AtomicI32::new(init_h),
                backing_scale: scale,
                alive: AtomicBool::new(true),
                needs_render: AtomicBool::new(true),
                wake: std::sync::Condvar::new(),
                wake_lock: std::sync::Mutex::new(false),
            });

            // Wire up mpv's render-update callback
            let ctx_ptr = Arc::as_ptr(&render_ctx) as *mut c_void;
            render_ctx
                .renderer
                .set_raw_update_callback(Some(on_mpv_needs_render), ctx_ptr);

            // Start the dedicated render thread
            let render_ctx_for_thread = render_ctx.clone();
            let render_thread = std::thread::Builder::new()
                .name("mpv-render".into())
                .spawn(move || render_loop(render_ctx_for_thread))
                .map_err(|e| format!("Failed to spawn render thread: {e}"))?;

            Ok(Self {
                view,
                render_ctx,
                render_thread: Some(render_thread),
            })
        }
    }

    /// Resize and reposition the video view.
    ///
    /// Coordinates use the parent's coordinate system (bottom-left origin, points).
    pub fn set_frame(&self, x: f64, y: f64, width: f64, height: f64) {
        // Update target dimensions for the render thread to pick up.
        // Backing pixels = points × scale, clamped to ≥1.
        let scale = self.render_ctx.backing_scale;
        let tw = ((width * scale).round() as i32).max(1);
        let th = ((height * scale).round() as i32).max(1);
        self.render_ctx.target_width.store(tw, Ordering::Release);
        self.render_ctx.target_height.store(th, Ordering::Release);

        // Wake the render thread so it can resize even if mpv hasn't
        // signalled a new frame yet.
        {
            let mut pending = self.render_ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.render_ctx.wake.notify_one();
        }

        let view_ptr = Retained::as_ptr(&self.view) as usize;

        #[repr(C)]
        struct FrameCtx {
            view: usize,
            x: f64,
            y: f64,
            w: f64,
            h: f64,
        }
        unsafe impl Send for FrameCtx {}

        let ctx = Box::new(FrameCtx {
            view: view_ptr,
            x,
            y,
            w: width,
            h: height,
        });

        unsafe extern "C" fn apply_frame(raw: *mut c_void) {
            let ctx = unsafe { Box::from_raw(raw as *mut FrameCtx) };
            unsafe {
                let view = ctx.view as *mut NSView;
                let rect = NSRect::new(
                    NSPoint::new(ctx.x, ctx.y),
                    NSSize::new(ctx.w, ctx.h),
                );
                let _: () = msg_send![view, setFrame: rect];
            }
        }

        unsafe {
            dispatch_async_f(
                dispatch_get_main_queue(),
                Box::into_raw(ctx) as *mut c_void,
                apply_frame,
            );
        }
    }

    /// Clean up all resources. Must be called before drop.
    pub fn destroy(&mut self) {
        // Signal render thread to stop
        self.render_ctx.alive.store(false, Ordering::Release);

        // Wake the render thread so it exits
        {
            let mut pending = self.render_ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.render_ctx.wake.notify_one();
        }

        // Wait for render thread to finish — after this, nothing uses
        // the CGL context or the GpuRenderer.
        if let Some(handle) = self.render_thread.take() {
            let _ = handle.join();
        }

        // ── Free mpv render context with CGL current ─────────────
        // mpv_render_context_free calls GL cleanup functions internally
        // (glDeleteQueries, etc.), so the CGL context MUST be current.
        // We do this on the current thread (tokio worker) — CGL contexts
        // are not thread-bound, only "current" is per-thread.
        unsafe {
            let cgl_ctx = self.render_ctx.cgl_ctx;
            CGLSetCurrentContext(cgl_ctx);

            // SAFETY: We have exclusive access — render thread has joined,
            // and the Arc is not shared at this point. Cast away shared
            // ref to get &mut for GpuRenderer::free().
            let ctx_ptr = Arc::as_ptr(&self.render_ctx) as *mut RenderCtx;
            (*ctx_ptr).renderer.free();

            // Clean up GL resources while CGL is still current
            let fbo = self.render_ctx.fbo;
            let gl_texture = self.render_ctx.gl_texture;
            glDeleteFramebuffers(1, &fbo);
            glDeleteTextures(1, &gl_texture);

            // Release IOSurface
            if !self.render_ctx.io_surface.is_null() {
                CFRelease(self.render_ctx.io_surface as CFTypeRef);
            }

            CGLSetCurrentContext(std::ptr::null_mut());
            CGLDestroyContext(cgl_ctx);
        }

        // ── Clean up Metal + view on main thread ─────────────────
        let metal_device = self.render_ctx.metal_device;
        let metal_queue = self.render_ctx.metal_queue;
        let metal_src_tex = self.render_ctx.metal_src_tex;
        let view = &*self.view as *const NSView as *mut NSView;

        #[repr(C)]
        struct CleanupCtx {
            metal_device: *mut AnyObject,
            metal_queue: *mut AnyObject,
            metal_src_tex: *mut AnyObject,
            view: *mut NSView,
        }
        unsafe impl Send for CleanupCtx {}

        let cleanup = Box::new(CleanupCtx {
            metal_device,
            metal_queue,
            metal_src_tex,
            view,
        });

        unsafe extern "C" fn do_cleanup(raw: *mut c_void) {
            let ctx = unsafe { Box::from_raw(raw as *mut CleanupCtx) };
            unsafe {
                if !ctx.metal_src_tex.is_null() {
                    let _: () = msg_send![ctx.metal_src_tex, release];
                }
                if !ctx.metal_queue.is_null() {
                    let _: () = msg_send![ctx.metal_queue, release];
                }
                if !ctx.metal_device.is_null() {
                    let _: () = msg_send![ctx.metal_device, release];
                }
                let _: () = msg_send![ctx.view, removeFromSuperview];
            }
        }

        unsafe {
            dispatch_sync_f(
                dispatch_get_main_queue(),
                Box::into_raw(cleanup) as *mut c_void,
                do_cleanup,
            );
        }
    }
}

impl Drop for NativeVideoView {
    fn drop(&mut self) {
        if self.render_ctx.alive.load(Ordering::Acquire) {
            // Safety net — destroy() should have been called already.
            self.render_ctx.alive.store(false, Ordering::Release);
            let mut pending = self.render_ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.render_ctx.wake.notify_one();
        }
    }
}

// ── mpv update callback ─────────────────────────────────────────

/// Called from mpv's internal thread when a new frame is available.
/// Wakes the render thread via condvar — no main queue involved.
unsafe extern "C" fn on_mpv_needs_render(ctx: *mut c_void) {
    let render_ctx = unsafe { &*(ctx as *const RenderCtx) };
    if !render_ctx.alive.load(Ordering::Acquire) {
        return;
    }
    render_ctx.needs_render.store(true, Ordering::Release);
    let mut pending = render_ctx.wake_lock.lock().unwrap();
    *pending = true;
    render_ctx.wake.notify_one();
}

// ── Dedicated render thread ─────────────────────────────────────

/// Recreate the IOSurface, GL texture, and Metal texture at a new size.
///
/// # Safety
/// Must be called on the render thread with CGL context current.
/// The caller must ensure exclusive access to the mutable RenderCtx fields
/// (guaranteed because the render thread is the sole mutator after init).
unsafe fn resize_surface(ctx: &Arc<RenderCtx>, new_w: i32, new_h: i32) {
    let ctx_ptr = Arc::as_ptr(ctx) as *mut RenderCtx;

    // 1. Delete old GL texture (keep FBO — just rebind attachment)
    glDeleteTextures(1, &(*ctx_ptr).gl_texture);

    // 2. Release old IOSurface
    if !(*ctx_ptr).io_surface.is_null() {
        CFRelease((*ctx_ptr).io_surface as CFTypeRef);
    }

    // 3. Create new IOSurface
    let new_surface = create_io_surface(new_w, new_h);
    if new_surface.is_null() {
        log::error!("resize_surface: failed to create IOSurface {new_w}×{new_h}");
        return;
    }

    // 4. Create new GL texture backed by the new IOSurface
    let mut new_tex: u32 = 0;
    glGenTextures(1, &mut new_tex);
    glBindTexture(GL_TEXTURE_RECTANGLE, new_tex);

    let err = CGLTexImageIOSurface2D(
        (*ctx_ptr).cgl_ctx,
        GL_TEXTURE_RECTANGLE,
        GL_RGBA8,
        new_w as u32,
        new_h as u32,
        GL_BGRA,
        GL_UNSIGNED_INT_8_8_8_8_REV,
        new_surface,
        0,
    );
    if err != 0 {
        log::error!("resize_surface: CGLTexImageIOSurface2D failed: {err}");
        glDeleteTextures(1, &new_tex);
        CFRelease(new_surface as CFTypeRef);
        return;
    }

    // 5. Rebind FBO color attachment to the new texture
    glBindFramebuffer(GL_FRAMEBUFFER, (*ctx_ptr).fbo);
    glFramebufferTexture2D(
        GL_FRAMEBUFFER,
        GL_COLOR_ATTACHMENT0,
        GL_TEXTURE_RECTANGLE,
        new_tex,
        0,
    );

    // 6. Release old Metal source texture
    if !(*ctx_ptr).metal_src_tex.is_null() {
        let _: () = msg_send![(*ctx_ptr).metal_src_tex, release];
    }

    // 7. Create new Metal texture wrapping the new IOSurface
    let tex_desc: *mut AnyObject = msg_send![
        objc2::class!(MTLTextureDescriptor),
        texture2DDescriptorWithPixelFormat: MTL_PIXEL_FORMAT_BGRA8_UNORM,
        width: new_w as u64,
        height: new_h as u64,
        mipmapped: false
    ];
    let _: () = msg_send![tex_desc, setUsage: 1u64]; // MTLTextureUsageShaderRead

    let new_metal_tex: *mut AnyObject = msg_send![
        (*ctx_ptr).metal_device,
        newTextureWithDescriptor: tex_desc,
        iosurface: new_surface,
        plane: 0u64
    ];

    if new_metal_tex.is_null() {
        log::error!("resize_surface: failed to create Metal texture");
        // Rollback: we've already bound the new GL texture, so leave it.
        // The old metal_src_tex was released, set to null.
        (*ctx_ptr).metal_src_tex = std::ptr::null_mut();
        (*ctx_ptr).gl_texture = new_tex;
        (*ctx_ptr).io_surface = new_surface;
        return;
    }

    // 8. Update drawableSize on the CAMetalLayer
    let _: () = msg_send![
        (*ctx_ptr).metal_layer,
        setDrawableSize: NSSize::new(new_w as f64, new_h as f64)
    ];

    // 9. Store new resources
    (*ctx_ptr).gl_texture = new_tex;
    (*ctx_ptr).io_surface = new_surface;
    (*ctx_ptr).metal_src_tex = new_metal_tex;

    // 10. Publish new dimensions
    ctx.surface_width.store(new_w, Ordering::Release);
    ctx.surface_height.store(new_h, Ordering::Release);
}

/// Render loop running on a dedicated thread.
///
/// Each iteration:
/// 1. Waits for mpv to signal a new frame via condvar.
/// 2. OpenGL: renders mpv frame into the IOSurface-backed FBO, then `glFlush`.
/// 3. Metal: blits the IOSurface texture → CAMetalLayer drawable, then presents.
///
/// The main thread is never touched for frame rendering.
fn render_loop(ctx: Arc<RenderCtx>) {
    // Make the CGL context current on this thread (sole owner).
    unsafe {
        CGLSetCurrentContext(ctx.cgl_ctx);
    }

    while ctx.alive.load(Ordering::Acquire) {
        // Wait for a wake signal (mpv frame ready)
        {
            let mut pending = ctx.wake_lock.lock().unwrap();
            while !*pending && ctx.alive.load(Ordering::Acquire) {
                let result = ctx
                    .wake
                    .wait_timeout(pending, std::time::Duration::from_millis(500))
                    .unwrap();
                pending = result.0;
            }
            *pending = false;
        }

        if !ctx.alive.load(Ordering::Acquire) {
            break;
        }

        let mut need_frame = ctx.needs_render.swap(false, Ordering::AcqRel);

        // Check if the viewport changed — resize before rendering.
        let tw = ctx.target_width.load(Ordering::Acquire);
        let th = ctx.target_height.load(Ordering::Acquire);
        let cw = ctx.surface_width.load(Ordering::Acquire);
        let ch = ctx.surface_height.load(Ordering::Acquire);
        if (tw != cw || th != ch) && tw > 0 && th > 0 {
            unsafe { resize_surface(&ctx, tw, th); }
            // Force a re-render so the resized surface isn't blank
            // (e.g. when paused and the window is resized/fullscreened).
            need_frame = true;
        }

        if !need_frame {
            continue;
        }

        let w = ctx.surface_width.load(Ordering::Acquire);
        let h = ctx.surface_height.load(Ordering::Acquire);

        if w <= 0 || h <= 0 {
            continue;
        }

        unsafe {
            // ── Step 1: OpenGL — render mpv frame → IOSurface ────
            glBindFramebuffer(GL_FRAMEBUFFER, ctx.fbo);
            glViewport(0, 0, w as c_int, h as c_int);
            let _ = ctx.renderer.render(ctx.fbo as i32, w, h);
            // Flush GL commands so the IOSurface is ready for Metal.
            glFlush();

            // ── Step 2: Metal — blit IOSurface → CAMetalLayer ────
            let pool = objc_autoreleasePoolPush();

            let drawable: *mut AnyObject =
                msg_send![ctx.metal_layer, nextDrawable];

            if !drawable.is_null() {
                let dst_tex: *mut AnyObject = msg_send![drawable, texture];
                if dst_tex.is_null() {
                    objc_autoreleasePoolPop(pool);
                    continue;
                }
                let cmd_buf: *mut AnyObject =
                    msg_send![ctx.metal_queue, commandBuffer];
                if cmd_buf.is_null() {
                    objc_autoreleasePoolPop(pool);
                    continue;
                }
                let blit: *mut AnyObject =
                    msg_send![cmd_buf, blitCommandEncoder];

                // Zero-copy blit: IOSurface texture → drawable texture.
                // Both textures have identical dimensions and pixel format
                // (BGRA8Unorm, init_w × init_h).
                let _: () = msg_send![
                    blit,
                    copyFromTexture: ctx.metal_src_tex,
                    toTexture: dst_tex
                ];
                let _: () = msg_send![blit, endEncoding];
                let _: () = msg_send![cmd_buf, presentDrawable: drawable];
                let _: () = msg_send![cmd_buf, commit];
            }

            objc_autoreleasePoolPop(pool);
        }
    }

    // Release the CGL context from this thread
    unsafe {
        CGLSetCurrentContext(std::ptr::null_mut());
    }
}
