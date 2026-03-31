//! iOS rendering: EAGL + OpenGL ES → CVPixelBuffer (IOSurface) → Metal → CAMetalLayer.
//!
//! Architecture (mirrors macOS with iOS-specific adaptations):
//! 1. mpv renders via its OpenGL ES render API into an offscreen FBO. The FBO's
//!    color attachment is a GL texture created from a CVPixelBuffer (IOSurface-backed)
//!    via CVOpenGLESTextureCache — zero-copy sharing.
//! 2. A Metal texture wraps the same CVPixelBuffer via CVMetalTextureCache (zero-copy).
//! 3. A dedicated render thread uses a Metal blit command encoder to copy the
//!    shared texture onto a CAMetalLayer drawable, then presents it.
//!
//! This gives us a fully Metal display pipeline while keeping the GL render call
//! required by libmpv. OpenGL ES is deprecated on iOS but functional, and this is
//! the standard approach for mpv-based iOS players.

use kuriume_mpv::GpuRenderer;
use objc2::runtime::AnyObject;
use objc2::{msg_send, msg_send_id};
use std::ffi::{c_int, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;

// ── CoreFoundation types ─────────────────────────────────────────

type CFAllocatorRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFNumberRef = *const c_void;
type CFTypeRef = *const c_void;
type CFBooleanRef = *const c_void;

const K_CF_NUMBER_SI32_TYPE: i32 = 3;
const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;

extern "C" {
    fn CFRelease(cf: CFTypeRef);
    static kCFAllocatorDefault: CFAllocatorRef;
    static kCFBooleanTrue: CFBooleanRef;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;

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
}

fn cfstr(s: &str) -> CFStringRef {
    unsafe {
        CFStringCreateWithCString(
            kCFAllocatorDefault,
            format!("{s}\0").as_ptr(),
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

// ── CVPixelBuffer FFI ────────────────────────────────────────────

type CVReturn = i32;
type CVPixelBufferRef = *mut c_void;

const K_CV_RETURN_SUCCESS: CVReturn = 0;
/// kCVPixelFormatType_32BGRA
const K_CV_PIXEL_FORMAT_TYPE_32BGRA: u32 = 0x42475241; // 'BGRA'

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    fn CVPixelBufferCreate(
        allocator: CFAllocatorRef,
        width: usize,
        height: usize,
        pixel_format_type: u32,
        pixel_buffer_attributes: CFDictionaryRef,
        pixel_buffer_out: *mut CVPixelBufferRef,
    ) -> CVReturn;

    fn CVPixelBufferRelease(pixel_buffer: CVPixelBufferRef);
}

/// Create a CVPixelBuffer backed by IOSurface with Metal compatibility.
unsafe fn create_pixel_buffer(width: i32, height: i32) -> Result<CVPixelBufferRef, String> {
    // Build attributes dictionary:
    // { kCVPixelBufferIOSurfacePropertiesKey: {}, kCVPixelBufferMetalCompatibilityKey: true }
    let k_iosurface = cfstr("IOSurfaceProperties" /* kCVPixelBufferIOSurfacePropertiesKey */);
    let k_metal = cfstr("MetalCompatibility" /* kCVPixelBufferMetalCompatibilityKey */);

    // Empty dictionary for IOSurface properties
    let empty_dict = unsafe {
        CFDictionaryCreate(
            kCFAllocatorDefault,
            ptr::null(),
            ptr::null(),
            0,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        )
    };

    let keys: [CFTypeRef; 2] = [k_iosurface as CFTypeRef, k_metal as CFTypeRef];
    let values: [CFTypeRef; 2] = [empty_dict as CFTypeRef, unsafe { kCFBooleanTrue } as CFTypeRef];

    let attrs = unsafe {
        CFDictionaryCreate(
            kCFAllocatorDefault,
            keys.as_ptr(),
            values.as_ptr(),
            2,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        )
    };

    let mut pixel_buffer: CVPixelBufferRef = ptr::null_mut();
    let status = unsafe {
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            width as usize,
            height as usize,
            K_CV_PIXEL_FORMAT_TYPE_32BGRA,
            attrs,
            &mut pixel_buffer,
        )
    };

    unsafe {
        CFRelease(attrs as CFTypeRef);
        CFRelease(empty_dict as CFTypeRef);
        CFRelease(k_iosurface as CFTypeRef);
        CFRelease(k_metal as CFTypeRef);
    }

    if status != K_CV_RETURN_SUCCESS || pixel_buffer.is_null() {
        return Err(format!("CVPixelBufferCreate failed: {status}"));
    }

    Ok(pixel_buffer)
}

// ── CVOpenGLESTextureCache FFI ───────────────────────────────────

type CVOpenGLESTextureCacheRef = *mut c_void;
type CVOpenGLESTextureRef = *mut c_void;
type CVEAGLContext = *mut c_void; // EAGLContext*

extern "C" {
    fn CVOpenGLESTextureCacheCreate(
        allocator: CFAllocatorRef,
        cache_attributes: CFDictionaryRef,
        eagl_context: CVEAGLContext,
        texture_attributes: CFDictionaryRef,
        cache_out: *mut CVOpenGLESTextureCacheRef,
    ) -> CVReturn;

    fn CVOpenGLESTextureCacheCreateTextureFromImage(
        allocator: CFAllocatorRef,
        texture_cache: CVOpenGLESTextureCacheRef,
        source_image: CVPixelBufferRef,
        texture_attributes: CFDictionaryRef,
        target: u32,       // GL_TEXTURE_2D
        internal_format: i32,
        width: i32,
        height: i32,
        format: u32,
        type_: u32,
        plane_index: usize,
        texture_out: *mut CVOpenGLESTextureRef,
    ) -> CVReturn;

    fn CVOpenGLESTextureGetName(texture: CVOpenGLESTextureRef) -> u32;

    fn CVOpenGLESTextureCacheFlush(texture_cache: CVOpenGLESTextureCacheRef, options: u64);
}

// ── CVMetalTextureCache FFI ──────────────────────────────────────

type CVMetalTextureCacheRef = *mut c_void;
type CVMetalTextureRef = *mut c_void;

extern "C" {
    fn CVMetalTextureCacheCreate(
        allocator: CFAllocatorRef,
        cache_attributes: CFDictionaryRef,
        metal_device: *mut c_void, // id<MTLDevice>
        texture_attributes: CFDictionaryRef,
        cache_out: *mut CVMetalTextureCacheRef,
    ) -> CVReturn;

    fn CVMetalTextureCacheCreateTextureFromImage(
        allocator: CFAllocatorRef,
        texture_cache: CVMetalTextureCacheRef,
        source_image: CVPixelBufferRef,
        texture_attributes: CFDictionaryRef,
        pixel_format: u64,  // MTLPixelFormat
        width: usize,
        height: usize,
        plane_index: usize,
        texture_out: *mut CVMetalTextureRef,
    ) -> CVReturn;

    fn CVMetalTextureGetTexture(texture: CVMetalTextureRef) -> *mut AnyObject;

    fn CVMetalTextureCacheFlush(texture_cache: CVMetalTextureCacheRef, options: u64);
}

// ── OpenGL ES constants ──────────────────────────────────────────

const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_COLOR_ATTACHMENT0: u32 = 0x8CE0;
const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_RGBA: u32 = 0x1908;
const GL_BGRA_EXT: u32 = 0x80E1;
const GL_UNSIGNED_BYTE: u32 = 0x1401;

extern "C" {
    fn glGenFramebuffers(n: c_int, framebuffers: *mut u32);
    fn glBindFramebuffer(target: u32, framebuffer: u32);
    fn glFramebufferTexture2D(
        target: u32,
        attachment: u32,
        textarget: u32,
        texture: u32,
        level: c_int,
    );
    fn glDeleteFramebuffers(n: c_int, framebuffers: *const u32);
    fn glViewport(x: c_int, y: c_int, width: c_int, height: c_int);
    fn glFlush();
}

// ── Metal constant ───────────────────────────────────────────────

const MTL_PIXEL_FORMAT_BGRA8_UNORM: u64 = 80;

#[link(name = "Metal", kind = "framework")]
extern "C" {
    fn MTLCreateSystemDefaultDevice() -> *mut AnyObject;
}

// ── ObjC runtime ─────────────────────────────────────────────────

extern "C" {
    fn objc_autoreleasePoolPush() -> *mut c_void;
    fn objc_autoreleasePoolPop(pool: *mut c_void);
}

// ── GCD dispatch FFI ─────────────────────────────────────────────

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

// ── EAGLContext helpers ──────────────────────────────────────────

/// kEAGLRenderingAPIOpenGLES3 = 3
const K_EAGL_RENDERING_API_OPENGL_ES3: isize = 3;

/// Create an EAGLContext for OpenGL ES 3.0.
unsafe fn create_eagl_context() -> Result<*mut AnyObject, String> {
    let cls = objc2::runtime::AnyClass::get(c"EAGLContext")
        .ok_or("EAGLContext class not found")?;

    let ctx: *mut AnyObject =
        unsafe { msg_send![cls, alloc] };
    let ctx: *mut AnyObject =
        unsafe { msg_send![ctx, initWithAPI: K_EAGL_RENDERING_API_OPENGL_ES3] };

    if ctx.is_null() {
        return Err("Failed to create EAGLContext (OpenGL ES 3.0)".into());
    }

    Ok(ctx)
}

/// Set the current thread's EAGLContext.
unsafe fn eagl_set_current(ctx: *mut AnyObject) -> bool {
    let cls = objc2::runtime::AnyClass::get(c"EAGLContext").unwrap();
    let result: bool = unsafe { msg_send![cls, setCurrentContext: ctx] };
    result
}

// ── Render context ───────────────────────────────────────────────

struct RenderCtx {
    // OpenGL ES (offscreen mpv rendering via EAGL)
    eagl_ctx: *mut AnyObject,
    renderer: GpuRenderer,
    fbo: u32,

    // CVPixelBuffer (IOSurface-backed, shared between GL and Metal)
    pixel_buffer: CVPixelBufferRef,
    gl_texture_cache: CVOpenGLESTextureCacheRef,
    gl_cv_texture: CVOpenGLESTextureRef,
    metal_texture_cache: CVMetalTextureCacheRef,
    metal_cv_texture: CVMetalTextureRef,

    // Metal (display pipeline)
    metal_device: *mut AnyObject,
    metal_queue: *mut AnyObject,
    metal_layer: *mut AnyObject,

    // UIView for positioning
    video_view: *mut AnyObject,

    // Dimensions (backing pixels)
    surface_width: AtomicI32,
    surface_height: AtomicI32,
    target_width: AtomicI32,
    target_height: AtomicI32,
    content_scale: f64,

    // Lifecycle
    alive: AtomicBool,
    needs_render: AtomicBool,
    wake: std::sync::Condvar,
    wake_lock: std::sync::Mutex<bool>,
}

// SAFETY: EAGL context is only used on the render thread.
// Metal objects and CVTextureCache are thread-safe.
// UIView is only mutated via main thread dispatch.
unsafe impl Send for RenderCtx {}
unsafe impl Sync for RenderCtx {}

// ── NativeVideoView ──────────────────────────────────────────────

pub struct NativeVideoView {
    ctx: Arc<RenderCtx>,
    render_thread: Option<std::thread::JoinHandle<()>>,
}

unsafe impl Send for NativeVideoView {}
unsafe impl Sync for NativeVideoView {}

impl NativeVideoView {
    /// Create the native video view and start the render thread.
    ///
    /// # Safety
    /// - `parent_ptr` must be a valid `UIView *`.
    /// - `mpv_handle` must be a valid `mpv_handle *`.
    /// - Must be called on the **main thread**.
    pub unsafe fn new(parent_ptr: *mut c_void, mpv_handle: *mut c_void) -> Result<Self, String> {
        let parent_view = parent_ptr as *mut AnyObject;
        if parent_view.is_null() {
            return Err("parent UIView is null".into());
        }

        // ── Metal device + command queue ─────────────────────────
        let metal_device = unsafe { MTLCreateSystemDefaultDevice() };
        if metal_device.is_null() {
            return Err("MTLCreateSystemDefaultDevice returned null".into());
        }

        let metal_queue: *mut AnyObject = unsafe { msg_send![metal_device, newCommandQueue] };
        if metal_queue.is_null() {
            unsafe { let _: () = msg_send![metal_device, release]; }
            return Err("Failed to create Metal command queue".into());
        }

        // ── UIView + CAMetalLayer ────────────────────────────────
        // Get initial bounds from parent
        let bounds: [f64; 4] = unsafe { msg_send![parent_view, bounds] }; // CGRect as 4 f64s
        let parent_w = bounds[2];
        let parent_h = bounds[3];

        // Create a UIView for the video
        let ui_view_cls = objc2::runtime::AnyClass::get(c"UIView")
            .ok_or("UIView class not found")?;
        let video_view: *mut AnyObject = unsafe {
            let alloc: *mut AnyObject = msg_send![ui_view_cls, alloc];
            msg_send![alloc, initWithFrame: bounds]
        };
        if video_view.is_null() {
            unsafe {
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
            }
            return Err("Failed to create UIView".into());
        }

        // Create CAMetalLayer and add as sublayer
        let metal_layer: *mut AnyObject =
            unsafe { msg_send![objc2::class!(CAMetalLayer), layer] };

        unsafe {
            let view_layer: *mut AnyObject = msg_send![video_view, layer];
            let _: () = msg_send![view_layer, addSublayer: metal_layer];

            // Configure the Metal layer
            let _: () = msg_send![metal_layer, setDevice: metal_device];
            let _: () = msg_send![metal_layer, setPixelFormat: MTL_PIXEL_FORMAT_BGRA8_UNORM];
            let _: () = msg_send![metal_layer, setFramebufferOnly: false];
            let _: () = msg_send![metal_layer, setOpaque: true];

            // Match the screen's scale factor
            let screen: *mut AnyObject = msg_send![
                objc2::runtime::AnyClass::get(c"UIScreen").unwrap(),
                mainScreen
            ];
            let scale: f64 = msg_send![screen, scale];
            let _: () = msg_send![metal_layer, setContentsScale: scale];

            // Set Metal layer frame to match view bounds
            let _: () = msg_send![metal_layer, setFrame: bounds];

            // Insert video view behind the WKWebView
            let subviews: *mut AnyObject = msg_send![parent_view, subviews];
            let count: usize = msg_send![subviews, count];
            if count > 0 {
                let first: *mut AnyObject = msg_send![subviews, objectAtIndex: 0usize];
                let _: () = msg_send![
                    parent_view,
                    insertSubview: video_view,
                    belowSubview: &*first
                ];
            } else {
                let _: () = msg_send![parent_view, addSubview: video_view];
            }

            // ── Dimensions ───────────────────────────────────────
            let content_scale = scale;
            let init_w = (parent_w * content_scale) as i32;
            let init_h = (parent_h * content_scale) as i32;
            let init_w = init_w.max(1);
            let init_h = init_h.max(1);

            let _: () = msg_send![
                metal_layer,
                setDrawableSize: [init_w as f64, init_h as f64]
            ];

            // ── EAGL context ─────────────────────────────────────
            let eagl_ctx = create_eagl_context()?;
            if !eagl_set_current(eagl_ctx) {
                let _: () = msg_send![eagl_ctx, release];
                let _: () = msg_send![video_view, removeFromSuperview];
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err("Failed to set EAGLContext as current".into());
            }

            // ── CVPixelBuffer (IOSurface-backed) ─────────────────
            let pixel_buffer = create_pixel_buffer(init_w, init_h)?;

            // ── CVOpenGLESTextureCache → GL texture ──────────────
            let mut gl_texture_cache: CVOpenGLESTextureCacheRef = ptr::null_mut();
            let status = CVOpenGLESTextureCacheCreate(
                kCFAllocatorDefault,
                ptr::null(),
                eagl_ctx as CVEAGLContext,
                ptr::null(),
                &mut gl_texture_cache,
            );
            if status != K_CV_RETURN_SUCCESS {
                CVPixelBufferRelease(pixel_buffer);
                eagl_set_current(ptr::null_mut());
                let _: () = msg_send![eagl_ctx, release];
                let _: () = msg_send![video_view, removeFromSuperview];
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!("CVOpenGLESTextureCacheCreate failed: {status}"));
            }

            let mut gl_cv_texture: CVOpenGLESTextureRef = ptr::null_mut();
            let status = CVOpenGLESTextureCacheCreateTextureFromImage(
                kCFAllocatorDefault,
                gl_texture_cache,
                pixel_buffer,
                ptr::null(),
                GL_TEXTURE_2D,
                GL_RGBA as i32,
                init_w,
                init_h,
                GL_BGRA_EXT,
                GL_UNSIGNED_BYTE,
                0,
                &mut gl_cv_texture,
            );
            if status != K_CV_RETURN_SUCCESS {
                CFRelease(gl_texture_cache as CFTypeRef);
                CVPixelBufferRelease(pixel_buffer);
                eagl_set_current(ptr::null_mut());
                let _: () = msg_send![eagl_ctx, release];
                let _: () = msg_send![video_view, removeFromSuperview];
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!(
                    "CVOpenGLESTextureCacheCreateTextureFromImage failed: {status}"
                ));
            }

            let gl_texture_name = CVOpenGLESTextureGetName(gl_cv_texture);

            // ── FBO with CV-created GL texture ───────────────────
            let mut fbo: u32 = 0;
            glGenFramebuffers(1, &mut fbo);
            glBindFramebuffer(GL_FRAMEBUFFER, fbo);
            glFramebufferTexture2D(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_2D,
                gl_texture_name,
                0,
            );

            // ── CVMetalTextureCache → Metal texture ──────────────
            let mut metal_texture_cache: CVMetalTextureCacheRef = ptr::null_mut();
            let status = CVMetalTextureCacheCreate(
                kCFAllocatorDefault,
                ptr::null(),
                metal_device as *mut c_void,
                ptr::null(),
                &mut metal_texture_cache,
            );
            if status != K_CV_RETURN_SUCCESS {
                glDeleteFramebuffers(1, &fbo);
                CFRelease(gl_cv_texture as CFTypeRef);
                CFRelease(gl_texture_cache as CFTypeRef);
                CVPixelBufferRelease(pixel_buffer);
                eagl_set_current(ptr::null_mut());
                let _: () = msg_send![eagl_ctx, release];
                let _: () = msg_send![video_view, removeFromSuperview];
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!("CVMetalTextureCacheCreate failed: {status}"));
            }

            let mut metal_cv_texture: CVMetalTextureRef = ptr::null_mut();
            let status = CVMetalTextureCacheCreateTextureFromImage(
                kCFAllocatorDefault,
                metal_texture_cache,
                pixel_buffer,
                ptr::null(),
                MTL_PIXEL_FORMAT_BGRA8_UNORM,
                init_w as usize,
                init_h as usize,
                0,
                &mut metal_cv_texture,
            );
            if status != K_CV_RETURN_SUCCESS {
                CFRelease(metal_texture_cache as CFTypeRef);
                glDeleteFramebuffers(1, &fbo);
                CFRelease(gl_cv_texture as CFTypeRef);
                CFRelease(gl_texture_cache as CFTypeRef);
                CVPixelBufferRelease(pixel_buffer);
                eagl_set_current(ptr::null_mut());
                let _: () = msg_send![eagl_ctx, release];
                let _: () = msg_send![video_view, removeFromSuperview];
                let _: () = msg_send![metal_queue, release];
                let _: () = msg_send![metal_device, release];
                return Err(format!(
                    "CVMetalTextureCacheCreateTextureFromImage failed: {status}"
                ));
            }

            // ── mpv GPU renderer ─────────────────────────────────
            let renderer =
                GpuRenderer::new(mpv_handle).map_err(|e| format!("GpuRenderer: {e}"))?;

            // Release EAGL context from main thread (render thread will own it)
            eagl_set_current(ptr::null_mut());

            // ── Build shared render context ──────────────────────
            let ctx = Arc::new(RenderCtx {
                eagl_ctx,
                renderer,
                fbo,
                pixel_buffer,
                gl_texture_cache,
                gl_cv_texture,
                metal_texture_cache,
                metal_cv_texture,
                metal_device,
                metal_queue,
                metal_layer,
                video_view,
                surface_width: AtomicI32::new(init_w),
                surface_height: AtomicI32::new(init_h),
                target_width: AtomicI32::new(init_w),
                target_height: AtomicI32::new(init_h),
                content_scale,
                alive: AtomicBool::new(true),
                needs_render: AtomicBool::new(true),
                wake: std::sync::Condvar::new(),
                wake_lock: std::sync::Mutex::new(false),
            });

            // Wire up mpv's render-update callback
            let ctx_ptr = Arc::as_ptr(&ctx) as *mut c_void;
            ctx.renderer
                .set_raw_update_callback(Some(on_mpv_needs_render), ctx_ptr);

            // Start the dedicated render thread
            let ctx_for_thread = ctx.clone();
            let render_thread = std::thread::Builder::new()
                .name("mpv-render-ios".into())
                .spawn(move || render_loop(ctx_for_thread))
                .map_err(|e| format!("Failed to spawn render thread: {e}"))?;

            Ok(Self {
                ctx,
                render_thread: Some(render_thread),
            })
        }
    }

    /// Resize and reposition the video view.
    ///
    /// Coordinates in CSS pixels, origin at top-left (UIKit coordinate system).
    pub fn set_frame(&self, x: f64, y: f64, width: f64, height: f64) {
        let scale = self.ctx.content_scale;
        let tw = ((width * scale).round() as i32).max(1);
        let th = ((height * scale).round() as i32).max(1);
        self.ctx.target_width.store(tw, Ordering::Release);
        self.ctx.target_height.store(th, Ordering::Release);

        // Wake the render thread for resize
        {
            let mut pending = self.ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.ctx.wake.notify_one();
        }

        // Update UIView frame on main thread
        let view_ptr = self.ctx.video_view as usize;
        let metal_layer_ptr = self.ctx.metal_layer as usize;

        #[repr(C)]
        struct FrameCtx {
            view: usize,
            metal_layer: usize,
            x: f64,
            y: f64,
            w: f64,
            h: f64,
        }
        unsafe impl Send for FrameCtx {}

        let fctx = Box::new(FrameCtx {
            view: view_ptr,
            metal_layer: metal_layer_ptr,
            x,
            y,
            w: width,
            h: height,
        });

        unsafe extern "C" fn apply_frame(raw: *mut c_void) {
            let ctx = unsafe { Box::from_raw(raw as *mut FrameCtx) };
            unsafe {
                let view = ctx.view as *mut AnyObject;
                let frame: [f64; 4] = [ctx.x, ctx.y, ctx.w, ctx.h]; // CGRect
                let _: () = msg_send![view, setFrame: frame];

                // Update metal layer frame to match view bounds
                let metal_layer = ctx.metal_layer as *mut AnyObject;
                let bounds: [f64; 4] = [0.0, 0.0, ctx.w, ctx.h];
                let _: () = msg_send![metal_layer, setFrame: bounds];
            }
        }

        unsafe {
            dispatch_async_f(
                dispatch_get_main_queue(),
                Box::into_raw(fctx) as *mut c_void,
                apply_frame,
            );
        }
    }

    /// Clean up all resources. Must be called before drop.
    pub fn destroy(&mut self) {
        // Signal render thread to stop
        self.ctx.alive.store(false, Ordering::Release);
        {
            let mut pending = self.ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.ctx.wake.notify_one();
        }

        // Wait for render thread
        if let Some(handle) = self.render_thread.take() {
            let _ = handle.join();
        }

        unsafe {
            // Free mpv render context (EAGL context must be current)
            eagl_set_current(self.ctx.eagl_ctx);

            let ctx_ptr = Arc::as_ptr(&self.ctx) as *mut RenderCtx;
            (*ctx_ptr).renderer.free();

            // Clean up GL resources
            glDeleteFramebuffers(1, &self.ctx.fbo);

            // Release CV textures and caches
            if !self.ctx.gl_cv_texture.is_null() {
                CFRelease(self.ctx.gl_cv_texture as CFTypeRef);
            }
            if !self.ctx.gl_texture_cache.is_null() {
                CFRelease(self.ctx.gl_texture_cache as CFTypeRef);
            }
            if !self.ctx.metal_cv_texture.is_null() {
                CFRelease(self.ctx.metal_cv_texture as CFTypeRef);
            }
            if !self.ctx.metal_texture_cache.is_null() {
                CFRelease(self.ctx.metal_texture_cache as CFTypeRef);
            }

            // Release CVPixelBuffer
            if !self.ctx.pixel_buffer.is_null() {
                CVPixelBufferRelease(self.ctx.pixel_buffer);
            }

            // Release EAGL context
            eagl_set_current(ptr::null_mut());
            let _: () = msg_send![self.ctx.eagl_ctx, release];
        }

        // Clean up Metal + view on main thread
        let metal_queue = self.ctx.metal_queue;
        let metal_device = self.ctx.metal_device;
        let video_view = self.ctx.video_view;

        #[repr(C)]
        struct CleanupCtx {
            metal_queue: *mut AnyObject,
            metal_device: *mut AnyObject,
            video_view: *mut AnyObject,
        }
        unsafe impl Send for CleanupCtx {}

        let cleanup = Box::new(CleanupCtx {
            metal_queue,
            metal_device,
            video_view,
        });

        unsafe extern "C" fn do_cleanup(raw: *mut c_void) {
            let ctx = unsafe { Box::from_raw(raw as *mut CleanupCtx) };
            unsafe {
                if !ctx.metal_queue.is_null() {
                    let _: () = msg_send![ctx.metal_queue, release];
                }
                if !ctx.metal_device.is_null() {
                    let _: () = msg_send![ctx.metal_device, release];
                }
                let _: () = msg_send![ctx.video_view, removeFromSuperview];
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
        if self.ctx.alive.load(Ordering::Acquire) {
            self.ctx.alive.store(false, Ordering::Release);
            let mut pending = self.ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.ctx.wake.notify_one();
        }
    }
}

// ── mpv update callback ─────────────────────────────────────────

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

// ── Render thread ────────────────────────────────────────────────

/// Recreate the CVPixelBuffer and associated GL/Metal textures at a new size.
///
/// # Safety
/// Must be called on the render thread with EAGL context current.
unsafe fn resize_surface(ctx: &Arc<RenderCtx>, new_w: i32, new_h: i32) {
    if new_w <= 0 || new_h <= 0 {
        return;
    }

    let ctx_ptr = Arc::as_ptr(ctx) as *mut RenderCtx;

    // Release old CV textures
    if !(*ctx_ptr).gl_cv_texture.is_null() {
        CFRelease((*ctx_ptr).gl_cv_texture as CFTypeRef);
        (*ctx_ptr).gl_cv_texture = ptr::null_mut();
    }
    if !(*ctx_ptr).metal_cv_texture.is_null() {
        CFRelease((*ctx_ptr).metal_cv_texture as CFTypeRef);
        (*ctx_ptr).metal_cv_texture = ptr::null_mut();
    }

    // Release old CVPixelBuffer
    if !(*ctx_ptr).pixel_buffer.is_null() {
        CVPixelBufferRelease((*ctx_ptr).pixel_buffer);
        (*ctx_ptr).pixel_buffer = ptr::null_mut();
    }

    // Flush texture caches
    if !(*ctx_ptr).gl_texture_cache.is_null() {
        CVOpenGLESTextureCacheFlush((*ctx_ptr).gl_texture_cache, 0);
    }
    if !(*ctx_ptr).metal_texture_cache.is_null() {
        CVMetalTextureCacheFlush((*ctx_ptr).metal_texture_cache, 0);
    }

    // Create new CVPixelBuffer
    let pixel_buffer = match create_pixel_buffer(new_w, new_h) {
        Ok(pb) => pb,
        Err(e) => {
            log::error!("resize_surface: {e}");
            return;
        }
    };

    // Create new GL texture from CVPixelBuffer
    let mut gl_cv_texture: CVOpenGLESTextureRef = ptr::null_mut();
    let status = CVOpenGLESTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault,
        (*ctx_ptr).gl_texture_cache,
        pixel_buffer,
        ptr::null(),
        GL_TEXTURE_2D,
        GL_RGBA as i32,
        new_w,
        new_h,
        GL_BGRA_EXT,
        GL_UNSIGNED_BYTE,
        0,
        &mut gl_cv_texture,
    );
    if status != K_CV_RETURN_SUCCESS {
        log::error!("resize_surface: CVOpenGLESTextureCacheCreateTextureFromImage failed: {status}");
        CVPixelBufferRelease(pixel_buffer);
        return;
    }

    let gl_texture_name = CVOpenGLESTextureGetName(gl_cv_texture);

    // Rebind FBO
    glBindFramebuffer(GL_FRAMEBUFFER, (*ctx_ptr).fbo);
    glFramebufferTexture2D(
        GL_FRAMEBUFFER,
        GL_COLOR_ATTACHMENT0,
        GL_TEXTURE_2D,
        gl_texture_name,
        0,
    );

    // Create new Metal texture from CVPixelBuffer
    let mut metal_cv_texture: CVMetalTextureRef = ptr::null_mut();
    let status = CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault,
        (*ctx_ptr).metal_texture_cache,
        pixel_buffer,
        ptr::null(),
        MTL_PIXEL_FORMAT_BGRA8_UNORM,
        new_w as usize,
        new_h as usize,
        0,
        &mut metal_cv_texture,
    );
    if status != K_CV_RETURN_SUCCESS {
        log::error!("resize_surface: CVMetalTextureCacheCreateTextureFromImage failed: {status}");
        CFRelease(gl_cv_texture as CFTypeRef);
        CVPixelBufferRelease(pixel_buffer);
        return;
    }

    // Update drawable size
    let _: () = msg_send![
        (*ctx_ptr).metal_layer,
        setDrawableSize: [new_w as f64, new_h as f64]
    ];

    // Store new resources
    (*ctx_ptr).pixel_buffer = pixel_buffer;
    (*ctx_ptr).gl_cv_texture = gl_cv_texture;
    (*ctx_ptr).metal_cv_texture = metal_cv_texture;

    ctx.surface_width.store(new_w, Ordering::Release);
    ctx.surface_height.store(new_h, Ordering::Release);
}

/// Render loop running on a dedicated thread.
fn render_loop(ctx: Arc<RenderCtx>) {
    // Make EAGL context current on this thread
    unsafe {
        if !eagl_set_current(ctx.eagl_ctx) {
            log::error!("render_loop: failed to set EAGLContext as current");
            return;
        }
    }

    while ctx.alive.load(Ordering::Acquire) {
        // Wait for wake signal
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

        // Check resize
        let tw = ctx.target_width.load(Ordering::Acquire);
        let th = ctx.target_height.load(Ordering::Acquire);
        let cw = ctx.surface_width.load(Ordering::Acquire);
        let ch = ctx.surface_height.load(Ordering::Acquire);
        if (tw != cw || th != ch) && tw > 0 && th > 0 {
            unsafe { resize_surface(&ctx, tw, th) };
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
            // ── Step 1: OpenGL ES — render mpv frame → CVPixelBuffer ─
            glBindFramebuffer(GL_FRAMEBUFFER, ctx.fbo);
            glViewport(0, 0, w as c_int, h as c_int);
            let _ = ctx.renderer.render(ctx.fbo as i32, w, h);
            glFlush();

            // ── Step 2: Metal — blit CVPixelBuffer → CAMetalLayer ────
            let pool = objc_autoreleasePoolPush();

            // Get the Metal texture from the CV texture wrapper
            let metal_src_tex = CVMetalTextureGetTexture(ctx.metal_cv_texture);

            if !metal_src_tex.is_null() {
                let drawable: *mut AnyObject = msg_send![ctx.metal_layer, nextDrawable];

                if !drawable.is_null() {
                    let dst_tex: *mut AnyObject = msg_send![drawable, texture];
                    if !dst_tex.is_null() {
                        let cmd_buf: *mut AnyObject =
                            msg_send![ctx.metal_queue, commandBuffer];
                        if !cmd_buf.is_null() {
                            let blit: *mut AnyObject =
                                msg_send![cmd_buf, blitCommandEncoder];
                            let _: () = msg_send![
                                blit,
                                copyFromTexture: metal_src_tex,
                                toTexture: dst_tex
                            ];
                            let _: () = msg_send![blit, endEncoding];
                            let _: () = msg_send![cmd_buf, presentDrawable: drawable];
                            let _: () = msg_send![cmd_buf, commit];
                        }
                    }
                }
            }

            objc_autoreleasePoolPop(pool);
        }
    }

    // Release EAGL context from render thread
    unsafe {
        eagl_set_current(ptr::null_mut());
    }
}
