/**
 * A small reader for mpv user-shader files (the format Anime4K ships its GLSL
 * in), enough to run Anime4K's CNN passes on WebGL2: each `//!DESC` block is
 * a pass with `//!BIND` inputs, a `//!SAVE` target and `//!WIDTH` / `//!HEIGHT`
 * sizes written in RPN. `//!HOOK`, `//!WHEN` and `//!COMPONENTS` are decided
 * by the caller (only MAIN hooks are used; the x2 condition is checked in JS).
 */
export type HookPass = {
  description: string;
  binds: string[];
  save: string;
  width: string | null;
  height: string | null;
  body: string;
};

export function parseHookShader(source: string): HookPass[] {
  const passes: HookPass[] = [];
  let current: HookPass | null = null;
  let body: string[] = [];
  const finish = () => {
    if (current) passes.push({ ...current, body: body.join("\n").trim() });
  };
  for (const line of source.split(/\r?\n/)) {
    const directive = /^\/\/!(\w+)\s*(.*)$/.exec(line.trim());
    if (directive?.[1] === "DESC") {
      finish();
      current = { description: directive[2], binds: [], save: "", width: null, height: null, body: "" };
      body = [];
      continue;
    }
    if (!current) continue;
    if (directive) {
      const [, key, value] = directive;
      if (key === "BIND") current.binds.push(value.trim());
      else if (key === "SAVE") current.save = value.trim();
      else if (key === "WIDTH") current.width = value.trim();
      else if (key === "HEIGHT") current.height = value.trim();
      continue;
    }
    body.push(line);
  }
  finish();
  for (const pass of passes) {
    if (!pass.save) throw new Error(`${pass.description}: no //!SAVE target`);
    if (pass.binds.length === 0) throw new Error(`${pass.description}: no //!BIND input`);
  }
  return passes;
}

/** Evaluates a `//!WIDTH` expression such as `conv2d_last_tf.w 2 *`. */
export function evaluateSize(expression: string, sizes: Record<string, { width: number; height: number }>): number {
  const stack: number[] = [];
  for (const token of expression.split(/\s+/).filter(Boolean)) {
    const reference = /^(\w+)\.(w|h|width|height)$/.exec(token);
    if (reference) {
      const size = sizes[reference[1]];
      if (!size) throw new Error(`Unknown texture in size expression: ${reference[1]}`);
      stack.push(reference[2].startsWith("w") ? size.width : size.height);
    } else if (/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(token)) {
      stack.push(Number(token));
    } else {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) throw new Error(`Malformed size expression: ${expression}`);
      const result = { "+": left + right, "-": left - right, "*": left * right, "/": left / right, ">": Number(left > right), "<": Number(left < right) }[token];
      if (result === undefined) throw new Error(`Unsupported operator in size expression: ${token}`);
      stack.push(result);
    }
  }
  if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error(`Malformed size expression: ${expression}`);
  return Math.round(stack[0]);
}

/**
 * GLSL ES 3.00 fragment shader for one pass. mpv's per-texture helpers map
 * onto uniforms: NAME_tex(p) samples NAME, NAME_pos is this pixel's
 * normalized position (every texture covers the same picture), NAME_pt is
 * one texel and NAME_texOff(o) samples o texels away.
 */
export function fragmentSource(pass: HookPass): string {
  const helpers = pass.binds.map((name) => [
    `uniform sampler2D ${name}_raw;`,
    `uniform vec2 ${name}_pt;`,
    `#define ${name}_pos v_pos`,
    `#define ${name}_size (vec2(1.0) / ${name}_pt)`,
    `#define ${name}_tex(p) texture(${name}_raw, p)`,
    `#define ${name}_texOff(o) texture(${name}_raw, v_pos + ${name}_pt * (o))`,
  ].join("\n")).join("\n");
  return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_pos;
out vec4 fragColor;
${helpers}
${pass.body}
void main() { fragColor = hook(); }
`;
}
