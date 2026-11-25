// The futuristic background: a three.js scene behind the app. One full-screen shader draws
// the aurora, parallax stars and a perspective grid; a wireframe crystal floats in front.
// Lazy-loaded, so three.js is only downloaded when futuristic mode is on.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { prefersReducedMotion } from "./theme";

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uRes;
  uniform vec2 uMouse;
  uniform float uScroll;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uRes.x / uRes.y;
    vec2 p = uv - 0.5;
    p.x *= aspect;

    // Deep space gradient
    vec3 col = mix(vec3(0.010, 0.012, 0.040), vec3(0.030, 0.020, 0.085), smoothstep(0.0, 1.0, uv.y));

    // Stars: three layers with parallax and twinkle
    for (int l = 0; l < 3; l++) {
      float fl = float(l);
      float scale = 90.0 + fl * 70.0;
      vec2 sp = (p + uMouse * 0.012 * (fl + 1.0) + vec2(0.0, uScroll * 0.00004 * (fl + 1.0))) * scale;
      vec2 id = floor(sp);
      vec2 gv = fract(sp) - 0.5;
      float h = hash(id + fl * 17.0);
      if (h > 0.982) {
        vec2 off = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
        float d = length(gv - off * 0.6);
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 50.0);
        vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(0.85, 0.75, 1.0), hash(id + 1.3));
        col += sc * smoothstep(0.07, 0.0, d) * tw * (1.0 - fl * 0.28);
      }
    }

    // Aurora
    float t = uTime * 0.035;
    vec2 q = p * vec2(1.1, 2.0) + uMouse * 0.05;
    float n = fbm(q * 1.5 + vec2(t, -t * 0.6));
    float band = smoothstep(0.36, 0.0, abs(p.y - 0.16 - (n - 0.5) * 0.6));
    vec3 aur = mix(vec3(0.13, 0.83, 0.93), vec3(0.55, 0.36, 0.97), smoothstep(-0.7, 0.7, p.x + (n - 0.5) * 1.2));
    aur = mix(aur, vec3(0.93, 0.30, 0.62), smoothstep(0.58, 0.85, n));
    col += aur * band * (0.20 + 0.20 * fbm(q * 3.0 + t * 2.0));
    float n2 = fbm(q * 2.2 - vec2(t * 1.4, t * 0.3));
    float band2 = smoothstep(0.22, 0.0, abs(p.y + 0.02 - (n2 - 0.5) * 0.45));
    col += vec3(0.18, 0.38, 1.0) * band2 * 0.10;

    // Perspective grid below a glowing horizon
    float horizon = 0.30;
    if (uv.y < horizon) {
      float d = horizon - uv.y;
      float z = 0.32 / d;
      vec2 g = vec2(p.x * z * 1.4, z - uTime * 0.45);
      vec2 w = fwidth(g) * 1.2;
      vec2 gl = abs(fract(g) - 0.5);
      // Lines sit where the fractional part wraps (gl near 0.5); fwidth keeps them crisp.
      float line = max(1.0 - smoothstep(0.0, w.x, 0.5 - gl.x), 1.0 - smoothstep(0.0, w.y, 0.5 - gl.y));
      float fade = smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.12, horizon, d) * 0.6);
      col += vec3(0.25, 0.55, 1.0) * line * fade * 0.22;
    }
    col += vec3(0.30, 0.50, 1.0) * exp(-abs(uv.y - horizon) * 38.0) * 0.18;

    // Vignette
    col *= 1.0 - 0.38 * length(p * vec2(0.75, 1.1));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export default function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
    } catch {
      return; // No WebGL: the CSS background stays.
    }
    const small = innerWidth < 768;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1 : 1.5));
    renderer.autoClear = false;
    host.appendChild(renderer.domElement);

    // Background shader on a full-screen triangle pair.
    const bgScene = new THREE.Scene();
    const bgCamera = new THREE.Camera();
    const uniforms = {
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(innerWidth, innerHeight) },
      uMouse: { value: new THREE.Vector2() },
      uScroll: { value: 0 },
    };
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms, depthWrite: false }),
    );
    bgScene.add(bg);

    // Floating wireframe crystal.
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    camera.position.z = 8;
    const crystal = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(1.4, 1);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }),
    );
    const inner = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.75, 0)),
      new THREE.LineBasicMaterial({ color: 0xc4b5fd, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }),
    );
    const dots = new THREE.Points(
      new THREE.BufferGeometry().setAttribute("position", geo.getAttribute("position")),
      new THREE.PointsMaterial({ color: 0xa5f3fc, size: 0.06, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }),
    );
    crystal.add(edges, inner, dots);
    scene.add(crystal);

    const place = () => {
      const w = host.clientWidth || innerWidth;
      const h = host.clientHeight || innerHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      uniforms.uRes.value.set(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Top-right on desktop; smaller and higher on phones.
      const phone = w < 768;
      // Tucked into the top-right corner, partly off-screen, so it never sits behind controls.
      const half = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      crystal.position.set(half * camera.aspect - (phone ? 0.35 : 0.9), half - (phone ? 0.55 : 0.85), 0);
      crystal.scale.setScalar(phone ? 0.42 : 0.72);
      (edges.material as THREE.LineBasicMaterial).opacity = phone ? 0.25 : 0.32;
    };
    place();
    addEventListener("resize", place);

    const target = new THREE.Vector2();
    const onMove = (e: PointerEvent) => target.set(e.clientX / innerWidth - 0.5, 0.5 - e.clientY / innerHeight);
    addEventListener("pointermove", onMove, { passive: true });
    const onScroll = () => (uniforms.uScroll.value = scrollY);
    addEventListener("scroll", onScroll, { passive: true });

    const reduced = prefersReducedMotion();
    const timer = new THREE.Timer();
    let raf = 0;
    const draw = () => {
      timer.update();
      const t = timer.getElapsed();
      uniforms.uTime.value = t;
      uniforms.uMouse.value.lerp(target, 0.04);
      crystal.rotation.x = t * 0.12 + uniforms.uMouse.value.y * 0.6;
      crystal.rotation.y = t * 0.18 + uniforms.uMouse.value.x * 0.8;
      inner.rotation.y = -t * 0.5;
      renderer.clear();
      renderer.render(bgScene, bgCamera);
      renderer.render(scene, camera);
    };
    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) draw();
    else raf = requestAnimationFrame(loop);

    // Card spotlight: tell the card under the pointer where the pointer is.
    let lit: HTMLElement | null = null;
    const onCardMove = (e: PointerEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.(".card") as HTMLElement | null;
      if (lit && lit !== card) {
        lit.style.removeProperty("--mx");
        lit.style.removeProperty("--my");
      }
      lit = card;
      if (card) {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
    };
    addEventListener("pointermove", onCardMove, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", place);
      removeEventListener("pointermove", onMove);
      removeEventListener("pointermove", onCardMove);
      removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      timer.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
      geo.dispose();
    };
  }, []);

  return <div ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10" />;
}
