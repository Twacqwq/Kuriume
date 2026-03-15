/**
 * MpvCanvas — renders mpv video frames received over WebSocket onto a
 * WebGL `<canvas>`.
 *
 * Protocol: each binary WebSocket message contains:
 *   bytes 0..4  — width  (u32 LE)
 *   bytes 4..8  — height (u32 LE)
 *   bytes 8..   — RGBA pixel data
 */
import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

export interface MpvCanvasProps {
  /** WebSocket server port (from player_init). 0 = not connected. */
  port: number;
  className?: string;
}

export interface MpvCanvasHandle {
  canvas: HTMLCanvasElement | null;
}

// Vertex shader — full-screen quad
const VS_SRC = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    // Map [-1,1] → [0,1] with Y flipped (video top = UV 0)
    v_uv = (a_pos + 1.0) * 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

// Fragment shader — sample RGBA texture
const FS_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  void main() {
    gl_FragColor = texture2D(u_tex, v_uv);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

export const MpvCanvas = forwardRef<MpvCanvasHandle, MpvCanvasProps>(
  ({ port, className }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const glRef = useRef<{
      gl: WebGLRenderingContext;
      tex: WebGLTexture;
    } | null>(null);

    useImperativeHandle(ref, () => ({
      get canvas() { return canvasRef.current; },
    }));

    // Initialize WebGL once.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const gl = canvas.getContext("webgl", { alpha: false, premultipliedAlpha: false });
      if (!gl) {
        console.error("MpvCanvas: WebGL not supported");
        return;
      }

      // Compile shaders & link program
      const vs = compileShader(gl, gl.VERTEX_SHADER, VS_SRC);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SRC);
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.useProgram(prog);

      // Full-screen quad (two triangles)
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      const aPos = gl.getAttribLocation(prog, "a_pos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      // Create texture
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      glRef.current = { gl, tex };

      return () => {
        gl.deleteTexture(tex);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteBuffer(buf);
        glRef.current = null;
      };
    }, []);

    // Connect WebSocket and stream frames.
    useEffect(() => {
      if (!port) return;

      const wsUrl = `ws://127.0.0.1:${port}`;
      let ws: WebSocket | null = null;
      let rafId = 0;
      let latestData: { width: number; height: number; pixels: Uint8Array } | null = null;

      function connect() {
        ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";

        ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
          const buf = ev.data;
          if (buf.byteLength < 8) return;

          const header = new DataView(buf, 0, 8);
          const width = header.getUint32(0, true);
          const height = header.getUint32(4, true);
          const expectedSize = 8 + width * height * 4;
          if (buf.byteLength < expectedSize) return;

          latestData = {
            width,
            height,
            pixels: new Uint8Array(buf, 8),
          };
        };

        ws.onclose = () => {
          // Reconnect after a short delay if still mounted.
          setTimeout(() => {
            if (ws) connect();
          }, 500);
        };
      }

      function renderLoop() {
        const ctx = glRef.current;
        if (ctx && latestData) {
          const { gl, tex } = ctx;
          const { width, height, pixels } = latestData;
          const canvas = canvasRef.current!;

          // Resize canvas to match frame dimensions.
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, width, height);
          }

          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            width,
            height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          latestData = null; // consume the frame
        }
        rafId = requestAnimationFrame(renderLoop);
      }

      connect();
      rafId = requestAnimationFrame(renderLoop);

      return () => {
        cancelAnimationFrame(rafId);
        if (ws) {
          const ref = ws;
          ws = null; // prevent reconnect in onclose
          ref.close();
        }
      };
    }, [port]);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ width: "100%", height: "100%", objectFit: "contain" }}
      />
    );
  },
);

MpvCanvas.displayName = "MpvCanvas";
