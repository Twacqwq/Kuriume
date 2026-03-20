//! Platform-specific native OpenGL view for mpv rendering.
//!
//! Creates an `NSView` + `NSOpenGLContext` below the WKWebView inside
//! the Tauri window.  mpv renders via the render API into this GL
//! context while the transparent webview overlays UI controls.

#[cfg(target_os = "macos")]
mod macos {
    use kuriume_mpv::GpuRenderer;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::NSView;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use std::ffi::{c_int, c_void};
    use std::sync::atomic::{AtomicBool, Ordering};

    // ── CGL FFI ──────────────────────────────────────────────────

    type CGLPixelFormatObj = *mut c_void;
    type CGLContextObj = *mut c_void;

    // Pixel format attributes
    const K_CGL_PFA_DOUBLE_BUFFER: c_int = 5;
    const K_CGL_PFA_ACCELERATED: c_int = 73;
    const K_CGL_PFA_COLOR_SIZE: c_int = 8;
    const K_CGL_PFA_ALPHA_SIZE: c_int = 11;
    const K_CGL_PFA_DEPTH_SIZE: c_int = 12;
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
        fn CGLFlushDrawable(ctx: CGLContextObj) -> c_int;
        fn CGLDestroyContext(ctx: CGLContextObj) -> c_int;
        fn CGLLockContext(ctx: CGLContextObj) -> c_int;
        fn CGLUnlockContext(ctx: CGLContextObj) -> c_int;
    }

    // ── GCD dispatch FFI ─────────────────────────────────────────

    type DispatchQueue = *mut c_void;

    extern "C" {
        // dispatch_get_main_queue() is a macro in C; the real symbol is:
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

    // ── Render loop state ────────────────────────────────────────

    /// Shared state for the frame render callback.
    /// Leaked as a `Box` so the raw pointer is stable for C callbacks.
    struct RenderLoopCtx {
        cgl_ctx: CGLContextObj,
        ns_gl_ctx: *mut AnyObject,
        renderer: GpuRenderer,
        view: *mut NSView,
        alive: AtomicBool,
        /// Prevents multiple render_frame dispatches from piling up
        /// on the main queue.  Only ONE dispatch is in-flight at a time.
        render_scheduled: AtomicBool,
        /// Set by the mpv callback when a new frame is ready.
        needs_render: AtomicBool,
        /// When true, render_frame and on_mpv_needs_render skip work.
        /// Used to freeze GL rendering during fullscreen transitions.
        rendering_suspended: AtomicBool,
    }

    /// A native `NSView` + OpenGL context for mpv GPU rendering.
    pub struct NativeGlView {
        view: Retained<NSView>,
        cgl_ctx: CGLContextObj,
        /// Leaked pointer — reclaimed in `destroy()`.
        render_loop: *mut RenderLoopCtx,
    }

    // SAFETY: All mutable access to CGL/NSView is marshalled to the main
    // thread via GCD dispatch. The atomics in RenderLoopCtx are Sync.
    unsafe impl Send for NativeGlView {}
    unsafe impl Sync for NativeGlView {}

    impl NativeGlView {
        /// Create an NSView with an OpenGL context inside the window
        /// that owns `parent_ptr`, then create a `GpuRenderer` and
        /// wire up the automatic render dispatch.
        ///
        /// # Safety
        /// - `parent_ptr` must be a valid `NSView *` attached to an `NSWindow`.
        /// - `mpv_handle` must be a valid `mpv_handle *` (from `MpvPlayer::raw_handle()`).
        /// - Must be called on the **main thread**.
        pub unsafe fn new(parent_ptr: *mut c_void, mpv_handle: *mut c_void) -> Result<Self, String> {
            unsafe {
                let parent_view = &*(parent_ptr as *mut NSView);

                // Navigate to the window's contentView for reliable embedding.
                let ns_window: *mut AnyObject = msg_send![parent_view, window];
                if ns_window.is_null() {
                    return Err("NSView has no parent window".into());
                }
                let content_view: *mut NSView = msg_send![&*ns_window, contentView];
                let content_view_ref = &*content_view;
                let bounds: NSRect = msg_send![content_view_ref, bounds];

                let _mtm = MainThreadMarker::new().ok_or("must be called on main thread")?;

                // ── Create CGL context ────────────────────────────
                let attrs: [c_int; 10] = [
                    K_CGL_PFA_DOUBLE_BUFFER,
                    K_CGL_PFA_ACCELERATED,
                    K_CGL_PFA_OPENGL_PROFILE,
                    K_CGL_OGL_PVERSION_3_2_CORE,
                    K_CGL_PFA_COLOR_SIZE,
                    24,
                    K_CGL_PFA_ALPHA_SIZE,
                    8,
                    K_CGL_PFA_DEPTH_SIZE,
                    0, // also serves as terminator (0 = end)
                ];

                let mut pix_fmt: CGLPixelFormatObj = std::ptr::null_mut();
                let mut npix: c_int = 0;
                let err = CGLChoosePixelFormat(attrs.as_ptr(), &mut pix_fmt, &mut npix);
                if err != 0 || pix_fmt.is_null() {
                    return Err(format!("CGLChoosePixelFormat failed: {err}"));
                }

                let mut cgl_ctx: CGLContextObj = std::ptr::null_mut();
                let err = CGLCreateContext(pix_fmt, std::ptr::null_mut(), &mut cgl_ctx);
                CGLDestroyPixelFormat(pix_fmt);
                if err != 0 || cgl_ctx.is_null() {
                    return Err(format!("CGLCreateContext failed: {err}"));
                }

                // ── Create NSOpenGLContext from CGL context ───────
                // We wrap the CGL context in an NSOpenGLContext so we
                // can attach it to an NSView for on-screen display.
                let ns_gl_ctx: *mut AnyObject =
                    msg_send![objc2::class!(NSOpenGLContext), alloc];
                let ns_gl_ctx: *mut AnyObject =
                    msg_send![ns_gl_ctx, initWithCGLContextObj: cgl_ctx];
                if ns_gl_ctx.is_null() {
                    CGLDestroyContext(cgl_ctx);
                    return Err("NSOpenGLContext initWithCGLContextObj failed".into());
                }

                // ── Create NSView ─────────────────────────────────
                let mtm = MainThreadMarker::new().unwrap();
                let view: Retained<NSView> =
                    msg_send![NSView::alloc(mtm), initWithFrame: bounds];

                // Layer backing for compositing with the WKWebView.
                let _: () = msg_send![&view, setWantsLayer: true];
                // Auto-resize with the window.
                let mask: usize = 2 | 16; // NSViewWidthSizable | NSViewHeightSizable
                let _: () = msg_send![&view, setAutoresizingMask: mask];

                // Attach the GL context to the view.
                let _: () = msg_send![ns_gl_ctx, setView: &*view];

                // Insert below all existing subviews (WKWebView stays on top).
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

                // ── Make GL context current & create mpv renderer ─
                CGLSetCurrentContext(cgl_ctx);

                let renderer = GpuRenderer::new(mpv_handle)
                    .map_err(|e| format!("GpuRenderer::new: {e}"))?;

                // ── Wire up render dispatch ───────────────────────
                let view_raw = Retained::as_ptr(&view) as *mut NSView;
                let loop_ctx = Box::new(RenderLoopCtx {
                    cgl_ctx,
                    ns_gl_ctx,
                    renderer,
                    view: view_raw,
                    alive: AtomicBool::new(true),
                    render_scheduled: AtomicBool::new(true),
                    needs_render: AtomicBool::new(true),
                    rendering_suspended: AtomicBool::new(false),
                });
                let render_loop = Box::into_raw(loop_ctx);

                // Ensure the first frame gets drawn.
                dispatch_async_f(
                    dispatch_get_main_queue(),
                    render_loop as *mut c_void,
                    render_frame,
                );

                // Replace the mpv update callback so that new frames
                // dispatch render_frame to the main thread.
                (*render_loop).renderer.set_raw_update_callback(
                    Some(on_mpv_needs_render),
                    render_loop as *mut c_void,
                );

                // Restore previous GL context.
                CGLSetCurrentContext(std::ptr::null_mut());

                Ok(Self {
                    view,
                    cgl_ctx,
                    render_loop,
                })
            }
        }

        /// Resize and reposition the GL view within its parent.
        ///
        /// Coordinates use the parent's system (bottom-left origin, points).
        /// Auto-resize mask is removed so the view stays at the given frame.
        /// After setting the frame, immediately re-renders to avoid stale
        /// content being stretched/compressed to the new size.
        pub fn set_frame(&self, x: f64, y: f64, width: f64, height: f64) {
            let view_ptr = Retained::as_ptr(&self.view) as usize;
            let render_loop = self.render_loop;

            #[repr(C)]
            struct FrameCtx {
                view: usize,
                x: f64,
                y: f64,
                w: f64,
                h: f64,
                render_loop: *mut RenderLoopCtx,
            }

            // SAFETY: RenderLoopCtx is leaked and stable; the pointer is valid
            // as long as `alive` is true, which we check inside render_frame.
            unsafe impl Send for FrameCtx {}

            let ctx = Box::new(FrameCtx {
                view: view_ptr,
                x,
                y,
                w: width,
                h: height,
                render_loop,
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
                    let _: () = msg_send![view, setAutoresizingMask: 0usize];

                    // Re-render immediately — we're already on the main thread,
                    // so a direct call avoids queuing a redundant dispatch.
                    if !ctx.render_loop.is_null() {
                        render_frame(ctx.render_loop as *mut c_void);
                    }
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

        /// Schedule a render on the main thread.
        #[allow(dead_code)]
        pub fn trigger_render(&self) {
            unsafe {
                dispatch_async_f(
                    dispatch_get_main_queue(),
                    self.render_loop as *mut c_void,
                    render_frame,
                );
            }
        }

        /// Suspend GL rendering (freeze on last frame).
        /// mpv continues decoding but render_frame becomes a no-op.
        pub fn suspend_rendering(&self) {
            if !self.render_loop.is_null() {
                unsafe {
                    (*self.render_loop)
                        .rendering_suspended
                        .store(true, Ordering::Release);
                }
            }
        }

        /// Resume GL rendering and immediately schedule a frame.
        pub fn resume_rendering(&self) {
            if !self.render_loop.is_null() {
                unsafe {
                    (*self.render_loop)
                        .rendering_suspended
                        .store(false, Ordering::Release);
                    (*self.render_loop)
                        .needs_render
                        .store(true, Ordering::Release);
                    // Kick a render dispatch so the next frame shows immediately.
                    if (*self.render_loop)
                        .render_scheduled
                        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                    {
                        dispatch_async_f(
                            dispatch_get_main_queue(),
                            self.render_loop as *mut c_void,
                            render_frame,
                        );
                    }
                }
            }
        }

        /// Clean up render resources. Must be called before drop.
        ///
        /// May be called from **any** thread — all GL and AppKit operations
        /// are dispatched synchronously to the main thread, which also
        /// guarantees that no pending `render_frame` calls are in flight.
        pub fn destroy(&mut self) {
            if self.render_loop.is_null() {
                return;
            }

            unsafe {
                // Signal the render loop to stop — prevents NEW dispatches.
                (*self.render_loop).alive.store(false, Ordering::Release);
            }

            // Pack pointers for the cleanup closure.
            #[repr(C)]
            struct CleanupCtx {
                render_loop: *mut RenderLoopCtx,
                cgl_ctx: CGLContextObj,
                view: *mut NSView,
            }

            let ctx = Box::new(CleanupCtx {
                render_loop: self.render_loop,
                cgl_ctx: self.cgl_ctx,
                view: &*self.view as *const NSView as *mut NSView,
            });

            /// Runs on the main thread AFTER any pending `render_frame` calls
            /// (main queue is FIFO).
            unsafe extern "C" fn do_cleanup(raw: *mut c_void) {
                let ctx = unsafe { Box::from_raw(raw as *mut CleanupCtx) };
                unsafe {
                    // Make GL context current so mpv_render_context_free can
                    // clean up its GL resources.
                    CGLSetCurrentContext(ctx.cgl_ctx);

                    // Reclaim + drop the render loop:
                    //   - GpuRenderer::drop → mpv_render_context_free
                    let loop_ctx = Box::from_raw(ctx.render_loop);
                    let ns_gl = loop_ctx.ns_gl_ctx;
                    drop(loop_ctx);

                    CGLSetCurrentContext(std::ptr::null_mut());

                    // Release NSOpenGLContext (detaches from view).
                    if !ns_gl.is_null() {
                        let _: () = msg_send![ns_gl, release];
                    }

                    // Remove the GL view from the view hierarchy.
                    let _: () = msg_send![ctx.view, removeFromSuperview];

                    // Destroy the CGL context itself.
                    CGLDestroyContext(ctx.cgl_ctx);
                }
            }

            // Dispatch synchronously — blocks until cleanup is done.
            // Because the main queue is serial FIFO, this runs after
            // any already-queued `render_frame` invocations.
            unsafe {
                dispatch_sync_f(
                    dispatch_get_main_queue(),
                    Box::into_raw(ctx) as *mut c_void,
                    do_cleanup,
                );
            }

            self.render_loop = std::ptr::null_mut();
        }
    }

    impl Drop for NativeGlView {
        fn drop(&mut self) {
            if !self.render_loop.is_null() {
                // `destroy()` should have been called already.
                // As a safety net during app shutdown, just stop the
                // render loop.  Leaking the context is acceptable here
                // because the process is exiting.
                unsafe {
                    (*self.render_loop).alive.store(false, Ordering::Release);
                }
                self.render_loop = std::ptr::null_mut();
            }
        }
    }

    /// mpv update callback — coalesces render dispatches to the main thread.
    /// Called from mpv's internal thread whenever a new frame is ready.
    unsafe extern "C" fn on_mpv_needs_render(ctx: *mut c_void) {
        let loop_ctx = unsafe { &*(ctx as *const RenderLoopCtx) };
        if !loop_ctx.alive.load(Ordering::Acquire) {
            return;
        }
        // Mark that a render is needed.
        loop_ctx.needs_render.store(true, Ordering::Release);
        // Skip dispatch if rendering is suspended (fullscreen transition).
        if loop_ctx.rendering_suspended.load(Ordering::Acquire) {
            return;
        }
        // Only dispatch if no render_frame is already queued (CAS false→true).
        if loop_ctx
            .render_scheduled
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            unsafe {
                dispatch_async_f(
                    dispatch_get_main_queue(),
                    ctx,
                    render_frame,
                );
            }
        }
    }

    /// C-compatible render callback dispatched on the main thread.
    unsafe extern "C" fn render_frame(ctx_ptr: *mut c_void) {
        let ctx = unsafe { &*(ctx_ptr as *const RenderLoopCtx) };
        if !ctx.alive.load(Ordering::Acquire) {
            return;
        }

        // If rendering is suspended, clear the scheduled flag and bail.
        if ctx.rendering_suspended.load(Ordering::Acquire) {
            ctx.render_scheduled.store(false, Ordering::Release);
            return;
        }

        // Clear the "needs render" flag before rendering.
        ctx.needs_render.store(false, Ordering::Release);

        unsafe {
            CGLLockContext(ctx.cgl_ctx);
            CGLSetCurrentContext(ctx.cgl_ctx);

            // Notify NSOpenGLContext of any view size changes.
            let _: () = msg_send![ctx.ns_gl_ctx, update];

            // Get backing pixel size from the view.
            let bounds: NSRect = msg_send![ctx.view, bounds];
            let backing: NSRect = msg_send![ctx.view, convertRectToBacking: bounds];
            let w = backing.size.width as i32;
            let h = backing.size.height as i32;

            if w > 0 && h > 0 {
                let _ = ctx.renderer.render(0, w, h);
            }

            CGLFlushDrawable(ctx.cgl_ctx);
            CGLUnlockContext(ctx.cgl_ctx);
        }

        // Allow new dispatches from on_mpv_needs_render.
        ctx.render_scheduled.store(false, Ordering::Release);

        // If mpv flagged another frame while we were rendering, reschedule.
        if ctx.needs_render.load(Ordering::Acquire) {
            if ctx
                .render_scheduled
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                unsafe {
                    dispatch_async_f(
                        dispatch_get_main_queue(),
                        ctx_ptr,
                        render_frame,
                    );
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::NativeGlView;

#[cfg(not(target_os = "macos"))]
compile_error!("Native video view is currently only implemented for macOS");
