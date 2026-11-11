// ===================== 后期处理管线 =====================
// HDR 场景 + 深度 → 半分辨率线性深度 → 环境光遮蔽（AO）→ 体积光（太阳光柱）→ 合成
// → 泛光（逐级降采样 / 升采样）→ 自动曝光 + 太阳遮挡检测 → 镜头光晕、色调映射、调色
// → FXAA 抗锯齿 + 锐化 + 胶片颗粒。每一步都可以按画质档位关掉；任何一步出错就退回直接渲染。
import * as THREE from 'three';

const TAG = '// AOTAI_POST';
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const HEAD = `
varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
const EXPO = `
uniform sampler2D tAdapt; uniform float uExposure, uKey, uMinE, uMaxE, uAuto;
float autoExposure(){ float a = texture2D(tAdapt, vec2(0.5)).r; return uExposure * mix(1.0, clamp(pow(uKey / max(a, 1e-4), 0.8), uMinE, uMaxE), uAuto); }
`;

const FS_DEPTH = `${HEAD}
uniform sampler2D tDepth; uniform float uNear, uFar;
void main(){
  // 精确取整像素：取在像素角上会忽上忽下，掠射角的地面上 AO 会出条纹
  ivec2 p = min(ivec2(gl_FragCoord.xy) * 2, textureSize(tDepth, 0) - 1);
  float d = texelFetch(tDepth, p, 0).r;
  float z = (uNear * uFar) / (uFar - d * (uFar - uNear));
  gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
}`;

const FS_AO = `${HEAD}
uniform sampler2D tDepthHalf; uniform vec2 uTanHalf, uTexel; uniform float uRadius, uIntensity, uAspect;
vec3 vpos(vec2 uv, float z){ return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
void main(){
  float z0 = texture2D(tDepthHalf, vUv).r;
  if (z0 > 260.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vpos(vUv, z0);
  vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
  float zl = texture2D(tDepthHalf, vUv - ox).r, zr = texture2D(tDepthHalf, vUv + ox).r;
  float zd = texture2D(tDepthHalf, vUv - oy).r, zu = texture2D(tDepthHalf, vUv + oy).r;
  vec3 dx = abs(zl - z0) < abs(zr - z0) ? P - vpos(vUv - ox, zl) : vpos(vUv + ox, zr) - P;
  vec3 dy = abs(zd - z0) < abs(zu - z0) ? P - vpos(vUv - oy, zd) : vpos(vUv + oy, zu) - P;
  vec3 n = normalize(cross(dx, dy));
  // 近处是物体脚下的小范围遮蔽；越远半径越大，树林、石缝、沟谷整体暗下去
  float R = uRadius * (0.55 + 0.45 * clamp(z0 / 12.0, 0.0, 1.0)) + z0 * 0.02;
  float rUv = clamp(R / (2.0 * z0 * uTanHalf.y), 3.0 * uTexel.y, 0.13);
  float R2 = R * R;
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  for (int i = 0; i < AO_TAPS; i++) {
    float a = (float(i) + 0.5) / float(AO_TAPS);
    float th = a * 6.2831853 * 3.0 + rot;
    vec2 o = vec2(cos(th), sin(th)) * a * rUv; o.x /= uAspect;
    vec2 uv2 = vUv + o;
    float z2 = texture2D(tDepthHalf, uv2).r;
    vec3 v = vpos(uv2, z2) - P;
    float vv = dot(v, v), vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - (0.02 + 0.006 * z0)) / (vv + 0.004), 0.0);
  }
  float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (R2 * R2 * R2 * float(AO_TAPS)));
  ao = mix(ao, 1.0, smoothstep(140.0, 260.0, z0));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

const FS_VOL = `${HEAD}
uniform sampler2D tDepthHalf, tShadow;
uniform mat4 uShadowMatrix, uCamWorld;
uniform vec3 uCamPos, uSunRad, uSunDir;
uniform vec2 uTanHalf;
uniform float uHasShadow, uMaxDist, uSigma, uFrame;
float hg(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
float sunVis(vec3 p){
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  sc.xyz /= sc.w;
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 1.0;
  float d = dot(texture2D(tShadow, sc.xy), vec4(0.99609375, 0.99609375 / 256.0, 0.99609375 / 65536.0, 1.0 / 16777216.0));
  return step(sc.z - 0.0012, d);
}
void main(){
  float z = texture2D(tDepthHalf, vUv).r;
  vec3 vd = vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0);
  float rl = length(vd);
  vec3 rd = normalize(mat3(uCamWorld) * vd);
  float maxD = min(z * rl, uMaxDist);
  float mu = dot(rd, uSunDir);
  // 双瓣相函数：朝太阳方向一圈金色的光晕 + 一层宽的，侧面看光柱也看得见
  float ph = min(hg(mu, 0.76) * 0.6 + hg(mu, 0.2) * 0.4, 1.2);
  // 每帧换一组抖动：残余的噪点是细碎、会动的颗粒，不会连成一条条横纹
  float j = fract(hash12(gl_FragCoord.xy) + uFrame * 0.61803);
  float acc = 0.0, T = 1.0, tPrev = 0.0;
  for (int i = 0; i < VOL_STEPS; i++) {
    float f = (float(i) + 1.0) / float(VOL_STEPS);
    float t1 = maxD * f * (0.35 + 0.65 * f);              // 靠近眼睛的地方采样更密
    float ds = t1 - tPrev;
    vec3 p = uCamPos + rd * (tPrev + ds * j);
    float sh = uHasShadow > 0.5 ? sunVis(p) : 1.0;
    float Ti = exp(-uSigma * ds);
    acc += T * sh * (1.0 - Ti);
    T *= Ti; tPrev = t1;
  }
  gl_FragColor = vec4(uSunRad * (ph * acc), 1.0);
}`;

const FS_BLUR = `${HEAD}
uniform sampler2D tSrc, tDepthHalf; uniform vec2 uDir;
void main(){
  float zc = min(texture2D(tDepthHalf, vUv).r, 400.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = min(texture2D(tDepthHalf, uv).r, 400.0);
    float w = (1.0 - abs(float(i)) * 0.22) * max(0.0, 1.0 - abs(z - zc) / (BLUR_TOL * zc + 0.02));
    acc += texture2D(tSrc, uv) * w; ws += w;
  }
  gl_FragColor = ws > 1e-4 ? acc / ws : texture2D(tSrc, vUv);
}`;

const FS_COMP = `${HEAD}
uniform sampler2D tColor, tDepth, tDepthHalf, tAO, tVol;
uniform vec2 uHalfRes; uniform float uNear, uFar, uAoOn, uVolOn, uAoStrength, uFogD;
${EXPO}
void main(){
  vec3 col = max(texture2D(tColor, vUv).rgb, vec3(0.0));
  float d = texture2D(tDepth, vUv).r;
  float z = (uNear * uFar) / (uFar - d * (uFar - uNear));
  // 半分辨率缓冲按深度做联合双边上采样：物体边缘不会糊出一圈
  vec2 hp = vUv * uHalfRes - 0.5; vec2 f = fract(hp); vec2 base = (floor(hp) + 0.5) / uHalfRes; vec2 tx = 1.0 / uHalfRes;
  float ao = 0.0; vec3 vol = vec3(0.0); float ws = 0.0;
  float zc = min(z, 400.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 uv = base + o * tx;
    float zh = min(texture2D(tDepthHalf, uv).r, 400.0);
    float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
    w *= 1.0 / (0.015 + abs(zh - zc) / zc);
    w = max(w, 1e-5);
    ao += texture2D(tAO, uv).r * w; vol += texture2D(tVol, uv).rgb * w; ws += w;
  }
  ao /= ws; vol /= ws;
  if (uAoOn > 0.5 && d < 0.99999) {
    // 遮蔽只该压暗环境光：被太阳照亮的像素上淡掉，雾里的远景也淡掉
    float lit = smoothstep(0.2, 0.95, luma(col) * autoExposure());
    float fogK = exp(-uFogD * uFogD * z * z * 6.0);
    float a = mix(1.0, ao, uAoStrength * (1.0 - 0.75 * lit) * fogK);
    col *= mix(vec3(a), vec3(1.0), vec3(0.0, 0.03, 0.07));        // 遮蔽处略微偏冷
  }
  if (uVolOn > 0.5) col += vol;
  gl_FragColor = vec4(col, 1.0);
}`;

const FS_DOWN = `${HEAD}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
vec3 s(vec2 o){ return min(max(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(0.0)), vec3(400.0)); }
float kw(vec3 c){ return 1.0 / (1.0 + luma(c) * 0.08); }
void main(){
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (uFirst > 0.5) {
    // 第一级用加权平均压住孤立的高亮像素，又不至于把太阳压没
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const FS_UP = `${HEAD}
uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uMix;
void main(){
  vec2 o = uTexel;
  vec3 t = texture2D(tLow, vUv).rgb * 4.0;
  t += (texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb + texture2D(tLow, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  t += texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
  t *= 1.0 / 16.0;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, t, uMix), 1.0);
}`;

const FS_ADAPT = `${HEAD}
uniform sampler2D tPrev, tLum, tDepth; uniform vec2 uSunUv; uniform float uSunOn, uRate, uVisRate, uAspect, uHasDepth;
void main(){
  float ls = 0.0, ws = 0.0;
  for (int y = 0; y < 5; y++) for (int x = 0; x < 7; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(7.0, 5.0);
    float w = 1.0 - 0.7 * smoothstep(0.1, 0.55, length(uv - 0.5));        // 中央重点测光
    ls += log(max(luma(texture2D(tLum, uv).rgb), 1e-4)) * w; ws += w;
  }
  float avg = clamp(exp(ls / ws), 0.002, 40.0);
  float vis = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0) * 0.011; float th = float(i) * 2.39996323;
    vec2 uv = uSunUv + vec2(cos(th) / uAspect, sin(th)) * r;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) vis += 1.0;
    else vis += uHasDepth > 0.5 ? step(0.99999, texture2D(tDepth, uv).r) : 1.0;
  }
  vis = vis / 12.0 * uSunOn;
  vec4 prev = texture2D(tPrev, vec2(0.5));
  float a = mix(prev.r, avg, uRate);
  if (!(a > 0.0) || a > 1e4) a = avg;
  float v = mix(prev.g, vis, uVisRate);
  if (!(v >= 0.0)) v = vis;
  gl_FragColor = vec4(a, v, 0.0, 1.0);
}`;

const GRAIN = `
uniform float uGrain;
vec3 grainDither(vec3 col, float t){
  vec2 seed = gl_FragCoord.xy + fract(t * vec2(7.31, 3.17)) * vec2(311.7, 173.3);
  float g = hash12(seed) + hash12(seed + 57.3) - 1.0;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * mix(1.0, 0.3, smoothstep(0.25, 0.9, l)) * (0.35 + 0.65 * smoothstep(0.0, 0.08, l));
  col += (hash12(gl_FragCoord.xy * 1.37 + 11.0) + hash12(gl_FragCoord.xy * 0.71 + 3.0) - 1.0) / 255.0;   // 抖动，天空渐变不出色带
  return col;
}`;

const FS_FINAL = `${HEAD}
uniform sampler2D tScene, tBloom, tBlur;
${EXPO}
${GRAIN}
uniform vec3 uSunCol; uniform vec2 uSunUv, uRes;
uniform float uTime, uAspect, uBloom, uFlare, uCA, uVignette, uSunOn, uLast;
uniform float uBlur, uDesat, uCold, uAber, uPulse, uRed, uFlash;

vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * RRTAndODTFit(inM * (c * 1.7)), 0.0, 1.0);
}
// AgX：高光往白里收，不会像 ACES 那样把橙色烧成一片
const mat3 REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
vec3 agxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 color){
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = inset * (SRGB_TO_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, vec3(0.0)), vec3(1.16));
  color = l + (color - l) * 1.2;
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(REC2020_TO_SRGB * color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

// 逆光时镜头里的眩光、鬼影和光环
vec3 flare(vec2 uv, vec2 sun, float vis){
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - 0.5) * asp, s = (sun - 0.5) * asp;
  vec2 dv = p - s; float r = length(dv);
  vec3 c = vec3(0.0);
  float ang = atan(dv.y, dv.x);
  float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 24.0) + 0.6 * pow(abs(cos(ang * 4.0 - 1.1)), 40.0);
  c += uSunCol * (0.016 / (r * r * 9.0 + 0.010) + 0.08 * exp(-r * 3.2));
  c += uSunCol * spikes * 0.22 * exp(-r * 5.5);
  vec3 g = vec3(0.0);
  float k0 = length(p + s * 0.38);  g += vec3(0.30, 0.75, 0.55) * smoothstep(0.085, 0.06, k0) * 0.050;
  float k1 = length(p + s * 0.82);  g += vec3(0.85, 0.45, 0.25) * smoothstep(0.045, 0.030, k1) * 0.075;
  float k2 = length(p + s * 1.35);  g += vec3(0.35, 0.50, 0.95) * smoothstep(0.17, 0.12, k2) * (0.4 + 0.6 * smoothstep(0.05, 0.16, k2)) * 0.040;
  float k3 = length(p - s * 0.45);  g += vec3(0.80, 0.70, 0.35) * smoothstep(0.030, 0.018, k3) * 0.060;
  float hr = length(p + s * 0.15);
  g += vec3(0.45, 0.55, 0.85) * exp(-pow((hr - 0.52) * 16.0, 2.0)) * 0.035 * smoothstep(0.1, 0.5, length(s));
  c += g * uSunCol * 2.0;
  return c * vis;
}

void main(){
  vec2 uv = vUv;
  // 高反 / 失温时画面的晃动和色散
  uv += vec2(sin(uv.y * 9.0 + uTime * 1.3), cos(uv.x * 7.0 + uTime * 1.1)) * 0.0022 * uAber;
  vec2 c = uv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0)) / (0.25 * (uAspect * uAspect + 1.0));    // 0 中心 .. 1 角落
  vec2 off = c * r2 * uCA + vec2(uAber * 0.004, 0.0);
  vec3 col = vec3(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b);
  col = max(col, vec3(0.0));
  vec3 bloom = texture2D(tBloom, uv).rgb;
  // 视线模糊（力竭、高反、雪盲）：直接用泛光链里已经糊好的图
  if (uBlur > 0.01) col = mix(col, texture2D(tBlur, uv).rgb, clamp(uBlur * 1.1, 0.0, 0.92));
  col = mix(col, bloom, uBloom);
  vec4 ad = texture2D(tAdapt, vec2(0.5));
  float vis = ad.g * uSunOn;
  if (vis > 0.002) col += flare(uv, uSunUv, vis) * uFlare;
  col *= autoExposure() * (1.0 + uPulse);
  col += vec3(0.75, 0.8, 1.0) * uFlash;
  col = mix(aces(col), agx(col), 0.2);
  // —— 调色（显示线性空间）——
  float l = luma(col);
  col *= mix(vec3(0.95, 1.0, 1.04), vec3(1.04, 1.0, 0.95), smoothstep(0.03, 0.55, l));    // 暗部略偏青，亮部略偏暖
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.3);                                     // S 曲线：拉开明暗
  col = col * 0.99 + vec3(0.004, 0.006, 0.008);
  l = luma(col);
  col = mix(vec3(l), col, 1.08);
  // —— 身体状态 ——
  col = mix(col, vec3(l), clamp(uDesat, 0.0, 1.0));
  col = mix(col, col * vec3(0.8, 0.92, 1.15) + vec3(0.0, 0.01, 0.03) * l, clamp(uCold, 0.0, 1.0));
  col = mix(col, col * vec3(1.25, 0.65, 0.62), clamp(uRed, 0.0, 1.0));
  float vr = smoothstep(0.15, 1.05, r2);
  col *= 1.0 - uVignette * vr * vr * (3.0 - 2.0 * vr);
  col = toSRGB(clamp(col, 0.0, 1.0));
  if (uLast > 0.5) col = grainDither(col, uTime);
  gl_FragColor = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));
}`;

const FS_FXAA = `${HEAD}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uTime, uSharpen, uFxaa;
${GRAIN}
void main(){
  vec4 M = texture2D(tSrc, vUv);
  vec3 col = M.rgb;
  vec4 NW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel), NE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel);
  vec4 SW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel), SE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel);
  float lMin = min(M.a, min(min(NW.a, NE.a), min(SW.a, SE.a)));
  float lMax = max(M.a, max(max(NW.a, NE.a), max(SW.a, SE.a)));
  float contrast = lMax - lMin;
  if (uFxaa > 0.5 && contrast > max(0.0312, lMax * 0.10)) {
    vec2 dir = vec2(-((NW.a + NE.a) - (SW.a + SE.a)), (NW.a + SW.a) - (NE.a + SE.a));
    float dirReduce = max((NW.a + NE.a + SW.a + SE.a) * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
    vec4 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
    vec4 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5) + texture2D(tSrc, vUv + dir * 0.5));
    col = (B.a < lMin || B.a > lMax) ? A.rgb : B.rgb;
  }
  // 轻微锐化；强边缘上收手（那是 FXAA 的活）
  vec3 blur = (NW.rgb + NE.rgb + SW.rgb + SE.rgb) * 0.25;
  col += (M.rgb - blur) * uSharpen * (1.0 - smoothstep(0.04, 0.22, contrast));
  gl_FragColor = vec4(grainDither(col, uTime), 1.0);
}`;

// 各画质档位开哪些效果
export const POST_TIERS = {
  low:   { ao: 0, vol: 0, bloom: 0, fxaa: false, flare: false },
  mid:   { ao: 0, vol: 0, bloom: 5, fxaa: false, flare: true },
  high:  { ao: 10, vol: 10, bloom: 6, fxaa: true, flare: true },
  ultra: { ao: 14, vol: 16, bloom: 6, fxaa: true, flare: true },
};

export class Post {
  constructor(renderer, tierKey, msaa) {
    this.renderer = renderer;
    this.broken = false;
    this.mats = [];
    this.w = 4; this.h = 4;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(geo, null); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const HF = THREE.HalfFloatType, UB = THREE.UnsignedByteType, LIN = THREE.LinearFilter, NEAR = THREE.NearestFilter;
    const rt = (type = HF, filter = LIN) => {
      const t = new THREE.WebGLRenderTarget(4, 4, { type, format: THREE.RGBAFormat, minFilter: filter, magFilter: filter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
      return t;
    };
    this.msaa = msaa | 0;
    this.depthTex = new THREE.DepthTexture(4, 4);
    this.depthTex.minFilter = this.depthTex.magFilter = NEAR;
    this.hdr = new THREE.WebGLRenderTarget(4, 4, { type: HF, format: THREE.RGBAFormat, minFilter: LIN, magFilter: LIN, depthBuffer: true, stencilBuffer: false, depthTexture: this.depthTex, samples: this.msaa, generateMipmaps: false });
    this.R = { scene: rt(), ldr: rt(UB), depthHalf: rt(HF, NEAR), aoA: rt(UB, NEAR), aoB: rt(UB, NEAR), volA: rt(HF, NEAR), volB: rt(HF, NEAR), down: [], up: [], adapt: [rt(HF, NEAR), rt(HF, NEAR)] };
    this.LEVELS = 6;
    for (let i = 0; i < this.LEVELS; i++) this.R.down.push(rt());
    for (let i = 0; i < this.LEVELS - 1; i++) this.R.up.push(rt());
    this.R.adapt[0].setSize(1, 1); this.R.adapt[1].setSize(1, 1);
    this.adaptI = 0; this.frameN = 0;

    // 游戏那边直接改这些值：身体状态带来的画面变化 + 曝光
    this.u = {
      uTime: { value: 0 }, uBlur: { value: 0 }, uDesat: { value: 0 }, uCold: { value: 0 }, uAber: { value: 0 }, uPulse: { value: 0 },
      uExposure: { value: 1 }, uGrain: { value: 0.03 }, uRed: { value: 0 }, uFlash: { value: 0 },
    };
    this.expo = { tAdapt: { value: null }, uExposure: this.u.uExposure, uKey: { value: 0.2 }, uMinE: { value: 0.7 }, uMaxE: { value: 1.6 }, uAuto: { value: 1 } };
    this.tune = { aoRadius: 1.1, aoIntensity: 1.5, aoStrength: 0.9, bloom: 0.07, flare: 0.14, ca: 0.0012, vignette: 0.22, sharpen: 0.28, volSigma: 0.0016, volMaxDist: 110, volGain: 1 };

    const M = (name, fs, uniforms, defines) => {
      const m = new THREE.ShaderMaterial({ name: 'post-' + name, vertexShader: VS, fragmentShader: `${TAG} ${name}\n${fs}`, uniforms, defines: defines || {}, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false });
      this.mats.push(m); return m;
    };
    const V2 = () => ({ value: new THREE.Vector2() });
    this.mDepth = M('depth', FS_DEPTH, { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 5000 } });
    this.mAO = M('ao', FS_AO, { tDepthHalf: { value: this.R.depthHalf.texture }, uTanHalf: V2(), uTexel: V2(), uRadius: { value: 1 }, uIntensity: { value: 1 }, uAspect: { value: 1 } }, { AO_TAPS: 10 });
    this.mVol = M('vol', FS_VOL, { tDepthHalf: { value: this.R.depthHalf.texture }, tShadow: { value: null }, uShadowMatrix: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uSunRad: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uTanHalf: V2(), uHasShadow: { value: 0 }, uMaxDist: { value: 110 }, uSigma: { value: 0.002 }, uFrame: { value: 0 } }, { VOL_STEPS: 10 });
    this.mBlurAO = M('blur-ao', FS_BLUR, { tSrc: { value: null }, tDepthHalf: { value: this.R.depthHalf.texture }, uDir: V2() }, { BLUR_TOL: '0.03' });
    this.mBlurVol = M('blur-vol', FS_BLUR, { tSrc: { value: null }, tDepthHalf: { value: this.R.depthHalf.texture }, uDir: V2() }, { BLUR_TOL: '0.6' });
    this.mComp = M('comp', FS_COMP, { tColor: { value: null }, tDepth: { value: null }, tDepthHalf: { value: this.R.depthHalf.texture }, tAO: { value: this.R.aoA.texture }, tVol: { value: this.R.volA.texture }, uHalfRes: V2(), uNear: { value: 0.1 }, uFar: { value: 5000 }, uAoOn: { value: 0 }, uVolOn: { value: 0 }, uAoStrength: { value: 1 }, uFogD: { value: 0 }, ...this.expo });
    this.mDown = M('down', FS_DOWN, { tSrc: { value: null }, uTexel: V2(), uFirst: { value: 0 } });
    this.mUp = M('up', FS_UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: V2(), uMix: { value: 0.62 } });
    this.mAdapt = M('adapt', FS_ADAPT, { tPrev: { value: null }, tLum: { value: null }, tDepth: { value: null }, uSunUv: V2(), uSunOn: { value: 0 }, uRate: { value: 1 }, uVisRate: { value: 1 }, uAspect: { value: 1 }, uHasDepth: { value: 1 } });
    this.mFinal = M('final', FS_FINAL, {
      tScene: { value: null }, tBloom: { value: null }, tBlur: { value: null }, ...this.expo,
      uSunCol: { value: new THREE.Vector3(1, 0.9, 0.7) }, uSunUv: V2(), uRes: V2(), uTime: this.u.uTime, uAspect: { value: 1 }, uBloom: { value: 0 }, uFlare: { value: 0 },
      uCA: { value: 0 }, uVignette: { value: 0.2 }, uSunOn: { value: 0 }, uLast: { value: 0 },
      uBlur: this.u.uBlur, uDesat: this.u.uDesat, uCold: this.u.uCold, uAber: this.u.uAber, uPulse: this.u.uPulse, uRed: this.u.uRed, uFlash: this.u.uFlash, uGrain: this.u.uGrain,
    });
    this.mFxaa = M('fxaa', FS_FXAA, { tSrc: { value: this.R.ldr.texture }, uTexel: V2(), uTime: this.u.uTime, uSharpen: { value: 0.3 }, uFxaa: { value: 1 }, uGrain: this.u.uGrain });
    this.setTier(tierKey);

    // 着色器编译出错：记下来，下一帧起退回直接渲染
    const prevErr = renderer.debug.onShaderError;
    renderer.debug.onShaderError = (gl, program, vs, fs) => {
      let src = '', log = '';
      try { src = gl.getShaderSource(fs) || ''; log = (gl.getShaderInfoLog(fs) || '') + ' ' + (gl.getShaderInfoLog(vs) || '') + ' ' + (gl.getProgramInfoLog(program) || ''); } catch (e) { /* */ }
      if (src.includes(TAG)) { this.broken = true; console.error('[post] 后期着色器出错：' + ((src.match(/AOTAI_POST (\S+)/) || [])[1]) + ' ' + log.trim().slice(0, 600)); }
      else { console.error('[gfx] 材质着色器出错：' + log.trim().slice(0, 900)); if (prevErr) prevErr(gl, program, vs, fs); }
    };
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3();
  }

  setTier(key) {
    this.tierKey = key;
    const T = this.tier = { ...(POST_TIERS[key] || POST_TIERS.high) };
    if (T.ao && this.mAO.defines.AO_TAPS !== T.ao) { this.mAO.defines.AO_TAPS = T.ao; this.mAO.needsUpdate = true; }
    if (T.vol && this.mVol.defines.VOL_STEPS !== T.vol) { this.mVol.defines.VOL_STEPS = T.vol; this.mVol.needsUpdate = true; }
  }

  setMsaa(n) {
    n |= 0;
    if (this.msaa === n || this.noDepth) return;
    this.msaa = n; this.hdr.samples = n; this.hdr.dispose();
  }

  setSize(w, h) {
    w = Math.max(8, w | 0); h = Math.max(8, h | 0);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const hw = this.hw = Math.max(4, Math.ceil(w / 2)), hh = this.hh = Math.max(4, Math.ceil(h / 2));
    this.hdr.setSize(w, h);
    this.R.scene.setSize(w, h); this.R.ldr.setSize(w, h);
    for (const t of [this.R.depthHalf, this.R.aoA, this.R.aoB, this.R.volA, this.R.volB]) t.setSize(hw, hh);
    let a = hw, b = hh;
    for (let i = 0; i < this.LEVELS; i++) { this.R.down[i].setSize(a, b); if (i < this.LEVELS - 1) this.R.up[i].setSize(a, b); a = Math.max(2, a >> 1); b = Math.max(2, b >> 1); }
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  // env: { sun 平行光, sunDir 真正的太阳方向, sunCol 镜头光晕颜色, sunOn 太阳亮度 0..1, fogD 雾浓度, vol 体积光强度, dt, autoRange [min,max] }
  render(scene, camera, env) {
    const R = this.renderer;
    if (this.broken) { R.setRenderTarget(null); R.render(scene, camera); return; }
    const T = this.tier, Q = this.R, tu = this.tune;
    R.setRenderTarget(this.hdr);
    if (!this._fbOK) {
      // 头一帧检查一下渲染目标：个别显卡不支持“多重采样 + 深度贴图”，退一步不要深度；再不行就直接渲染
      const gl = R.getContext();
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        if (!this.noDepth) {
          console.warn('[post] 渲染目标不完整，去掉深度贴图重试（环境光遮蔽、体积光关闭）');
          this.noDepth = true; this.hdr.dispose(); this.hdr.depthTexture = null; this.hdr.samples = 0;
          R.setRenderTarget(this.hdr);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) this.broken = true;
        } else this.broken = true;
        if (this.broken) { console.error('[post] 渲染目标不可用，改为直接渲染'); R.setRenderTarget(null); R.render(scene, camera); return; }
      }
      this._fbOK = true;
    }
    R.render(scene, camera);
    const pe = camera.projectionMatrix.elements, tx = 1 / pe[0], ty = 1 / pe[5], aspect = tx / ty;
    const E = this.expo;
    E.tAdapt.value = Q.adapt[this.adaptI].texture;
    if (env.autoRange) { E.uMinE.value = env.autoRange[0]; E.uMaxE.value = env.autoRange[1]; }
    const wantAO = T.ao > 0 && !this.noDepth, wantVol = T.vol > 0 && !this.noDepth && env.vol > 0.003 && env.sun && env.sun.intensity > 0.02;
    let src = this.hdr.texture;
    if (wantAO || wantVol) {
      const u = this.mDepth.uniforms; u.tDepth.value = this.depthTex; u.uNear.value = camera.near; u.uFar.value = camera.far;
      this.pass(this.mDepth, Q.depthHalf);
      const ix = 1 / this.hw, iy = 1 / this.hh;
      if (wantAO) {
        const a = this.mAO.uniforms; a.uTanHalf.value.set(tx, ty); a.uTexel.value.set(ix, iy); a.uAspect.value = aspect; a.uRadius.value = tu.aoRadius; a.uIntensity.value = tu.aoIntensity;
        this.pass(this.mAO, Q.aoA);
        const b = this.mBlurAO.uniforms;
        b.tSrc.value = Q.aoA.texture; b.uDir.value.set(ix, 0); this.pass(this.mBlurAO, Q.aoB);
        b.tSrc.value = Q.aoB.texture; b.uDir.value.set(0, iy); this.pass(this.mBlurAO, Q.aoA);
      }
      if (wantVol) {
        const v = this.mVol.uniforms, sun = env.sun;
        const sm = sun.shadow && sun.shadow.map ? sun.shadow.map.texture : null;
        v.tShadow.value = sm; v.uHasShadow.value = sm ? 1 : 0;
        if (sm) v.uShadowMatrix.value.copy(sun.shadow.matrix);
        v.uCamWorld.value.copy(camera.matrixWorld); v.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
        v.uTanHalf.value.set(tx, ty); v.uMaxDist.value = tu.volMaxDist; v.uSigma.value = tu.volSigma; v.uFrame.value = this.frameN % 64;
        const k = sun.intensity * env.vol * tu.volGain;
        v.uSunRad.value.set(sun.color.r * k, sun.color.g * k, sun.color.b * k);
        v.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
        this.pass(this.mVol, Q.volA);
        const b = this.mBlurVol.uniforms;
        b.tSrc.value = Q.volA.texture; b.uDir.value.set(ix, 0); this.pass(this.mBlurVol, Q.volB);
        b.tSrc.value = Q.volB.texture; b.uDir.value.set(0, iy); this.pass(this.mBlurVol, Q.volA);
      }
      const c = this.mComp.uniforms;
      c.tColor.value = this.hdr.texture; c.tDepth.value = this.depthTex; c.uHalfRes.value.set(this.hw, this.hh); c.uNear.value = camera.near; c.uFar.value = camera.far;
      c.uAoOn.value = wantAO ? 1 : 0; c.uVolOn.value = wantVol ? 1 : 0; c.uAoStrength.value = tu.aoStrength; c.uFogD.value = env.fogD || 0;
      this.pass(this.mComp, Q.scene);
      src = Q.scene.texture;
    }
    // 泛光链（最低档平时不跑，只有视线模糊时才借它来糊画面）
    const L = T.bloom > 1 ? Math.min(this.LEVELS, T.bloom) : (this.u.uBlur.value > 0.01 ? 3 : 0);
    if (L > 1) {
      let s = src, sw = this.w, sh = this.h;
      for (let i = 0; i < L; i++) {
        const u = this.mDown.uniforms; u.tSrc.value = s; u.uTexel.value.set(1 / sw, 1 / sh); u.uFirst.value = i === 0 ? 1 : 0;
        this.pass(this.mDown, Q.down[i]); s = Q.down[i].texture; sw = Q.down[i].width; sh = Q.down[i].height;
      }
      let low = Q.down[L - 1];
      for (let i = L - 2; i >= 0; i--) {
        const u = this.mUp.uniforms; u.tLow.value = low.texture; u.tHigh.value = Q.down[i].texture; u.uTexel.value.set(1 / low.width, 1 / low.height);
        this.pass(this.mUp, Q.up[i]); low = Q.up[i];
      }
    }
    // 太阳在屏幕上的位置
    const sd = env.sunDir || this._d.set(0, 1, 0);
    const p = this._v.copy(sd).multiplyScalar(500).add(camera.position).project(camera);
    camera.getWorldDirection(this._d);
    const facing = this._d.dot(sd) > 0.05;
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    const sunOn = (facing ? 1 - Math.min(1, Math.max(0, (edge - 1) / 0.3)) : 0) * (env.sunOn || 0);
    const su = p.x * 0.5 + 0.5, sv = p.y * 0.5 + 0.5;
    // 自动曝光
    {
      const u = this.mAdapt.uniforms, cur = Q.adapt[this.adaptI], nxt = Q.adapt[1 - this.adaptI];
      u.tPrev.value = cur.texture; u.tLum.value = L > 1 ? Q.down[L - 1].texture : src; u.tDepth.value = this.noDepth ? null : this.depthTex; u.uHasDepth.value = this.noDepth ? 0 : 1;
      u.uSunUv.value.set(su, sv); u.uSunOn.value = sunOn; u.uAspect.value = aspect;
      const first = this.frameN < 2, dt = env.dt || 0.016;
      u.uRate.value = first || env.snap ? 1 : 1 - Math.exp(-dt / 1.4); u.uVisRate.value = first ? 1 : 1 - Math.exp(-dt / 0.12);
      this.pass(this.mAdapt, nxt); this.adaptI = 1 - this.adaptI; this.frameN++;
      E.tAdapt.value = Q.adapt[this.adaptI].texture;
    }
    {
      const u = this.mFinal.uniforms;
      u.tScene.value = src;
      u.tBloom.value = L > 1 ? Q.up[0].texture : src;
      u.tBlur.value = L > 2 ? Q.up[Math.min(2, L - 2)].texture : src;
      u.uBloom.value = T.bloom > 1 ? tu.bloom : 0;
      u.uFlare.value = T.flare && !this.noDepth ? tu.flare : 0;
      u.uSunUv.value.set(su, sv); u.uSunOn.value = sunOn; u.uAspect.value = aspect; u.uRes.value.set(this.w, this.h);
      if (env.sunCol) u.uSunCol.value.set(env.sunCol.r, env.sunCol.g, env.sunCol.b);
      u.uCA.value = tu.ca; u.uVignette.value = tu.vignette; u.uLast.value = T.fxaa ? 0 : 1;
      this.pass(this.mFinal, T.fxaa ? Q.ldr : null);
    }
    if (T.fxaa) {
      const u = this.mFxaa.uniforms; u.uTexel.value.set(1 / this.w, 1 / this.h); u.uSharpen.value = tu.sharpen;
      this.pass(this.mFxaa, null);
    }
    // 调试：直接看某个中间缓冲（post.debugView = 'ao' | 'vol' | 'bloom'）
    if (this.debugView) {
      const u = this.mFinal.uniforms, au = E.uAuto.value, ex = E.uExposure.value;
      u.tScene.value = this.debugView === 'ao' ? Q.aoA.texture : this.debugView === 'vol' ? Q.volA.texture : Q.up[0].texture;
      u.uBloom.value = 0; u.uFlare.value = 0; u.uLast.value = 1; E.uAuto.value = 0; E.uExposure.value = this.debugView === 'ao' ? 0.45 : 3;
      this.pass(this.mFinal, null);
      E.uAuto.value = au; E.uExposure.value = ex;
    }
    R.setRenderTarget(null);
  }
}

// ---------------------------------------------------------------- 软阴影（PCSS）
// 替换 three 自带的阴影采样：先找遮挡物的平均深度，再按“遮挡物离得越远，影子边缘越虚”来过滤。
// 树梢投在地上的影子是虚的，脚边的影子是实的。frustum：阴影相机覆盖的宽、高、深（米）。
let stockShadowChunk = null;
export function installSoftShadows(frustum, { taps = 16, searchTaps = 8 } = {}) {
  const src = stockShadowChunk || THREE.ShaderChunk.shadowmap_pars_fragment;
  stockShadowChunk = src;
  const a = src.indexOf('float getShadow('), b = src.indexOf('vec2 cubeToUV');
  if (a < 0 || b < 0 || b < a) { console.warn('[gfx] 阴影着色器结构与预期不符，保留自带的 PCF'); return false; }
  const fn = `
	// AOTAI_PCSS
	const vec2 AT_FRUSTUM = vec2( ${frustum.width.toFixed(3)}, ${frustum.height.toFixed(3)} );
	const float AT_DEPTH = ${frustum.depth.toFixed(3)};
	float atIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
	vec2 atVogel( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float th = float( i ) * 2.39996323 + phi;
		return r * vec2( cos( th ), sin( th ) );
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		shadowCoord.xyz /= shadowCoord.w;
		vec3 sc = shadowCoord.xyz;
		bool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;
		if ( ! ( inFrustum && sc.z <= 1.0 ) ) return 1.0;
		// 接收面的深度梯度：斜面上取样点跟着面走，不会自己遮住自己
		vec3 dx = dFdx( sc ), dy = dFdy( sc );
		float det = dx.x * dy.y - dx.y * dy.x;
		vec2 dz = vec2( 0.0 );
		if ( abs( det ) > 1e-12 ) dz = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
		vec2 texel = 1.0 / shadowMapSize;
		float maxSlope = 0.0030 / max( texel.x, texel.y );
		dz = clamp( dz, vec2( - maxSlope ), vec2( maxSlope ) );
		float zr = sc.z + shadowBias - ( abs( dz.x ) * texel.x + abs( dz.y ) * texel.y ) * 0.35;
		float phi = atIGN( gl_FragCoord.xy ) * 6.2831853;
		vec2 searchR = ( 0.5 * shadowRadius ) / AT_FRUSTUM;
		float blk = 0.0, nb = 0.0;
		for ( int i = 0; i < ${searchTaps}; i ++ ) {
			vec2 o = atVogel( i, ${searchTaps}, phi ) * searchR;
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) );
			float z = zr + dot( o, dz );
			if ( d < z ) { blk += d; nb += 1.0; }
		}
		if ( nb < 0.5 ) return 1.0;
		float avg = blk / nb;
		float distM = max( zr - avg, 0.0 ) * AT_DEPTH;
		float penM = clamp( distM * 0.03 * shadowRadius, 0.03 * shadowRadius, 0.7 * shadowRadius );
		vec2 filtR = max( vec2( penM ) / AT_FRUSTUM, texel * 1.25 );
		float lit = 0.0;
		for ( int i = 0; i < ${taps}; i ++ ) {
			vec2 o = atVogel( i, ${taps}, phi + 1.7 ) * filtR;
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) );
			lit += step( zr + dot( o, dz ), d );
		}
		lit /= float( ${taps} );
		// 阴影图边缘渐渐淡到全亮，看不出阴影范围的方框
		vec2 e = min( sc.xy, 1.0 - sc.xy );
		lit = mix( 1.0, lit, smoothstep( 0.0, 0.04, min( e.x, e.y ) ) );
		return mix( 1.0, lit, shadowIntensity );
	}
	`;
  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + fn + src.slice(b);
  return true;
}
export function uninstallSoftShadows() { if (stockShadowChunk) THREE.ShaderChunk.shadowmap_pars_fragment = stockShadowChunk; }
