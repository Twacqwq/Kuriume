//! GPU renderer using mpv's OpenGL render API.
//!
//! Renders mpv's output into an OpenGL FBO. The caller manages the OpenGL
//! context (creation, making current, buffer swapping).

use crate::error::{MpvError, Result};
use libmpv2_sys::{
    mpv_opengl_fbo, mpv_opengl_init_params, mpv_render_context, mpv_render_context_create,
    mpv_render_context_free, mpv_render_context_render, mpv_render_context_report_swap,
    mpv_render_context_set_update_callback, mpv_render_param,
    mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
    mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y,
    mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
    mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO,
    mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, MPV_RENDER_API_TYPE_OPENGL,
};
use std::ffi::{c_int, c_void};
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};

/// GPU renderer wrapping an `mpv_render_context` (OpenGL).
pub struct GpuRenderer {
    ctx: *mut mpv_render_context,
    /// Stable heap allocation so the pointer passed to the C callback
    /// remains valid even if `GpuRenderer` is moved.
    needs_render: Box<AtomicBool>,
}

// SAFETY: mpv_render_context is thread-safe per mpv docs — all render API
// functions can be called from any thread (with the GL context current).
unsafe impl Send for GpuRenderer {}
unsafe impl Sync for GpuRenderer {}

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const std::ffi::c_char) -> *mut c_void;
}
/// macOS RTLD_DEFAULT = pointer to -2
const RTLD_DEFAULT: *mut c_void = -2isize as usize as *mut c_void;

/// `get_proc_address` callback — resolves OpenGL symbols via `dlsym`.
unsafe extern "C" fn gl_get_proc_address(
    _ctx: *mut c_void,
    name: *const std::ffi::c_char,
) -> *mut c_void {
    unsafe { dlsym(RTLD_DEFAULT, name) }
}

/// mpv "update" callback — sets the atomic flag when a new frame is ready.
unsafe extern "C" fn on_mpv_render_update(ctx: *mut c_void) {
    let flag = unsafe { &*(ctx as *const AtomicBool) };
    flag.store(true, Ordering::Release);
}

impl GpuRenderer {
    /// Create a GPU renderer attached to the given mpv instance.
    ///
    /// **The caller's OpenGL context must be current** on the calling thread.
    ///
    /// # Safety
    /// `mpv_handle` must be a valid `mpv_handle *`.
    pub unsafe fn new(mpv_handle: *mut c_void) -> Result<Self> {
        let mut gl_init = mpv_opengl_init_params {
            get_proc_address: Some(gl_get_proc_address),
            get_proc_address_ctx: ptr::null_mut(),
        };

        let api_type_ptr = MPV_RENDER_API_TYPE_OPENGL.as_ptr() as *mut c_void;

        let mut params: [mpv_render_param; 3] = [
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_API_TYPE,
                data: api_type_ptr,
            },
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                data: &mut gl_init as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];

        let mut ctx: *mut mpv_render_context = ptr::null_mut();
        let err = unsafe {
            mpv_render_context_create(
                &mut ctx,
                mpv_handle as *mut _,
                params.as_mut_ptr(),
            )
        };
        if err < 0 {
            return Err(MpvError::Mpv(format!(
                "mpv_render_context_create failed: error {err}"
            )));
        }

        let needs_render = Box::new(AtomicBool::new(true));

        unsafe {
            mpv_render_context_set_update_callback(
                ctx,
                Some(on_mpv_render_update),
                &*needs_render as *const AtomicBool as *mut c_void,
            );
        }

        Ok(Self { ctx, needs_render })
    }

    /// Returns `true` if mpv has a new frame ready for rendering.
    /// Resets the flag atomically.
    pub fn check_need_render(&self) -> bool {
        self.needs_render.swap(false, Ordering::AcqRel)
    }

    /// Replace the mpv render-update callback.
    ///
    /// The callback is invoked from an mpv-internal thread when a new
    /// frame is available.  `ctx` is passed as the sole argument.
    ///
    /// # Safety
    /// `ctx` must remain valid for the lifetime of this renderer (or
    /// until replaced with another callback).
    pub unsafe fn set_raw_update_callback(
        &self,
        cb: Option<unsafe extern "C" fn(*mut c_void)>,
        ctx: *mut c_void,
    ) {
        unsafe {
            mpv_render_context_set_update_callback(self.ctx, cb, ctx);
        }
    }

    /// Render the current mpv frame into the given FBO.
    ///
    /// **The caller's OpenGL context must be current.**
    ///
    /// - `fbo`: OpenGL framebuffer object name (0 = default FB).
    /// - `width`, `height`: pixel dimensions of the FBO.
    ///
    /// # Safety
    /// The GL context must be current and the FBO valid.
    pub unsafe fn render(&self, fbo: i32, width: i32, height: i32) -> Result<()> {
        let mut fbo_data = mpv_opengl_fbo {
            fbo: fbo as c_int,
            w: width as c_int,
            h: height as c_int,
            internal_format: 0,
        };

        let mut flip_y: c_int = 0;

        let mut params: [mpv_render_param; 3] = [
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_OPENGL_FBO,
                data: &mut fbo_data as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_FLIP_Y,
                data: &mut flip_y as *mut _ as *mut c_void,
            },
            mpv_render_param {
                type_: mpv_render_param_type_MPV_RENDER_PARAM_INVALID,
                data: ptr::null_mut(),
            },
        ];

        let err = unsafe { mpv_render_context_render(self.ctx, params.as_mut_ptr()) };
        if err < 0 {
            return Err(MpvError::Mpv(format!(
                "mpv_render_context_render failed: error {err}"
            )));
        }

        unsafe { mpv_render_context_report_swap(self.ctx) };
        Ok(())
    }
}

impl GpuRenderer {
    /// Manually free the underlying `mpv_render_context`.
    ///
    /// **The caller's OpenGL context must be current**, because mpv
    /// internally calls GL cleanup functions (`glDeleteQueries`, etc.).
    ///
    /// After this call the renderer is inert — `Drop` becomes a no-op.
    ///
    /// # Safety
    /// The GL context must be current on the calling thread.
    pub unsafe fn free(&mut self) {
        if !self.ctx.is_null() {
            unsafe {
                mpv_render_context_set_update_callback(self.ctx, None, ptr::null_mut());
                mpv_render_context_free(self.ctx);
            }
            self.ctx = ptr::null_mut();
        }
    }
}

impl Drop for GpuRenderer {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            // Safety net: if free() was not called explicitly, free now.
            // NOTE: This path may crash if no GL context is current!
            unsafe {
                mpv_render_context_set_update_callback(self.ctx, None, ptr::null_mut());
                mpv_render_context_free(self.ctx);
            }
            self.ctx = ptr::null_mut();
        }
    }
}
