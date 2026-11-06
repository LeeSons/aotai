// 给标准材质注入：积雪覆盖、雨湿、细节噪声、风中摆动
import * as THREE from 'three';

export function makeWeatherUniforms() {
  return {
    uSnow: { value: 0 },        // 积雪 0..1
    uWet: { value: 0 },         // 地面湿润 0..1
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.3, 0) },
    uSnowLine: { value: 500 },  // 积雪起始高度（游戏 y）
  };
}

export function patchWeatherMaterial(mat, U, opts = {}) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    const sway = opts.sway || 0;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWind;
        varying vec3 vWorldPos; varying vec3 vWorldN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${sway > 0 ? `
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float hgt = max(position.y, 0.0) ${opts.grass ? '' : '* 0.15'};
          float ph = uTime * (1.6 + length(uWind) * 0.8) + ip.x * 0.37 + ip.z * 0.29;
          float s = (sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.4) * ${sway.toFixed(3)} * (0.4 + length(uWind));
          transformed.x += (s + uWind.x * ${(sway * 0.8).toFixed(3)}) * hgt;
          transformed.z += (s * 0.6 + uWind.y * ${(sway * 0.8).toFixed(3)}) * hgt;
        }` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
            wn = mat3(instanceMatrix) * wn;
          #endif
          wp = modelMatrix * wp;
          vWorldPos = wp.xyz;
          vWorldN = normalize(mat3(modelMatrix) * wn);
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSnow; uniform float uWet; uniform float uSnowLine;
        varying vec3 vWorldPos; varying vec3 vWorldN;
        float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${opts.detail ? `
        {
          vec2 wp = vWorldPos.xz;
          float n1 = vnoise(wp * 0.11), n2 = vnoise(wp * 0.9), n3 = vnoise(wp * 3.7), n4 = vnoise(wp * 11.0);
          float dn = n2 * 0.45 + n3 * 0.35 + n1 * 0.2;
          vec3 base = diffuseColor.rgb * (0.8 + dn * 0.38);
          // 枯草/新绿斑点
          base = mix(base, base * vec3(1.25, 1.12, 0.8), smoothstep(0.62, 0.85, n3) * 0.5);
          base *= 0.92 + n4 * 0.12;
          // 陡坡露出花岗岩（逐像素）
          float slope = 1.0 - clamp(vWorldN.y, 0.0, 1.0);
          float rk = smoothstep(0.2, 0.36, slope + (n1 - 0.5) * 0.2 + (n3 - 0.5) * 0.08);
          vec3 rockC = vec3(0.29, 0.285, 0.275) * (0.72 + n2 * 0.35 + n4 * 0.15);
          rockC = mix(rockC, rockC * vec3(1.05, 1.03, 0.82), smoothstep(0.55, 0.8, n1) * 0.6);
          // 岩面裂隙
          float crack = smoothstep(0.08, 0.0, abs(n3 - 0.5)) * 0.35;
          rockC *= 1.0 - crack;
          diffuseColor.rgb = mix(base, rockC, rk);
        }` : ''}
        {
          float up = smoothstep(0.55, 0.85, vWorldN.y);
          float line = smoothstep(uSnowLine - 25.0, uSnowLine + 25.0, vWorldPos.y);
          float sn = clamp(uSnow * 1.3 - (1.0 - up) * 0.9, 0.0, 1.0) * line;
          sn *= smoothstep(0.25, 0.6, vnoise(vWorldPos.xz * 0.35) * 0.6 + uSnow * 0.7);
          ${opts.grass ? 'sn *= 0.8;' : ''}
          diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - uWet * 0.38), vec3(0.92, 0.94, 0.98), sn);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= mix(1.0, 0.5, uWet);`);
  };
  mat.customProgramCacheKey = () => 'wx' + (opts.sway || 0) + (opts.detail ? 'd' : '') + (opts.grass ? 'g' : '');
  return mat;
}
