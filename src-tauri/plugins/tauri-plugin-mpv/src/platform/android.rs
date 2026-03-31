//! Android rendering: EGL + OpenGL ES 3.0 → SurfaceView (behind WebView).
//!
//! Pipeline: mpv → GL FBO → glBlitFramebuffer → EGL window surface → eglSwapBuffers.
//!
//! A SurfaceView is created via JNI and added to the Activity's content view
//! behind the WebView. The render thread creates an EGL context tied to the
//! SurfaceView's ANativeWindow, renders mpv frames into an offscreen FBO, then
//! blits to the on-screen surface.

use kuriume_mpv::GpuRenderer;
use std::ffi::{c_int, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Condvar, Mutex};

// ── EGL types & constants ────────────────────────────────────────

type EGLDisplay = *mut c_void;
type EGLConfig = *mut c_void;
type EGLContext = *mut c_void;
type EGLSurface = *mut c_void;
type EGLint = i32;
type EGLNativeWindowType = *mut c_void;

const EGL_NO_DISPLAY: EGLDisplay = ptr::null_mut();
const EGL_NO_CONTEXT: EGLContext = ptr::null_mut();
const EGL_NO_SURFACE: EGLSurface = ptr::null_mut();

const EGL_DEFAULT_DISPLAY: EGLNativeWindowType = ptr::null_mut();
const EGL_OPENGL_ES3_BIT: EGLint = 0x0040;
const EGL_RENDERABLE_TYPE: EGLint = 0x3040;
const EGL_SURFACE_TYPE: EGLint = 0x3033;
const EGL_WINDOW_BIT: EGLint = 0x0004;
const EGL_PBUFFER_BIT: EGLint = 0x0001;
const EGL_RED_SIZE: EGLint = 0x3024;
const EGL_GREEN_SIZE: EGLint = 0x3025;
const EGL_BLUE_SIZE: EGLint = 0x3026;
const EGL_ALPHA_SIZE: EGLint = 0x3027;
const EGL_DEPTH_SIZE: EGLint = 0x3025;
const EGL_STENCIL_SIZE: EGLint = 0x3026;
const EGL_NONE: EGLint = 0x3038;
const EGL_CONTEXT_CLIENT_VERSION: EGLint = 0x3098;
const EGL_WIDTH: EGLint = 0x3057;
const EGL_HEIGHT: EGLint = 0x3058;
const EGL_TRUE: EGLint = 1;
const EGL_SUCCESS: EGLint = 0x3000;

// ── GL ES constants ──────────────────────────────────────────────

const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_READ_FRAMEBUFFER: u32 = 0x8CA8;
const GL_DRAW_FRAMEBUFFER: u32 = 0x8CA9;
const GL_COLOR_ATTACHMENT0: u32 = 0x8CE0;
const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_RGBA8: u32 = 0x8058;
const GL_RGBA: u32 = 0x1908;
const GL_UNSIGNED_BYTE: u32 = 0x1401;
const GL_COLOR_BUFFER_BIT: u32 = 0x4000;
const GL_LINEAR: u32 = 0x2601;

// ── FFI: EGL ─────────────────────────────────────────────────────

extern "C" {
    fn eglGetDisplay(display_id: EGLNativeWindowType) -> EGLDisplay;
    fn eglInitialize(display: EGLDisplay, major: *mut EGLint, minor: *mut EGLint) -> u32;
    fn eglChooseConfig(
        display: EGLDisplay,
        attrib_list: *const EGLint,
        configs: *mut EGLConfig,
        config_size: EGLint,
        num_config: *mut EGLint,
    ) -> u32;
    fn eglCreateContext(
        display: EGLDisplay,
        config: EGLConfig,
        share_context: EGLContext,
        attrib_list: *const EGLint,
    ) -> EGLContext;
    fn eglCreateWindowSurface(
        display: EGLDisplay,
        config: EGLConfig,
        win: EGLNativeWindowType,
        attrib_list: *const EGLint,
    ) -> EGLSurface;
    fn eglCreatePbufferSurface(
        display: EGLDisplay,
        config: EGLConfig,
        attrib_list: *const EGLint,
    ) -> EGLSurface;
    fn eglMakeCurrent(
        display: EGLDisplay,
        draw: EGLSurface,
        read: EGLSurface,
        ctx: EGLContext,
    ) -> u32;
    fn eglSwapBuffers(display: EGLDisplay, surface: EGLSurface) -> u32;
    fn eglDestroySurface(display: EGLDisplay, surface: EGLSurface) -> u32;
    fn eglDestroyContext(display: EGLDisplay, ctx: EGLContext) -> u32;
    fn eglTerminate(display: EGLDisplay) -> u32;
    fn eglGetError() -> EGLint;
    fn eglQuerySurface(
        display: EGLDisplay,
        surface: EGLSurface,
        attribute: EGLint,
        value: *mut EGLint,
    ) -> u32;
}

// ── FFI: GL ES 3.0 ──────────────────────────────────────────────

extern "C" {
    fn glGenFramebuffers(n: c_int, framebuffers: *mut u32);
    fn glDeleteFramebuffers(n: c_int, framebuffers: *const u32);
    fn glBindFramebuffer(target: u32, framebuffer: u32);
    fn glGenTextures(n: c_int, textures: *mut u32);
    fn glDeleteTextures(n: c_int, textures: *const u32);
    fn glBindTexture(target: u32, texture: u32);
    fn glTexImage2D(
        target: u32,
        level: c_int,
        internal_format: c_int,
        width: c_int,
        height: c_int,
        border: c_int,
        format: u32,
        type_: u32,
        pixels: *const c_void,
    );
    fn glFramebufferTexture2D(
        target: u32,
        attachment: u32,
        textarget: u32,
        texture: u32,
        level: c_int,
    );
    fn glViewport(x: c_int, y: c_int, width: c_int, height: c_int);
    fn glFlush();
    fn glBlitFramebuffer(
        src_x0: c_int,
        src_y0: c_int,
        src_x1: c_int,
        src_y1: c_int,
        dst_x0: c_int,
        dst_y0: c_int,
        dst_x1: c_int,
        dst_y1: c_int,
        mask: u32,
        filter: u32,
    );
}

// ── FFI: ANativeWindow ───────────────────────────────────────────

extern "C" {
    fn ANativeWindow_acquire(window: *mut c_void);
    fn ANativeWindow_release(window: *mut c_void);
    fn ANativeWindow_getWidth(window: *mut c_void) -> i32;
    fn ANativeWindow_getHeight(window: *mut c_void) -> i32;
}

// ── Render context (shared between init and render thread) ───────

struct RenderCtx {
    // EGL
    egl_display: EGLDisplay,
    egl_context: EGLContext,
    egl_surface: EGLSurface,
    egl_config: EGLConfig,

    // OpenGL ES (offscreen FBO)
    renderer: GpuRenderer,
    fbo: u32,
    gl_texture: u32,

    // Native window from SurfaceView
    native_window: *mut c_void,

    // Dimensions (backing pixels)
    surface_width: AtomicI32,
    surface_height: AtomicI32,
    target_width: AtomicI32,
    target_height: AtomicI32,

    // View position (CSS pixels, for JNI layout update)
    target_x: AtomicI32,
    target_y: AtomicI32,

    // Display density (pixels per dp)
    density: f64,

    // Synchronization
    alive: AtomicBool,
    needs_render: AtomicBool,
    wake: Condvar,
    wake_lock: Mutex<bool>,

    // JNI: stored references for view manipulation
    // The Surface/SurfaceView are managed via JNI global refs.
    surface_view_ref: jni::objects::GlobalRef,
    activity_ref: jni::objects::GlobalRef,
}

// SAFETY: EGL context is only used on the render thread.
// JNI GlobalRefs are thread-safe. Atomic fields provide synchronization.
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
    /// Create a new NativeVideoView.
    ///
    /// # Safety
    /// Must be called from the main (UI) thread.
    /// `parent_handle` is the `ANativeWindow*` from the Tauri window handle
    /// (used only to obtain the Activity; the actual rendering surface is
    /// a new SurfaceView created via JNI).
    /// `mpv_handle` is a valid `mpv_handle *`.
    pub unsafe fn new(
        parent_handle: *mut c_void,
        mpv_handle: *mut c_void,
    ) -> Result<Self, String> {
        // ── Step 1: Get JVM + Activity from ndk-context ──────────
        let ndk_ctx = ndk_context::android_context();
        let vm = unsafe {
            jni::JavaVM::from_raw(ndk_ctx.vm() as *mut _)
                .map_err(|e| format!("JavaVM::from_raw: {e}"))?
        };
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("attach JNI: {e}"))?;

        let activity = unsafe {
            jni::objects::JObject::from_raw(ndk_ctx.context() as jni::sys::jobject)
        };
        let activity_ref = env
            .new_global_ref(&activity)
            .map_err(|e| format!("activity global ref: {e}"))?;

        // ── Step 2: Get display density ──────────────────────────
        let resources = env
            .call_method(&activity, "getResources", "()Landroid/content/res/Resources;", &[])
            .map_err(|e| format!("getResources: {e}"))?
            .l()
            .map_err(|e| format!("getResources obj: {e}"))?;
        let display_metrics = env
            .call_method(
                &resources,
                "getDisplayMetrics",
                "()Landroid/util/DisplayMetrics;",
                &[],
            )
            .map_err(|e| format!("getDisplayMetrics: {e}"))?
            .l()
            .map_err(|e| format!("getDisplayMetrics obj: {e}"))?;
        let density = env
            .get_field(&display_metrics, "density", "F")
            .map_err(|e| format!("density field: {e}"))?
            .f()
            .map_err(|e| format!("density val: {e}"))? as f64;

        // ── Step 3: Create SurfaceView and add to Activity ───────
        let surface_view = env
            .new_object(
                "android/view/SurfaceView",
                "(Landroid/content/Context;)V",
                &[(&activity).into()],
            )
            .map_err(|e| format!("new SurfaceView: {e}"))?;

        // Set initial size (will be updated via set_frame)
        let layout_params = env
            .new_object(
                "android/widget/FrameLayout$LayoutParams",
                "(II)V",
                &[
                    jni::objects::JValue::Int(1),
                    jni::objects::JValue::Int(1),
                ],
            )
            .map_err(|e| format!("new LayoutParams: {e}"))?;

        // addContentView adds the SurfaceView to the Activity's content
        env.call_method(
            &activity,
            "addContentView",
            "(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V",
            &[(&surface_view).into(), (&layout_params).into()],
        )
        .map_err(|e| format!("addContentView: {e}"))?;

        // Place SurfaceView behind the WebView (z-order)
        env.call_method(&surface_view, "setZOrderMediaOverlay", "(Z)V", &[false.into()])
            .map_err(|e| format!("setZOrderMediaOverlay: {e}"))?;

        // Set FLAG_KEEP_SCREEN_ON on the Activity window
        let window = env
            .call_method(&activity, "getWindow", "()Landroid/view/Window;", &[])
            .map_err(|e| format!("getWindow: {e}"))?
            .l()
            .map_err(|e| format!("getWindow obj: {e}"))?;
        // FLAG_KEEP_SCREEN_ON = 0x00000080
        env.call_method(
            &window,
            "addFlags",
            "(I)V",
            &[jni::objects::JValue::Int(0x80)],
        )
        .map_err(|e| format!("addFlags: {e}"))?;

        // ── Step 4: Wait for Surface to be ready ─────────────────
        // Use SurfaceHolder to check if surface is valid.
        let holder = env
            .call_method(
                &surface_view,
                "getHolder",
                "()Landroid/view/SurfaceHolder;",
                &[],
            )
            .map_err(|e| format!("getHolder: {e}"))?
            .l()
            .map_err(|e| format!("getHolder obj: {e}"))?;

        // Poll until the surface is valid (it should be ready quickly
        // since we're on the main thread after addContentView).
        // In practice, the surface may not be ready immediately.
        // We spin briefly with yield, then fall back to a longer wait.
        let surface = loop {
            let surface = env
                .call_method(&holder, "getSurface", "()Landroid/view/Surface;", &[])
                .map_err(|e| format!("getSurface: {e}"))?
                .l()
                .map_err(|e| format!("getSurface obj: {e}"))?;

            let is_valid = env
                .call_method(&surface, "isValid", "()Z", &[])
                .map_err(|e| format!("isValid: {e}"))?
                .z()
                .map_err(|e| format!("isValid val: {e}"))?;

            if is_valid {
                break surface;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };

        // Get ANativeWindow from the Surface
        let native_window = unsafe {
            jni::sys::ANativeWindow_fromSurface(
                env.get_raw() as *mut _,
                surface.as_raw() as *mut _,
            ) as *mut c_void
        };
        if native_window.is_null() {
            return Err("ANativeWindow_fromSurface returned null".into());
        }
        unsafe { ANativeWindow_acquire(native_window) };

        let surface_view_ref = env
            .new_global_ref(&surface_view)
            .map_err(|e| format!("surface_view global ref: {e}"))?;

        let initial_w = unsafe { ANativeWindow_getWidth(native_window) };
        let initial_h = unsafe { ANativeWindow_getHeight(native_window) };

        // ── Step 5: Initialize EGL ───────────────────────────────
        let egl_display = unsafe { eglGetDisplay(EGL_DEFAULT_DISPLAY) };
        if egl_display == EGL_NO_DISPLAY {
            return Err("eglGetDisplay failed".into());
        }

        let mut major: EGLint = 0;
        let mut minor: EGLint = 0;
        if unsafe { eglInitialize(egl_display, &mut major, &mut minor) } == 0 {
            return Err(format!("eglInitialize failed: 0x{:04X}", unsafe {
                eglGetError()
            }));
        }

        // Choose EGL config: OpenGL ES 3.0, RGBA8, window surface
        let config_attribs: [EGLint; 15] = [
            EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
            EGL_SURFACE_TYPE, EGL_WINDOW_BIT | EGL_PBUFFER_BIT,
            EGL_RED_SIZE, 8,
            EGL_GREEN_SIZE, 8,
            EGL_BLUE_SIZE, 8,
            EGL_ALPHA_SIZE, 8,
            EGL_NONE,
            0, 0, // padding
        ];

        let mut egl_config: EGLConfig = ptr::null_mut();
        let mut num_configs: EGLint = 0;
        if unsafe {
            eglChooseConfig(
                egl_display,
                config_attribs.as_ptr(),
                &mut egl_config,
                1,
                &mut num_configs,
            )
        } == 0
            || num_configs == 0
        {
            return Err(format!("eglChooseConfig failed: 0x{:04X}", unsafe {
                eglGetError()
            }));
        }

        // Create EGL context (OpenGL ES 3.0)
        let ctx_attribs: [EGLint; 3] = [EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE];
        let egl_context = unsafe {
            eglCreateContext(
                egl_display,
                egl_config,
                EGL_NO_CONTEXT,
                ctx_attribs.as_ptr(),
            )
        };
        if egl_context == EGL_NO_CONTEXT {
            return Err(format!("eglCreateContext failed: 0x{:04X}", unsafe {
                eglGetError()
            }));
        }

        // Create EGL window surface from ANativeWindow
        let surface_attribs: [EGLint; 1] = [EGL_NONE];
        let egl_surface = unsafe {
            eglCreateWindowSurface(
                egl_display,
                egl_config,
                native_window,
                surface_attribs.as_ptr(),
            )
        };
        if egl_surface == EGL_NO_SURFACE {
            return Err(format!("eglCreateWindowSurface failed: 0x{:04X}", unsafe {
                eglGetError()
            }));
        }

        // Make EGL context current (will be moved to render thread)
        if unsafe { eglMakeCurrent(egl_display, egl_surface, egl_surface, egl_context) } == 0 {
            return Err(format!("eglMakeCurrent failed: 0x{:04X}", unsafe {
                eglGetError()
            }));
        }

        // ── Step 6: Create offscreen FBO + texture ───────────────
        let mut fbo: u32 = 0;
        let mut gl_texture: u32 = 0;
        unsafe {
            glGenFramebuffers(1, &mut fbo);
            glGenTextures(1, &mut gl_texture);

            glBindTexture(GL_TEXTURE_2D, gl_texture);
            glTexImage2D(
                GL_TEXTURE_2D,
                0,
                GL_RGBA8 as c_int,
                initial_w,
                initial_h,
                0,
                GL_RGBA,
                GL_UNSIGNED_BYTE,
                ptr::null(),
            );

            glBindFramebuffer(GL_FRAMEBUFFER, fbo);
            glFramebufferTexture2D(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_2D,
                gl_texture,
                0,
            );
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
        }

        // ── Step 7: Create mpv GPU renderer ──────────────────────
        let renderer =
            unsafe { GpuRenderer::new(mpv_handle) }.map_err(|e| format!("GpuRenderer: {e}"))?;

        // Release EGL context from this thread (render thread will own it)
        unsafe {
            eglMakeCurrent(egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        }

        // ── Step 8: Build RenderCtx and spawn render thread ──────
        let ctx = Arc::new(RenderCtx {
            egl_display,
            egl_context,
            egl_surface,
            egl_config,
            renderer,
            fbo,
            gl_texture,
            native_window,
            surface_width: AtomicI32::new(initial_w),
            surface_height: AtomicI32::new(initial_h),
            target_width: AtomicI32::new(initial_w),
            target_height: AtomicI32::new(initial_h),
            target_x: AtomicI32::new(0),
            target_y: AtomicI32::new(0),
            density,
            alive: AtomicBool::new(true),
            needs_render: AtomicBool::new(true),
            wake: Condvar::new(),
            wake_lock: Mutex::new(false),
            surface_view_ref,
            activity_ref,
        });

        // Install mpv render callback that wakes our render thread
        let ctx_weak = Arc::downgrade(&ctx);
        {
            let flag_ptr = &ctx.needs_render as *const AtomicBool as *mut c_void;
            unsafe {
                ctx.renderer.set_raw_update_callback(
                    Some(on_mpv_needs_render),
                    flag_ptr,
                );
            }
        }

        let ctx_clone = Arc::clone(&ctx);
        let render_thread = std::thread::Builder::new()
            .name("mpv-render-android".into())
            .spawn(move || render_loop(ctx_clone))
            .map_err(|e| format!("spawn render thread: {e}"))?;

        Ok(Self {
            ctx,
            render_thread: Some(render_thread),
        })
    }

    /// Update the view position and size (CSS pixels from top-left origin).
    pub fn set_frame(&self, x: f64, y: f64, width: f64, height: f64) {
        let density = self.ctx.density;
        let px_x = (x * density) as i32;
        let px_y = (y * density) as i32;
        let px_w = (width * density).max(1.0) as i32;
        let px_h = (height * density).max(1.0) as i32;

        self.ctx.target_x.store(px_x, Ordering::Release);
        self.ctx.target_y.store(px_y, Ordering::Release);
        self.ctx.target_width.store(px_w, Ordering::Release);
        self.ctx.target_height.store(px_h, Ordering::Release);

        // Update SurfaceView layout via JNI on the UI thread
        let ctx = Arc::clone(&self.ctx);
        std::thread::spawn(move || {
            let ndk_ctx = ndk_context::android_context();
            let Ok(vm) = (unsafe { jni::JavaVM::from_raw(ndk_ctx.vm() as *mut _) }) else {
                return;
            };
            let Ok(mut env) = vm.attach_current_thread() else {
                return;
            };
            let _ = update_surface_view_layout(&mut env, &ctx, px_x, px_y, px_w, px_h);
        });

        // Wake render thread to handle resize
        wake_render_thread(&self.ctx);
    }

    /// Destroy the native view and free all resources.
    pub fn destroy(&mut self) {
        self.ctx.alive.store(false, Ordering::Release);
        wake_render_thread(&self.ctx);

        if let Some(thread) = self.render_thread.take() {
            let _ = thread.join();
        }

        // Remove SurfaceView from Activity and clear wake lock flag
        let ndk_ctx = ndk_context::android_context();
        if let Ok(vm) = unsafe { jni::JavaVM::from_raw(ndk_ctx.vm() as *mut _) } {
            if let Ok(mut env) = vm.attach_current_thread() {
                // Remove SurfaceView from parent
                let surface_view = self.ctx.surface_view_ref.as_obj();
                let _ = env.call_method(surface_view, "getParent", "()Landroid/view/ViewParent;", &[])
                    .and_then(|parent| parent.l())
                    .and_then(|parent| {
                        env.call_method(&parent, "removeView", "(Landroid/view/View;)V", &[surface_view.into()])
                    });

                // Clear FLAG_KEEP_SCREEN_ON
                let activity = self.ctx.activity_ref.as_obj();
                if let Ok(window) = env
                    .call_method(activity, "getWindow", "()Landroid/view/Window;", &[])
                    .and_then(|w| w.l())
                {
                    let _ = env.call_method(
                        &window,
                        "clearFlags",
                        "(I)V",
                        &[jni::objects::JValue::Int(0x80)],
                    );
                }
            }
        }

        // Release native window
        if !self.ctx.native_window.is_null() {
            unsafe { ANativeWindow_release(self.ctx.native_window) };
        }
    }
}

// ── Render loop (dedicated thread) ───────────────────────────────

fn render_loop(ctx: Arc<RenderCtx>) {
    // Make EGL context current on this thread
    unsafe {
        if eglMakeCurrent(ctx.egl_display, ctx.egl_surface, ctx.egl_surface, ctx.egl_context) == 0
        {
            log::error!(
                "render_loop: eglMakeCurrent failed: 0x{:04X}",
                eglGetError()
            );
            return;
        }
    }

    while ctx.alive.load(Ordering::Acquire) {
        // Wait for a wake signal (mpv frame ready, resize, or shutdown)
        {
            let mut guard = ctx.wake_lock.lock().unwrap();
            while !ctx.needs_render.load(Ordering::Acquire) && ctx.alive.load(Ordering::Acquire) {
                guard = ctx.wake.wait(guard).unwrap();
            }
        }

        if !ctx.alive.load(Ordering::Acquire) {
            break;
        }

        // Check if resize is needed
        let target_w = ctx.target_width.load(Ordering::Acquire);
        let target_h = ctx.target_height.load(Ordering::Acquire);
        let current_w = ctx.surface_width.load(Ordering::Acquire);
        let current_h = ctx.surface_height.load(Ordering::Acquire);

        if target_w != current_w || target_h != current_h {
            unsafe { resize_surface(&ctx, target_w, target_h) };
        }

        let w = ctx.surface_width.load(Ordering::Acquire);
        let h = ctx.surface_height.load(Ordering::Acquire);
        if w <= 0 || h <= 0 {
            continue;
        }

        // Check if mpv has a new frame
        if !ctx.renderer.check_need_render() {
            continue;
        }

        // Render mpv frame into offscreen FBO
        unsafe {
            glBindFramebuffer(GL_FRAMEBUFFER, ctx.fbo);
            glViewport(0, 0, w, h);
            ctx.renderer
                .render(ctx.fbo as i32, w, h)
                .unwrap_or_else(|e| log::error!("mpv render: {e}"));
            glFlush();

            // Blit offscreen FBO → default framebuffer (window surface)
            glBindFramebuffer(GL_READ_FRAMEBUFFER, ctx.fbo);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
            glBlitFramebuffer(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_LINEAR);

            // Present
            eglSwapBuffers(ctx.egl_display, ctx.egl_surface);
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────
    unsafe {
        // Free mpv render context (GL context must be current)
        let renderer = &ctx.renderer as *const GpuRenderer as *mut GpuRenderer;
        (*renderer).free();

        glDeleteFramebuffers(1, &ctx.fbo);
        glDeleteTextures(1, &ctx.gl_texture);

        eglMakeCurrent(ctx.egl_display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        eglDestroySurface(ctx.egl_display, ctx.egl_surface);
        eglDestroyContext(ctx.egl_display, ctx.egl_context);
        // Note: don't eglTerminate — it's a process-global resource
    }
}

/// Resize the offscreen FBO texture and EGL surface to match target dimensions.
unsafe fn resize_surface(ctx: &RenderCtx, new_w: i32, new_h: i32) {
    if new_w <= 0 || new_h <= 0 {
        return;
    }

    // Recreate GL texture at new size
    unsafe {
        glBindTexture(GL_TEXTURE_2D, ctx.gl_texture);
        glTexImage2D(
            GL_TEXTURE_2D,
            0,
            GL_RGBA8 as c_int,
            new_w,
            new_h,
            0,
            GL_RGBA,
            GL_UNSIGNED_BYTE,
            ptr::null(),
        );

        // Re-attach to FBO
        glBindFramebuffer(GL_FRAMEBUFFER, ctx.fbo);
        glFramebufferTexture2D(
            GL_FRAMEBUFFER,
            GL_COLOR_ATTACHMENT0,
            GL_TEXTURE_2D,
            ctx.gl_texture,
            0,
        );
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
    }

    ctx.surface_width.store(new_w, Ordering::Release);
    ctx.surface_height.store(new_h, Ordering::Release);
}

// ── JNI helpers ──────────────────────────────────────────────────

fn update_surface_view_layout(
    env: &mut jni::JNIEnv,
    ctx: &RenderCtx,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), jni::errors::Error> {
    let surface_view = ctx.surface_view_ref.as_obj();

    // Get existing LayoutParams or create new one
    let layout_params = env.call_method(
        surface_view,
        "getLayoutParams",
        "()Landroid/view/ViewGroup$LayoutParams;",
        &[],
    )?
    .l()?;

    // Set width and height
    env.set_field(&layout_params, "width", "I", jni::objects::JValue::Int(width))?;
    env.set_field(&layout_params, "height", "I", jni::objects::JValue::Int(height))?;

    // Try to set margins if it's a MarginLayoutParams
    if env
        .is_instance_of(
            &layout_params,
            "android/view/ViewGroup$MarginLayoutParams",
        )
        .unwrap_or(false)
    {
        env.call_method(
            &layout_params,
            "setMargins",
            "(IIII)V",
            &[
                jni::objects::JValue::Int(x),
                jni::objects::JValue::Int(y),
                jni::objects::JValue::Int(0),
                jni::objects::JValue::Int(0),
            ],
        )?;
    }

    // Apply the updated layout
    env.call_method(
        surface_view,
        "setLayoutParams",
        "(Landroid/view/ViewGroup$LayoutParams;)V",
        &[(&layout_params).into()],
    )?;

    Ok(())
}

// ── Render thread wake helpers ───────────────────────────────────

/// mpv "update" callback — sets the atomic flag when a new frame is ready.
unsafe extern "C" fn on_mpv_needs_render(ctx: *mut c_void) {
    let flag = unsafe { &*(ctx as *const AtomicBool) };
    flag.store(true, Ordering::Release);
    // Wake the render thread — we store the condvar pointer in the RenderCtx
    // which is kept alive by the Arc. The flag being set is sufficient;
    // the render thread will check it on its next condvar wake.
}

fn wake_render_thread(ctx: &RenderCtx) {
    ctx.needs_render.store(true, Ordering::Release);
    let mut guard = ctx.wake_lock.lock().unwrap();
    *guard = true;
    ctx.wake.notify_one();
}
