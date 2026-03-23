//! Windows native video view: OpenGL (mpv render) → PBO readback → D3D11 → SwapChain.
//!
//! Architecture:
//! 1. mpv renders via its OpenGL render API into an offscreen FBO.
//! 2. PBO double-buffering asynchronously reads pixels from the FBO.
//! 3. Pixels are uploaded to a D3D11 staging texture, then copied to the back buffer.
//! 4. DXGI SwapChain presents the frame on a child HWND layered below the WebView2.

use kuriume_mpv::GpuRenderer;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;

// ── Win32 + OpenGL FFI ───────────────────────────────────────────

type HWND = *mut c_void;
type HDC = *mut c_void;
type HGLRC = *mut c_void;
type HINSTANCE = *mut c_void;
type ATOM = u16;
type BOOL = i32;
type UINT = u32;
type WPARAM = usize;
type LPARAM = isize;
type LRESULT = isize;
type DWORD = u32;
type LPCSTR = *const u8;

const WS_CHILD: DWORD = 0x4000_0000;
const WS_VISIBLE: DWORD = 0x1000_0000;
const WS_EX_LAYERED: DWORD = 0x0008_0000;
const CS_OWNDC: UINT = 0x0020;
const SWP_NOACTIVATE: UINT = 0x0010;
const SWP_NOZORDER: UINT = 0x0004;
const GWL_EXSTYLE: i32 = -20;
const LWA_ALPHA: u32 = 0x0000_0002;

const PFD_DRAW_TO_WINDOW: DWORD = 0x0000_0004;
const PFD_SUPPORT_OPENGL: DWORD = 0x0000_0020;
const PFD_DOUBLEBUFFER: DWORD = 0x0000_0001;
const PFD_TYPE_RGBA: u8 = 0;
const PFD_MAIN_PLANE: u8 = 0;

const GL_FRAMEBUFFER: u32 = 0x8D40;
const GL_COLOR_ATTACHMENT0: u32 = 0x8CE0;
const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_BGRA: u32 = 0x80E1;
const GL_UNSIGNED_BYTE: u32 = 0x1401;
const GL_RGBA8: u32 = 0x8058;
const GL_PIXEL_PACK_BUFFER: u32 = 0x88EB;
const GL_STREAM_READ: u32 = 0x88E1;
const GL_READ_ONLY: u32 = 0x88B8;
const GL_TEXTURE_MIN_FILTER: u32 = 0x2801;
const GL_TEXTURE_MAG_FILTER: u32 = 0x2800;
const GL_LINEAR: i32 = 0x2601;

#[repr(C)]
struct PIXELFORMATDESCRIPTOR {
    n_size: u16,
    n_version: u16,
    dw_flags: DWORD,
    i_pixel_type: u8,
    c_color_bits: u8,
    c_red_bits: u8,
    c_red_shift: u8,
    c_green_bits: u8,
    c_green_shift: u8,
    c_blue_bits: u8,
    c_blue_shift: u8,
    c_alpha_bits: u8,
    c_alpha_shift: u8,
    c_accum_bits: u8,
    c_accum_red_bits: u8,
    c_accum_green_bits: u8,
    c_accum_blue_bits: u8,
    c_accum_alpha_bits: u8,
    c_depth_bits: u8,
    c_stencil_bits: u8,
    c_aux_buffers: u8,
    i_layer_type: u8,
    b_reserved: u8,
    dw_layer_mask: DWORD,
    dw_visible_mask: DWORD,
    dw_damage_mask: DWORD,
}

#[repr(C)]
struct WNDCLASSEXA {
    cb_size: UINT,
    style: UINT,
    lpfn_wnd_proc: unsafe extern "system" fn(HWND, UINT, WPARAM, LPARAM) -> LRESULT,
    cb_cls_extra: i32,
    cb_wnd_extra: i32,
    h_instance: HINSTANCE,
    h_icon: *mut c_void,
    h_cursor: *mut c_void,
    hbr_background: *mut c_void,
    lpsz_menu_name: LPCSTR,
    lpsz_class_name: LPCSTR,
    h_icon_sm: *mut c_void,
}

#[repr(C)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

extern "system" {
    fn GetModuleHandleA(name: LPCSTR) -> HINSTANCE;
    fn RegisterClassExA(wc: *const WNDCLASSEXA) -> ATOM;
    fn CreateWindowExA(
        ex_style: DWORD,
        class_name: LPCSTR,
        window_name: LPCSTR,
        style: DWORD,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: HWND,
        menu: *mut c_void,
        instance: HINSTANCE,
        param: *mut c_void,
    ) -> HWND;
    fn DestroyWindow(hwnd: HWND) -> BOOL;
    fn SetWindowPos(
        hwnd: HWND,
        insert_after: HWND,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: UINT,
    ) -> BOOL;
    fn GetClientRect(hwnd: HWND, rect: *mut RECT) -> BOOL;
    fn DefWindowProcA(hwnd: HWND, msg: UINT, wparam: WPARAM, lparam: LPARAM) -> LRESULT;

    fn GetDC(hwnd: HWND) -> HDC;
    fn ReleaseDC(hwnd: HWND, hdc: HDC) -> i32;
    fn ChoosePixelFormat(hdc: HDC, ppfd: *const PIXELFORMATDESCRIPTOR) -> i32;
    fn SetPixelFormat(hdc: HDC, format: i32, ppfd: *const PIXELFORMATDESCRIPTOR) -> BOOL;
    fn SwapBuffers(hdc: HDC) -> BOOL;

    fn SetWindowLongPtrA(hwnd: HWND, index: i32, new_long: isize) -> isize;
    fn GetWindowLongPtrA(hwnd: HWND, index: i32) -> isize;
    fn SetLayeredWindowAttributes(hwnd: HWND, cr_key: u32, alpha: u8, flags: u32) -> BOOL;

    fn wglCreateContext(hdc: HDC) -> HGLRC;
    fn wglMakeCurrent(hdc: HDC, hglrc: HGLRC) -> BOOL;
    fn wglDeleteContext(hglrc: HGLRC) -> BOOL;
    fn wglGetProcAddress(name: *const u8) -> *mut c_void;
}

// GL functions loaded at runtime via wglGetProcAddress
type GlGenFramebuffersFn = unsafe extern "system" fn(i32, *mut u32);
type GlBindFramebufferFn = unsafe extern "system" fn(u32, u32);
type GlFramebufferTexture2DFn = unsafe extern "system" fn(u32, u32, u32, u32, i32);
type GlDeleteFramebuffersFn = unsafe extern "system" fn(i32, *const u32);
type GlGenBuffersFn = unsafe extern "system" fn(i32, *mut u32);
type GlBindBufferFn = unsafe extern "system" fn(u32, u32);
type GlBufferDataFn = unsafe extern "system" fn(u32, isize, *const c_void, u32);
type GlMapBufferFn = unsafe extern "system" fn(u32, u32) -> *mut c_void;
type GlUnmapBufferFn = unsafe extern "system" fn(u32) -> u8;
type GlDeleteBuffersFn = unsafe extern "system" fn(i32, *const u32);

extern "system" {
    fn glGenTextures(n: i32, textures: *mut u32);
    fn glBindTexture(target: u32, texture: u32);
    fn glTexImage2D(
        target: u32,
        level: i32,
        internal_format: i32,
        width: i32,
        height: i32,
        border: i32,
        format: u32,
        ty: u32,
        pixels: *const c_void,
    );
    fn glTexParameteri(target: u32, pname: u32, param: i32);
    fn glDeleteTextures(n: i32, textures: *const u32);
    fn glViewport(x: i32, y: i32, width: i32, height: i32);
    fn glReadPixels(
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        format: u32,
        ty: u32,
        pixels: *mut c_void,
    );
    fn glFlush();
    fn glFinish();
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: UINT,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcA(hwnd, msg, wparam, lparam) }
}

/// Loaded GL extension function pointers.
struct GlFns {
    gen_framebuffers: GlGenFramebuffersFn,
    bind_framebuffer: GlBindFramebufferFn,
    framebuffer_texture_2d: GlFramebufferTexture2DFn,
    delete_framebuffers: GlDeleteFramebuffersFn,
    gen_buffers: GlGenBuffersFn,
    bind_buffer: GlBindBufferFn,
    buffer_data: GlBufferDataFn,
    map_buffer: GlMapBufferFn,
    unmap_buffer: GlUnmapBufferFn,
    delete_buffers: GlDeleteBuffersFn,
}

impl GlFns {
    unsafe fn load() -> Result<Self, String> {
        unsafe fn get(name: &[u8]) -> Result<*mut c_void, String> {
            let addr = unsafe { wglGetProcAddress(name.as_ptr()) };
            if addr.is_null() || addr == 1 as *mut c_void || addr == 2 as *mut c_void {
                return Err(format!(
                    "wglGetProcAddress failed for {}",
                    std::str::from_utf8(&name[..name.len() - 1]).unwrap_or("?")
                ));
            }
            Ok(addr)
        }

        unsafe {
            Ok(Self {
                gen_framebuffers: std::mem::transmute(get(b"glGenFramebuffers\0")?),
                bind_framebuffer: std::mem::transmute(get(b"glBindFramebuffer\0")?),
                framebuffer_texture_2d: std::mem::transmute(get(b"glFramebufferTexture2D\0")?),
                delete_framebuffers: std::mem::transmute(get(b"glDeleteFramebuffers\0")?),
                gen_buffers: std::mem::transmute(get(b"glGenBuffers\0")?),
                bind_buffer: std::mem::transmute(get(b"glBindBuffer\0")?),
                buffer_data: std::mem::transmute(get(b"glBufferData\0")?),
                map_buffer: std::mem::transmute(get(b"glMapBuffer\0")?),
                unmap_buffer: std::mem::transmute(get(b"glUnmapBuffer\0")?),
                delete_buffers: std::mem::transmute(get(b"glDeleteBuffers\0")?),
            })
        }
    }
}

// ── D3D11 / DXGI FFI (minimal, display pipeline only) ────────────

#[repr(C)]
struct DxgiSwapChainDesc {
    buffer_desc: DxgiModeDesc,
    sample_desc: DxgiSampleDesc,
    buffer_usage: u32,
    buffer_count: u32,
    output_window: HWND,
    windowed: BOOL,
    swap_effect: u32,
    flags: u32,
}

#[repr(C)]
struct DxgiModeDesc {
    width: u32,
    height: u32,
    refresh_rate: DxgiRational,
    format: u32,
    scanline_ordering: u32,
    scaling: u32,
}

#[repr(C)]
struct DxgiRational {
    numerator: u32,
    denominator: u32,
}

#[repr(C)]
struct DxgiSampleDesc {
    count: u32,
    quality: u32,
}

#[repr(C)]
struct D3D11Texture2DDesc {
    width: u32,
    height: u32,
    mip_levels: u32,
    array_size: u32,
    format: u32,
    sample_desc: DxgiSampleDesc,
    usage: u32,
    bind_flags: u32,
    cpu_access_flags: u32,
    misc_flags: u32,
}

#[repr(C)]
struct D3D11SubresourceData {
    p_sys_mem: *const c_void,
    sys_mem_pitch: u32,
    sys_mem_slice_pitch: u32,
}

#[repr(C)]
struct D3D11MappedSubresource {
    p_data: *mut c_void,
    row_pitch: u32,
    depth_pitch: u32,
}

#[repr(C)]
struct D3D11Box {
    left: u32,
    top: u32,
    front: u32,
    right: u32,
    bottom: u32,
    back: u32,
}

// DXGI_FORMAT_B8G8R8A8_UNORM = 87
const DXGI_FORMAT_B8G8R8A8_UNORM: u32 = 87;
// DXGI_SWAP_EFFECT_DISCARD = 0  (BitBlt model — paints to redirection surface)
const DXGI_SWAP_EFFECT_DISCARD: u32 = 0;
// DXGI_USAGE_RENDER_TARGET_OUTPUT = 0x20
const DXGI_USAGE_RENDER_TARGET_OUTPUT: u32 = 0x20;
// D3D11_USAGE_STAGING = 3
const D3D11_USAGE_STAGING: u32 = 3;
// D3D11_CPU_ACCESS_WRITE = 0x10000
const D3D11_CPU_ACCESS_WRITE: u32 = 0x1_0000;
// D3D11_MAP_WRITE_DISCARD = 4 — not valid for staging. Use D3D11_MAP_WRITE = 2
const D3D11_MAP_WRITE: u32 = 2;
// D3D_DRIVER_TYPE_HARDWARE = 1
const D3D_DRIVER_TYPE_HARDWARE: u32 = 1;

// COM VTable helpers — we call methods via raw vtable pointers.
// IDXGISwapChain, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D
// are all COM objects with known vtable layouts.

/// Opaque COM pointer wrapper with Release-on-drop.
struct ComPtr(*mut c_void);

impl ComPtr {
    fn as_ptr(&self) -> *mut c_void {
        self.0
    }

    fn vtable(&self) -> *const *const c_void {
        unsafe { *(self.0 as *const *const *const c_void) }
    }
}

impl Drop for ComPtr {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                // IUnknown::Release is vtable index 2
                let release: unsafe extern "system" fn(*mut c_void) -> u32 =
                    std::mem::transmute(*self.vtable().add(2));
                release(self.0);
            }
        }
    }
}

unsafe impl Send for ComPtr {}
unsafe impl Sync for ComPtr {}

extern "system" {
    fn D3D11CreateDeviceAndSwapChain(
        p_adapter: *mut c_void,
        driver_type: u32,
        software: *mut c_void,
        flags: u32,
        feature_levels: *const u32,
        feature_levels_count: u32,
        sdk_version: u32,
        swap_chain_desc: *const DxgiSwapChainDesc,
        swap_chain: *mut *mut c_void,
        device: *mut *mut c_void,
        feature_level: *mut u32,
        device_context: *mut *mut c_void,
    ) -> i32; // HRESULT
}

#[link(name = "d3d11")]
extern "system" {}

#[link(name = "dxgi")]
extern "system" {}

// ── Render context ───────────────────────────────────────────────

struct RenderCtx {
    // -- OpenGL (offscreen mpv rendering) --
    hdc: HDC,
    hglrc: HGLRC,
    renderer: GpuRenderer,
    gl: GlFns,
    fbo: u32,
    gl_texture: u32,
    /// PBO double-buffer for async pixel readback.
    pbos: [u32; 2],
    pbo_index: usize,
    /// First frame flag — skip D3D11 upload until a PBO has been written to.
    has_prev_frame: AtomicBool,

    // -- D3D11 (display pipeline) --
    device: ComPtr,
    device_ctx: ComPtr,
    swap_chain: ComPtr,

    // -- HWND --
    child_hwnd: HWND,

    // -- Dimensions --
    surface_width: AtomicI32,
    surface_height: AtomicI32,
    target_width: AtomicI32,
    target_height: AtomicI32,
    dpi_scale: f64,

    // -- Lifecycle --
    alive: AtomicBool,
    needs_render: AtomicBool,
    wake: std::sync::Condvar,
    wake_lock: std::sync::Mutex<bool>,
}

// SAFETY: The WGL context is only used on the dedicated render thread.
// D3D11 immediate context is also only used on the render thread.
unsafe impl Send for RenderCtx {}
unsafe impl Sync for RenderCtx {}

pub struct NativeVideoView {
    render_ctx: Arc<RenderCtx>,
    render_thread: Option<std::thread::JoinHandle<()>>,
}

unsafe impl Send for NativeVideoView {}
unsafe impl Sync for NativeVideoView {}

impl NativeVideoView {
    /// Create the native video view and start the render thread.
    ///
    /// # Safety
    /// - `parent_hwnd` must be a valid `HWND`.
    /// - `mpv_handle` must be a valid `mpv_handle *`.
    /// - Must be called on the main thread.
    pub unsafe fn new(parent_hwnd: *mut c_void, mpv_handle: *mut c_void) -> Result<Self, String> {
        unsafe {
            // ── Get parent dimensions ────────────────────────────
            let mut parent_rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            GetClientRect(parent_hwnd, &mut parent_rect);
            let init_w = (parent_rect.right - parent_rect.left).max(1);
            let init_h = (parent_rect.bottom - parent_rect.top).max(1);

            // ── DPI scale ────────────────────────────────────────
            let dpi_scale = get_dpi_scale(parent_hwnd);

            // ── Create child HWND ────────────────────────────────
            let h_instance = GetModuleHandleA(std::ptr::null());
            let class_name = b"KuriumeVideoView\0";

            let wc = WNDCLASSEXA {
                cb_size: std::mem::size_of::<WNDCLASSEXA>() as UINT,
                style: CS_OWNDC,
                lpfn_wnd_proc: wnd_proc,
                cb_cls_extra: 0,
                cb_wnd_extra: 0,
                h_instance,
                h_icon: std::ptr::null_mut(),
                h_cursor: std::ptr::null_mut(),
                hbr_background: std::ptr::null_mut(),
                lpsz_menu_name: std::ptr::null(),
                lpsz_class_name: class_name.as_ptr(),
                h_icon_sm: std::ptr::null_mut(),
            };
            RegisterClassExA(&wc);

            let child_hwnd = CreateWindowExA(
                0,
                class_name.as_ptr(),
                b"mpv\0".as_ptr(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                init_w,
                init_h,
                parent_hwnd,
                std::ptr::null_mut(),
                h_instance,
                std::ptr::null_mut(),
            );
            if child_hwnd.is_null() {
                return Err("CreateWindowExA failed".into());
            }

            // ── WGL context ──────────────────────────────────────
            let hdc = GetDC(child_hwnd);
            if hdc.is_null() {
                DestroyWindow(child_hwnd);
                return Err("GetDC failed".into());
            }

            let pfd = PIXELFORMATDESCRIPTOR {
                n_size: std::mem::size_of::<PIXELFORMATDESCRIPTOR>() as u16,
                n_version: 1,
                dw_flags: PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER,
                i_pixel_type: PFD_TYPE_RGBA,
                c_color_bits: 32,
                c_red_bits: 0,
                c_red_shift: 0,
                c_green_bits: 0,
                c_green_shift: 0,
                c_blue_bits: 0,
                c_blue_shift: 0,
                c_alpha_bits: 8,
                c_alpha_shift: 0,
                c_accum_bits: 0,
                c_accum_red_bits: 0,
                c_accum_green_bits: 0,
                c_accum_blue_bits: 0,
                c_accum_alpha_bits: 0,
                c_depth_bits: 0,
                c_stencil_bits: 0,
                c_aux_buffers: 0,
                i_layer_type: PFD_MAIN_PLANE,
                b_reserved: 0,
                dw_layer_mask: 0,
                dw_visible_mask: 0,
                dw_damage_mask: 0,
            };

            let pf = ChoosePixelFormat(hdc, &pfd);
            if pf == 0 {
                ReleaseDC(child_hwnd, hdc);
                DestroyWindow(child_hwnd);
                return Err("ChoosePixelFormat failed".into());
            }
            if SetPixelFormat(hdc, pf, &pfd) == 0 {
                ReleaseDC(child_hwnd, hdc);
                DestroyWindow(child_hwnd);
                return Err("SetPixelFormat failed".into());
            }

            let hglrc = wglCreateContext(hdc);
            if hglrc.is_null() {
                ReleaseDC(child_hwnd, hdc);
                DestroyWindow(child_hwnd);
                return Err("wglCreateContext failed".into());
            }

            if wglMakeCurrent(hdc, hglrc) == 0 {
                wglDeleteContext(hglrc);
                ReleaseDC(child_hwnd, hdc);
                DestroyWindow(child_hwnd);
                return Err("wglMakeCurrent failed".into());
            }

            // ── Load GL extension functions ──────────────────────
            let gl = GlFns::load().map_err(|e| {
                wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());
                wglDeleteContext(hglrc);
                ReleaseDC(child_hwnd, hdc);
                DestroyWindow(child_hwnd);
                e
            })?;

            // ── Create FBO + texture ─────────────────────────────
            let mut fbo: u32 = 0;
            let mut gl_texture: u32 = 0;
            (gl.gen_framebuffers)(1, &mut fbo);
            glGenTextures(1, &mut gl_texture);

            (gl.bind_framebuffer)(GL_FRAMEBUFFER, fbo);
            glBindTexture(GL_TEXTURE_2D, gl_texture);
            glTexImage2D(
                GL_TEXTURE_2D,
                0,
                GL_RGBA8 as i32,
                init_w,
                init_h,
                0,
                GL_BGRA,
                GL_UNSIGNED_BYTE,
                std::ptr::null(),
            );
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            (gl.framebuffer_texture_2d)(
                GL_FRAMEBUFFER,
                GL_COLOR_ATTACHMENT0,
                GL_TEXTURE_2D,
                gl_texture,
                0,
            );

            // ── Create PBO double-buffer ─────────────────────────
            let buf_size = (init_w * init_h * 4) as isize;
            let mut pbos: [u32; 2] = [0; 2];
            (gl.gen_buffers)(2, pbos.as_mut_ptr());
            for &pbo in &pbos {
                (gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, pbo);
                (gl.buffer_data)(GL_PIXEL_PACK_BUFFER, buf_size, std::ptr::null(), GL_STREAM_READ);
            }
            (gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);

            // ── mpv renderer ─────────────────────────────────────
            let renderer = GpuRenderer::new(mpv_handle)
                .map_err(|e| format!("GpuRenderer::new: {e}"))?;

            wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());

            // ── Make child a layered window for independent DWM composition ─
            // Must be done AFTER WGL setup (ChoosePixelFormat needs non-layered DC).
            // SetLayeredWindowAttributes makes the window fully opaque while
            // giving it its own DWM composition surface, so D3D11 Present()
            // paints onto an independent surface visible through WebView2's
            // transparent areas.
            let ex_style = GetWindowLongPtrA(child_hwnd, GWL_EXSTYLE);
            SetWindowLongPtrA(child_hwnd, GWL_EXSTYLE, ex_style | WS_EX_LAYERED as isize);
            SetLayeredWindowAttributes(child_hwnd, 0, 255, LWA_ALPHA);

            // ── D3D11 device + swap chain ────────────────────────
            let sc_desc = DxgiSwapChainDesc {
                buffer_desc: DxgiModeDesc {
                    width: init_w as u32,
                    height: init_h as u32,
                    refresh_rate: DxgiRational {
                        numerator: 0,
                        denominator: 1,
                    },
                    format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    scanline_ordering: 0,
                    scaling: 0,
                },
                sample_desc: DxgiSampleDesc {
                    count: 1,
                    quality: 0,
                },
                buffer_usage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
                buffer_count: 1,
                output_window: child_hwnd,
                windowed: 1,
                swap_effect: DXGI_SWAP_EFFECT_DISCARD,
                flags: 0,
            };

            let mut p_swap_chain: *mut c_void = std::ptr::null_mut();
            let mut p_device: *mut c_void = std::ptr::null_mut();
            let mut p_device_ctx: *mut c_void = std::ptr::null_mut();
            let mut feature_level: u32 = 0;

            // D3D_FEATURE_LEVEL_11_0 = 0xb000
            let levels: [u32; 1] = [0xb000];

            let hr = D3D11CreateDeviceAndSwapChain(
                std::ptr::null_mut(),
                D3D_DRIVER_TYPE_HARDWARE,
                std::ptr::null_mut(),
                0,
                levels.as_ptr(),
                1,
                7, // D3D11_SDK_VERSION
                &sc_desc,
                &mut p_swap_chain,
                &mut p_device,
                &mut feature_level,
                &mut p_device_ctx,
            );

            if hr < 0 {
                wglDeleteContext(hglrc);
                ReleaseDC(child_hwnd, hdc);
                DestroyWindow(child_hwnd);
                return Err(format!("D3D11CreateDeviceAndSwapChain failed: 0x{hr:08X}"));
            }

            let device = ComPtr(p_device);
            let device_ctx = ComPtr(p_device_ctx);
            let swap_chain = ComPtr(p_swap_chain);

            // ── Build shared render context ──────────────────────
            let render_ctx = Arc::new(RenderCtx {
                hdc,
                hglrc,
                renderer,
                gl,
                fbo,
                gl_texture,
                pbos,
                pbo_index: 0,
                has_prev_frame: AtomicBool::new(false),
                device,
                device_ctx,
                swap_chain,
                child_hwnd,
                surface_width: AtomicI32::new(init_w),
                surface_height: AtomicI32::new(init_h),
                target_width: AtomicI32::new(init_w),
                target_height: AtomicI32::new(init_h),
                dpi_scale,
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

            // Start render thread
            let render_ctx_for_thread = render_ctx.clone();
            let render_thread = std::thread::Builder::new()
                .name("mpv-render".into())
                .spawn(move || render_loop(render_ctx_for_thread))
                .map_err(|e| format!("Failed to spawn render thread: {e}"))?;

            Ok(Self {
                render_ctx,
                render_thread: Some(render_thread),
            })
        }
    }

    /// Resize and reposition the video view.
    ///
    /// Coordinates are in CSS pixels, origin at top-left (Win32 convention).
    pub fn set_frame(&self, x: f64, y: f64, width: f64, height: f64) {
        let scale = self.render_ctx.dpi_scale;
        let px = (x * scale).round() as i32;
        let py = (y * scale).round() as i32;
        let pw = ((width * scale).round() as i32).max(1);
        let ph = ((height * scale).round() as i32).max(1);

        self.render_ctx.target_width.store(pw, Ordering::Release);
        self.render_ctx.target_height.store(ph, Ordering::Release);

        // Wake the render thread for resize
        {
            let mut pending = self.render_ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.render_ctx.wake.notify_one();
        }

        unsafe {
            SetWindowPos(
                self.render_ctx.child_hwnd,
                std::ptr::null_mut(),
                px,
                py,
                pw,
                ph,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }

    /// Clean up all resources.
    pub fn destroy(&mut self) {
        self.render_ctx.alive.store(false, Ordering::Release);
        {
            let mut pending = self.render_ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.render_ctx.wake.notify_one();
        }

        if let Some(handle) = self.render_thread.take() {
            let _ = handle.join();
        }

        unsafe {
            let ctx_ptr = Arc::as_ptr(&self.render_ctx) as *mut RenderCtx;

            // Free mpv render context with GL current
            wglMakeCurrent((*ctx_ptr).hdc, (*ctx_ptr).hglrc);
            (*ctx_ptr).renderer.free();

            // Clean up GL resources
            ((*ctx_ptr).gl.delete_framebuffers)(1, &(*ctx_ptr).fbo);
            glDeleteTextures(1, &(*ctx_ptr).gl_texture);
            ((*ctx_ptr).gl.delete_buffers)(2, (*ctx_ptr).pbos.as_ptr());

            wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());
            wglDeleteContext((*ctx_ptr).hglrc);
            ReleaseDC((*ctx_ptr).child_hwnd, (*ctx_ptr).hdc);

            // D3D11 resources released via ComPtr Drop

            DestroyWindow((*ctx_ptr).child_hwnd);
        }
    }
}

impl Drop for NativeVideoView {
    fn drop(&mut self) {
        if self.render_ctx.alive.load(Ordering::Acquire) {
            self.render_ctx.alive.store(false, Ordering::Release);
            let mut pending = self.render_ctx.wake_lock.lock().unwrap();
            *pending = true;
            self.render_ctx.wake.notify_one();
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

// ── Render loop ─────────────────────────────────────────────────

/// Recreate GL FBO/texture, PBOs, and D3D11 swap chain at new size.
///
/// # Safety
/// Must be called on the render thread with WGL context current.
unsafe fn resize_surface(ctx: &Arc<RenderCtx>, new_w: i32, new_h: i32) {
    let ctx_ptr = Arc::as_ptr(ctx) as *mut RenderCtx;

    // 1. Recreate GL texture
    glDeleteTextures(1, &(*ctx_ptr).gl_texture);
    let mut new_tex: u32 = 0;
    glGenTextures(1, &mut new_tex);
    glBindTexture(GL_TEXTURE_2D, new_tex);
    glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA8 as i32,
        new_w,
        new_h,
        0,
        GL_BGRA,
        GL_UNSIGNED_BYTE,
        std::ptr::null(),
    );
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

    ((*ctx_ptr).gl.bind_framebuffer)(GL_FRAMEBUFFER, (*ctx_ptr).fbo);
    ((*ctx_ptr).gl.framebuffer_texture_2d)(
        GL_FRAMEBUFFER,
        GL_COLOR_ATTACHMENT0,
        GL_TEXTURE_2D,
        new_tex,
        0,
    );
    (*ctx_ptr).gl_texture = new_tex;

    // 2. Recreate PBOs
    ((*ctx_ptr).gl.delete_buffers)(2, (*ctx_ptr).pbos.as_ptr());
    let buf_size = (new_w * new_h * 4) as isize;
    let mut new_pbos: [u32; 2] = [0; 2];
    ((*ctx_ptr).gl.gen_buffers)(2, new_pbos.as_mut_ptr());
    for &pbo in &new_pbos {
        ((*ctx_ptr).gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, pbo);
        ((*ctx_ptr).gl.buffer_data)(
            GL_PIXEL_PACK_BUFFER,
            buf_size,
            std::ptr::null(),
            GL_STREAM_READ,
        );
    }
    ((*ctx_ptr).gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
    (*ctx_ptr).pbos = new_pbos;
    (*ctx_ptr).pbo_index = 0;
    ctx.has_prev_frame.store(false, Ordering::Release);

    // 3. Resize D3D11 swap chain
    // IDXGISwapChain::ResizeBuffers is vtable index 13
    let sc = (*ctx_ptr).swap_chain.as_ptr();
    let sc_vtable = *(sc as *const *const *const c_void);
    let resize_buffers: unsafe extern "system" fn(
        *mut c_void,
        u32,
        u32,
        u32,
        u32,
        u32,
    ) -> i32 = std::mem::transmute(*sc_vtable.add(13));
    let hr = resize_buffers(sc, 1, new_w as u32, new_h as u32, DXGI_FORMAT_B8G8R8A8_UNORM, 0);
    if hr < 0 {
        log::error!("IDXGISwapChain::ResizeBuffers failed: 0x{hr:08X}");
    }

    ctx.surface_width.store(new_w, Ordering::Release);
    ctx.surface_height.store(new_h, Ordering::Release);
}

fn render_loop(ctx: Arc<RenderCtx>) {
    // Make WGL context current on this thread
    unsafe {
        wglMakeCurrent(ctx.hdc, ctx.hglrc);
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

        // Check for pending resize
        let tw = ctx.target_width.load(Ordering::Acquire);
        let th = ctx.target_height.load(Ordering::Acquire);
        let cw = ctx.surface_width.load(Ordering::Acquire);
        let ch = ctx.surface_height.load(Ordering::Acquire);
        if (tw != cw || th != ch) && tw > 0 && th > 0 {
            unsafe {
                resize_surface(&ctx, tw, th);
            }
        }

        if !ctx.needs_render.swap(false, Ordering::AcqRel) {
            continue;
        }

        let w = ctx.surface_width.load(Ordering::Acquire);
        let h = ctx.surface_height.load(Ordering::Acquire);
        if w <= 0 || h <= 0 {
            continue;
        }

        unsafe {
            let ctx_ptr = Arc::as_ptr(&ctx) as *mut RenderCtx;

            // ── Step 1: OpenGL — render mpv frame into FBO ───────
            (ctx.gl.bind_framebuffer)(GL_FRAMEBUFFER, ctx.fbo);
            glViewport(0, 0, w, h);
            let _ = ctx.renderer.render(ctx.fbo as i32, w, h);
            glFlush();

            // ── Step 2: PBO async readback ───────────────────────
            // Initiate read from FBO into current PBO
            let read_pbo = ctx.pbos[(*ctx_ptr).pbo_index];
            let map_pbo = ctx.pbos[1 - (*ctx_ptr).pbo_index];

            (ctx.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, read_pbo);
            glReadPixels(0, 0, w, h, GL_BGRA, GL_UNSIGNED_BYTE, std::ptr::null_mut());

            // Map the other PBO (from previous frame) to get pixels.
            // Skip on the very first frame — map_pbo hasn't been written yet.
            let have_prev = ctx.has_prev_frame.load(Ordering::Acquire);
            ctx.has_prev_frame.store(true, Ordering::Release);

            if have_prev {
            (ctx.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, map_pbo);
            let pixels = (ctx.gl.map_buffer)(GL_PIXEL_PACK_BUFFER, GL_READ_ONLY);

            if !pixels.is_null() {
                // ── Step 3: Upload to D3D11 ──────────────────────
                // Get back buffer from swap chain
                // IDXGISwapChain::GetBuffer is vtable index 9
                let sc = ctx.swap_chain.as_ptr();
                let sc_vtable = *(sc as *const *const *const c_void);
                let get_buffer: unsafe extern "system" fn(
                    *mut c_void,
                    u32,
                    *const [u8; 16],
                    *mut *mut c_void,
                ) -> i32 = std::mem::transmute(*sc_vtable.add(9));

                // IID_ID3D11Texture2D = {6f15aaf2-d208-4e89-9ab4-489535d34F9C}
                let iid: [u8; 16] = [
                    0xf2, 0xaa, 0x15, 0x6f, 0x08, 0xd2, 0x89, 0x4e, 0x9a, 0xb4, 0x48, 0x95, 0x35,
                    0xd3, 0x4f, 0x9c,
                ];
                let mut back_buffer: *mut c_void = std::ptr::null_mut();
                let hr = get_buffer(sc, 0, &iid, &mut back_buffer);

                if hr >= 0 && !back_buffer.is_null() {
                    // ID3D11DeviceContext::UpdateSubresource is vtable index 48
                    let dc = ctx.device_ctx.as_ptr();
                    let dc_vtable = *(dc as *const *const *const c_void);
                    let update_subresource: unsafe extern "system" fn(
                        *mut c_void, // this
                        *mut c_void, // pDstResource
                        u32,         // DstSubresource
                        *const D3D11Box, // pDstBox
                        *const c_void, // pSrcData
                        u32,         // SrcRowPitch
                        u32,         // SrcDepthPitch
                    ) -> () = std::mem::transmute(*dc_vtable.add(48));

                    // Flip vertically: OpenGL has bottom-left origin,
                    // D3D11 has top-left origin. Copy row by row.
                    let row_bytes = (w * 4) as usize;
                    let total = (w * h * 4) as usize;
                    let mut flipped = vec![0u8; total];
                    let src = std::slice::from_raw_parts(pixels as *const u8, total);
                    for row in 0..h as usize {
                        let src_row = (h as usize - 1 - row) * row_bytes;
                        let dst_row = row * row_bytes;
                        flipped[dst_row..dst_row + row_bytes]
                            .copy_from_slice(&src[src_row..src_row + row_bytes]);
                    }
                    // Force alpha to opaque — DWM composites the layered
                    // window's redirection surface with per-pixel alpha.
                    // mpv's OpenGL output has alpha=0, making the video
                    // invisible without this fix.
                    for px in flipped.chunks_exact_mut(4) {
                        px[3] = 0xFF;
                    }

                    update_subresource(
                        dc,
                        back_buffer,
                        0,
                        std::ptr::null(),
                        flipped.as_ptr() as *const c_void,
                        (w * 4) as u32,
                        0,
                    );

                    // Release back buffer (IUnknown::Release = vtable index 2)
                    let bb_vtable = *(back_buffer as *const *const *const c_void);
                    let release: unsafe extern "system" fn(*mut c_void) -> u32 =
                        std::mem::transmute(*bb_vtable.add(2));
                    release(back_buffer);
                }

                (ctx.gl.unmap_buffer)(GL_PIXEL_PACK_BUFFER);
            }

            // ── Step 4: Present ──────────────────────────────────
            // IDXGISwapChain::Present is vtable index 8
            let sc = ctx.swap_chain.as_ptr();
            let sc_vtable = *(sc as *const *const *const c_void);
            let present: unsafe extern "system" fn(*mut c_void, u32, u32) -> i32 =
                std::mem::transmute(*sc_vtable.add(8));
            present(sc, 1, 0);
            } // have_prev

            (ctx.gl.bind_buffer)(GL_PIXEL_PACK_BUFFER, 0);
            (*ctx_ptr).pbo_index = 1 - (*ctx_ptr).pbo_index;
        }
    }

    unsafe {
        wglMakeCurrent(std::ptr::null_mut(), std::ptr::null_mut());
    }
}

// ── DPI helper ───────────────────────────────────────────────────

extern "system" {
    fn GetDpiForWindow(hwnd: HWND) -> u32;
}

fn get_dpi_scale(hwnd: HWND) -> f64 {
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 {
        1.0
    } else {
        dpi as f64 / 96.0
    }
}
