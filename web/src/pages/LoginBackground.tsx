import { useRef, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

/* ============ Theme Definitions ============ */
const THEMES = {
  viridian:{ accent: '#36D9B4', dim: '#24C896', secondary: '#2DD4A8', glow: '54, 217, 180',   hue: 162, sat: 68,  purple: '50, 90, 180' },
  jade:    { accent: '#3DD68C', dim: '#2BA86A', secondary: '#2DD4A8', glow: '61, 214, 140',   hue: 155, sat: 70,  purple: '80, 60, 200' },
  amber:   { accent: '#D4A843', dim: '#B8922E', secondary: '#E8C45A', glow: '212, 168, 67',   hue: 42,  sat: 65,  purple: '180, 120, 60' },
  crimson: { accent: '#E84057', dim: '#C4293E', secondary: '#FF6B6B', glow: '232, 64, 87',    hue: 352, sat: 75,  purple: '160, 50, 180' },
  azure:   { accent: '#4A90D9', dim: '#3672B5', secondary: '#63B3ED', glow: '74, 144, 217',   hue: 212, sat: 60,  purple: '60, 80, 220' },
} as const;

type ThemeName = keyof typeof THEMES;
const VALID_THEMES: ThemeName[] = ['viridian', 'jade', 'amber', 'crimson', 'azure'];
const STORAGE_KEY = 'login-page-config';

const CONNECT_DIST = 160;
const CONNECT_DIST2 = CONNECT_DIST * CONNECT_DIST;
const MOUSE_DIST = 140;
const MOUSE_DIST2 = MOUSE_DIST * MOUSE_DIST;

/* ============ Performance Tier Detection ============ */
type PerfTier = 'full' | 'lite' | 'minimal';
function detectPerfTier(): PerfTier {
  if (typeof navigator === 'undefined') return 'full';
  const isTouchDevice = navigator.maxTouchPoints > 0;
  if (!isTouchDevice) return 'full';
  // iOS: iPadOS 13+ reports as MacIntel but has multi-touch
  const isIOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
    && window.screen.width <= 1366) || /iPad|iPhone|iPod/.test(navigator.userAgent);
  const minDim = Math.min(window.screen.width, window.screen.height);
  if (isIOS) return minDim < 600 ? 'minimal' : 'lite';
  // Android/other touch: use screen size (all touch devices capped at lite)
  if (minDim < 600) return 'minimal';
  return 'lite';
}
const _tier = detectPerfTier();

interface Config { sysName: string; theme: ThemeName; animEnabled?: boolean }

function loadConfig(): Config | null {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

/* ============ Particle ============ */
interface Particle {
  x: number; y: number; s: number;
  vx: number; vy: number; o: number; bo: number;
}

function createParticle(w: number, h: number): Particle {
  const o = Math.random() * 0.5 + 0.2;
  return {
    x: Math.random() * w, y: Math.random() * h,
    s: Math.random() * 2.5 + 0.8,
    vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5,
    o, bo: o,
  };
}

/* ============ CSS ============ */
const PAGE_CSS = `
.lp-root, .lp-root *, .lp-root *::before, .lp-root *::after {
  box-sizing: border-box;
}
.lp-root {
  position: relative; min-height: 100vh;
  font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #080E1E; color: #E8ECF4;
  overflow-x: hidden; overflow-y: auto;
}

/* Animated gradient mesh */
.lp-root .lp-bg-mesh {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 85% 65% at 8% 20%, rgba(var(--lp-glow), 0.20) 0%, transparent 55%),
    radial-gradient(ellipse 80% 70% at 78% 12%, rgba(var(--lp-glow), 0.26) 0%, transparent 55%),
    radial-gradient(ellipse 70% 70% at 50% 48%, rgba(var(--lp-glow), 0.18) 0%, transparent 55%),
    radial-gradient(ellipse 55% 75% at 85% 80%, rgba(var(--lp-purple), 0.10) 0%, transparent 50%),
    radial-gradient(ellipse 80% 55% at 15% 75%, rgba(var(--lp-glow), 0.18) 0%, transparent 55%),
    radial-gradient(ellipse 60% 45% at 55% 92%, rgba(var(--lp-glow), 0.14) 0%, transparent 50%),
    linear-gradient(165deg, #061A14 0%, #0C3222 25%, #092C24 55%, #061A20 100%);
  animation: lp-meshShift 12s ease-in-out infinite alternate; will-change: filter;
}
@keyframes lp-meshShift {
  0%   { filter: hue-rotate(0deg) brightness(1); }
  50%  { filter: hue-rotate(8deg) brightness(1.1); }
  100% { filter: hue-rotate(-5deg) brightness(1.05); }
}

/* Aurora bands */
.lp-root .lp-aurora { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
.lp-root .lp-aurora-band {
  position: absolute; width: 200%; height: 300px; border-radius: 50%;
  filter: blur(80px); opacity: 0;
  animation: lp-auroraPulse 8s ease-in-out infinite; will-change: opacity, transform;
}
.lp-root .lp-ab1 {
  background: linear-gradient(90deg, transparent 0%, rgba(var(--lp-glow), 0.28) 20%, rgba(var(--lp-glow), 0.2) 45%, rgba(var(--lp-purple), 0.15) 70%, transparent 95%);
  top: -5%; left: -30%; transform: rotate(-8deg);
}
.lp-root .lp-ab2 {
  background: linear-gradient(90deg, transparent 10%, rgba(var(--lp-glow), 0.12) 40%, rgba(var(--lp-purple), 0.1) 60%, transparent 90%);
  top: 15%; left: -20%; transform: rotate(-4deg); animation-delay: -3s; height: 200px;
}
.lp-root .lp-ab3 {
  background: linear-gradient(90deg, transparent 0%, rgba(var(--lp-glow), 0.1) 50%, transparent 100%);
  bottom: 5%; left: -10%; transform: rotate(5deg); animation-delay: -5s; height: 250px;
}
@keyframes lp-auroraPulse {
  0%, 100% { opacity: 0.3; transform: translateX(0) rotate(-8deg); }
  30%      { opacity: 0.7; }
  50%      { opacity: 0.5; transform: translateX(5%) rotate(-6deg); }
  80%      { opacity: 0.8; }
}

/* Energy rings */
.lp-root .lp-ring {
  position: fixed; border-radius: 50%;
  border: 1px solid rgba(var(--lp-glow), 0.15);
  pointer-events: none; z-index: 0; will-change: opacity, transform;
}
.lp-root .lp-ring1 { width: 500px; height: 500px; top: -10%; right: -8%; animation: lp-ringRot 30s linear infinite, lp-ringPulse 6s ease-in-out infinite; }
.lp-root .lp-ring2 { width: 350px; height: 350px; bottom: -5%; left: -5%; border-style: dashed; animation: lp-ringRot 25s linear infinite reverse, lp-ringPulse 8s ease-in-out infinite; animation-delay: -2s; }
.lp-root .lp-ring3 { width: 200px; height: 200px; top: 30%; left: 15%; animation: lp-ringRot 20s linear infinite, lp-ringPulse 5s ease-in-out infinite; animation-delay: -4s; }
@keyframes lp-ringRot { to { transform: rotate(360deg); } }
@keyframes lp-ringPulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; border-color: rgba(var(--lp-glow), 0.3); }
}

/* Canvas */
.lp-root .lp-canvas { position: fixed; inset: 0; z-index: 1; pointer-events: none; }

/* Ambient orbs */
.lp-root .lp-orb {
  position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
  animation: lp-orbFloat 16s ease-in-out infinite; will-change: transform;
}
.lp-root .lp-orb1 { width: 480px; height: 480px; top: -12%; left: -6%; background: radial-gradient(circle, rgba(var(--lp-glow), 0.32) 0%, rgba(var(--lp-glow), 0.1) 40%, transparent 70%); filter: blur(50px); }
.lp-root .lp-orb2 { width: 380px; height: 380px; bottom: -8%; right: -8%; background: radial-gradient(circle, rgba(var(--lp-purple), 0.22) 0%, rgba(var(--lp-glow), 0.06) 50%, transparent 70%); filter: blur(42px); animation-delay: -5s; }
.lp-root .lp-orb3 { width: 250px; height: 250px; top: 35%; left: 55%; background: radial-gradient(circle, rgba(var(--lp-glow), 0.18) 0%, transparent 65%); filter: blur(35px); animation-delay: -10s; }
@keyframes lp-orbFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(40px, -50px) scale(1.08); }
  66% { transform: translate(-30px, 30px) scale(0.94); }
}

/* TCM floating symbols */
.lp-root .lp-tcm {
  position: fixed; font-family: 'Noto Serif SC', serif;
  color: var(--lp-accent); font-size: 140px; font-weight: 900;
  user-select: none; pointer-events: none; z-index: 1; opacity: 0.07;
  text-shadow: 0 0 60px rgba(var(--lp-glow), 0.3);
}
.lp-root .lp-tcm1 { top: 3%; left: 6%; animation: lp-sym 25s ease-in-out infinite; }
.lp-root .lp-tcm2 { bottom: 5%; right: 6%; animation: lp-sym 30s ease-in-out infinite reverse; }
.lp-root .lp-tcm3 { top: 45%; left: 68%; font-size: 90px; animation: lp-sym 20s ease-in-out infinite; animation-delay: -7s; }
@keyframes lp-sym {
  0%, 100% { transform: translate(0,0) rotate(0deg); }
  25% { transform: translate(18px,-25px) rotate(4deg); }
  50% { transform: translate(-12px,15px) rotate(-3deg); }
  75% { transform: translate(22px,8px) rotate(2deg); }
}

/* Ink strokes */
.lp-root .lp-ink { position: fixed; z-index: 0; pointer-events: none; opacity: 0.18; }
.lp-root .lp-ink svg { width: 100%; height: 100%; }
.lp-root .lp-ink1 { top: 6%; right: 3%; width: 400px; height: 220px; }
.lp-root .lp-ink2 { bottom: 8%; left: 2%; width: 320px; height: 200px; }

/* Star field */
.lp-root .lp-stars {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image:
    radial-gradient(1.5px 1.5px at 15% 25%, rgba(255,255,255,0.25), transparent),
    radial-gradient(1px 1px at 35% 60%, rgba(255,255,255,0.2), transparent),
    radial-gradient(1.5px 1.5px at 55% 15%, rgba(255,255,255,0.18), transparent),
    radial-gradient(1px 1px at 75% 45%, rgba(255,255,255,0.22), transparent),
    radial-gradient(1.5px 1.5px at 90% 80%, rgba(255,255,255,0.15), transparent),
    radial-gradient(1px 1px at 25% 85%, rgba(255,255,255,0.2), transparent),
    radial-gradient(1.5px 1.5px at 65% 75%, rgba(255,255,255,0.17), transparent),
    radial-gradient(1px 1px at 45% 40%, rgba(255,255,255,0.24), transparent),
    radial-gradient(1px 1px at 80% 20%, rgba(255,255,255,0.19), transparent),
    radial-gradient(1.5px 1.5px at 10% 55%, rgba(255,255,255,0.16), transparent),
    radial-gradient(1px 1px at 50% 90%, rgba(255,255,255,0.21), transparent),
    radial-gradient(1px 1px at 70% 10%, rgba(255,255,255,0.18), transparent);
  animation: lp-twinkle 6s ease-in-out infinite alternate;
}
@keyframes lp-twinkle { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.7; } }

/* Customizer bar */
.lp-root .lp-cbar {
  position: fixed; top: 20px; right: 20px; z-index: 200;
  display: flex; align-items: center; gap: 0;
  background: rgba(10, 18, 40, 0.7);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border-radius: 14px; border: 1px solid rgba(var(--lp-glow), 0.2);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3), 0 0 20px rgba(var(--lp-glow), 0.05);
  overflow: hidden; transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.lp-root .lp-cbtn {
  display: flex; align-items: center; justify-content: center;
  width: 42px; height: 42px; background: none; border: none;
  color: var(--lp-accent); cursor: pointer; flex-shrink: 0;
  transition: all 0.3s; padding: 0;
}
.lp-root .lp-cbtn:hover { color: #E8ECF4; }
.lp-root .lp-cbtn svg { width: 18px; height: 18px; transition: transform 0.3s; }
.lp-root .lp-cbar.expanded .lp-cbtn svg { transform: rotate(90deg); }
.lp-root .lp-cbody {
  display: flex; align-items: center; gap: 12px;
  max-width: 0; max-height: 0; opacity: 0; padding: 0; overflow: hidden;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.lp-root .lp-cbar.expanded .lp-cbody {
  max-width: 500px; max-height: 500px; opacity: 1; padding: 0 16px 0 4px;
}
.lp-root .lp-cbody > label { font-size: 12px; color: #8A94A8; white-space: nowrap; font-weight: 500; }
.lp-root .lp-cinput {
  padding: 6px 12px; background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 8px;
  color: var(--lp-accent); font-size: 13px;
  font-family: 'Noto Serif SC', serif; font-weight: 600;
  width: 180px; outline: none; transition: all 0.3s;
}
.lp-root .lp-cinput:focus { border-color: var(--lp-accent); box-shadow: 0 0 0 2px rgba(var(--lp-glow), 0.15); }
.lp-root .lp-pills { display: flex; gap: 6px; flex-shrink: 0; }
.lp-root .lp-pill {
  width: 24px; height: 24px; border-radius: 50%;
  border: 2.5px solid transparent; cursor: pointer;
  transition: all 0.3s; outline: none;
}
.lp-root .lp-pill:hover { transform: scale(1.2); }
.lp-root .lp-pill.active { border-color: #fff; box-shadow: 0 0 14px rgba(255,255,255,0.3); }
.lp-root .lp-pill-viridian { background: linear-gradient(135deg, #36D9B4, #24C896); }
.lp-root .lp-pill-jade    { background: linear-gradient(135deg, #3DD68C, #2DD4A8); }
.lp-root .lp-pill-amber   { background: linear-gradient(135deg, #D4A843, #E8C45A); }
.lp-root .lp-pill-crimson  { background: linear-gradient(135deg, #E84057, #FF6B6B); }
.lp-root .lp-pill-azure   { background: linear-gradient(135deg, #4A90D9, #63B3ED); }

.lp-root .lp-toast {
  position: fixed; top: 70px; right: 20px; z-index: 201;
  background: rgba(10, 18, 40, 0.85);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--lp-glow), 0.25); border-radius: 10px;
  padding: 8px 16px; font-size: 12px; color: var(--lp-accent);
  pointer-events: none; opacity: 0; transform: translateY(-8px);
  transition: all 0.3s ease;
}
.lp-root .lp-toast.show { opacity: 1; transform: translateY(0); }

/* Main layout */
.lp-root .lp-wrapper {
  position: relative; z-index: 10;
  display: flex; justify-content: center; align-items: center;
  min-height: 100vh; padding: 20px;
}
.lp-root .lp-container {
  display: flex; width: 920px; max-width: 100%;
  border-radius: 28px;
  background:
    radial-gradient(ellipse 90% 70% at 10% 15%, rgba(var(--lp-glow), 0.22) 0%, transparent 60%),
    radial-gradient(ellipse 90% 70% at 90% 10%, rgba(var(--lp-glow), 0.18) 0%, transparent 55%),
    radial-gradient(ellipse 80% 80% at 50% 50%, rgba(var(--lp-glow), 0.14) 0%, transparent 60%),
    radial-gradient(ellipse 70% 60% at 80% 70%, rgba(var(--lp-glow), 0.10) 0%, transparent 55%),
    linear-gradient(160deg, rgba(var(--lp-glow), 0.12) 0%, rgba(var(--lp-glow), 0.06) 50%, rgba(var(--lp-glow), 0.10) 100%),
    linear-gradient(160deg, #0A1E1A 0%, #081A16 50%, #0A1E1A 100%);
  border: 1px solid rgba(var(--lp-glow), 0.18);
  box-shadow:
    0 0 100px rgba(var(--lp-glow), 0.08),
    0 40px 80px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    inset 0 -1px 0 rgba(var(--lp-glow), 0.05);
}

/* Brand panel (left) */
.lp-root .lp-brand {
  flex: 1; padding: 48px 40px;
  display: flex; flex-direction: column; justify-content: center;
  position: relative; overflow: hidden;
  background: linear-gradient(160deg, rgba(var(--lp-glow), 0.1) 0%, rgba(var(--lp-glow), 0.02) 40%, transparent 70%);
}
.lp-root .lp-brand::before {
  content: ''; position: absolute; right: 0; top: 8%; bottom: 8%; width: 1px;
  background: linear-gradient(to bottom, transparent, rgba(var(--lp-glow), 0.2), transparent);
}
.lp-root .lp-brand::after {
  content: ''; position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(var(--lp-glow), 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--lp-glow), 0.03) 1px, transparent 1px);
  background-size: 40px 40px; pointer-events: none;
}
.lp-root .lp-bicon {
  width: 72px; height: 72px; border-radius: 20px;
  background: linear-gradient(135deg, var(--lp-accent), var(--lp-secondary));
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 28px;
  box-shadow: 0 8px 32px rgba(var(--lp-glow), 0.4);
  position: relative;
}
.lp-root .lp-bicon::after {
  content: ''; position: absolute; inset: -5px; border-radius: 25px;
  border: 1.5px solid rgba(var(--lp-glow), 0.35);
  animation: lp-iconPulse 3s ease-in-out infinite;
}
@keyframes lp-iconPulse { 0%, 100% { transform: scale(1); opacity: 0.6; } 50% { transform: scale(1.1); opacity: 0; } }
.lp-root .lp-bicon svg { width: 36px; height: 36px; fill: white; }
.lp-root .lp-btitle-area { position: relative; z-index: 1; }
.lp-root .lp-blabel {
  font-family: 'Noto Serif SC', serif; font-size: 13px; font-weight: 600;
  letter-spacing: 6px; color: var(--lp-accent); margin-bottom: 12px;
}
.lp-root .lp-btitle {
  font-family: 'Noto Serif SC', serif; font-size: 32px; font-weight: 900;
  line-height: 1.3; margin-bottom: 16px;
  background: linear-gradient(135deg, #fff 0%, var(--lp-accent) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.lp-root .lp-bdesc { font-size: 14px; line-height: 1.8; color: #8A94A8; max-width: 300px; }
.lp-root .lp-bfeats { margin-top: 36px; display: flex; flex-direction: column; gap: 14px; position: relative; z-index: 1; }
.lp-root .lp-feat { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #8A94A8; }
.lp-root .lp-fdot { width: 7px; height: 7px; border-radius: 50%; background: var(--lp-accent); box-shadow: 0 0 10px rgba(var(--lp-glow), 0.6); flex-shrink: 0; }

/* Form panel (right) */
.lp-root .lp-form-panel { width: 400px; padding: 48px 40px; display: flex; flex-direction: column; justify-content: center; }
.lp-root .lp-fheader { margin-bottom: 36px; }
.lp-root .lp-fheader h2 { font-family: 'Noto Serif SC', serif; font-size: 24px; font-weight: 700; margin-bottom: 8px; color: #E8ECF4; }
.lp-root .lp-fheader p { font-size: 13px; color: #8A94A8; }

/* Form elements */
.lp-root .lp-fg { margin-bottom: 22px; }
.lp-root .lp-fl { display: block; font-size: 12px; font-weight: 500; color: #8A94A8; margin-bottom: 8px; letter-spacing: 1px; text-transform: uppercase; }
.lp-root .lp-iw { position: relative; }
.lp-root .lp-ii {
  position: absolute; left: 16px; top: 50%; transform: translateY(-50%);
  width: 18px; height: 18px; color: #8A94A8;
  transition: color 0.3s; pointer-events: none; z-index: 2;
}
.lp-root .lp-fi {
  width: 100%; padding: 14px 16px 14px 46px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px; color: #E8ECF4;
  font-size: 14px; font-family: inherit;
  transition: all 0.3s ease; outline: none;
  position: relative; z-index: 1;
}
.lp-root .lp-fi::placeholder { color: rgba(138, 148, 168, 0.6); }
.lp-root .lp-fi:hover { border-color: rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.07); }
.lp-root .lp-fi:focus {
  border-color: var(--lp-accent);
  background: rgba(var(--lp-glow), 0.06);
  box-shadow: 0 0 0 3px rgba(var(--lp-glow), 0.12), 0 0 24px rgba(var(--lp-glow), 0.08);
}
.lp-root .lp-fi:focus ~ .lp-ii { color: var(--lp-accent); }

/* Checkbox */
.lp-root .lp-fopts { display: flex; justify-content: space-between; align-items: center; margin-bottom: 28px; }
.lp-root .lp-chk { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: #8A94A8; user-select: none; }
.lp-root .lp-chk input[type="checkbox"] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.lp-root .lp-chkbox {
  width: 18px; height: 18px; border: 1.5px solid rgba(255,255,255,0.18);
  border-radius: 5px; display: flex; align-items: center; justify-content: center;
  transition: all 0.3s; flex-shrink: 0;
}
.lp-root .lp-chkbox svg { width: 12px; height: 12px; opacity: 0; transform: scale(0.5); transition: all 0.2s; }
.lp-root .lp-chk input:checked + .lp-chkbox {
  background: var(--lp-accent); border-color: var(--lp-accent);
  box-shadow: 0 0 10px rgba(var(--lp-glow), 0.3);
}
.lp-root .lp-chk input:checked + .lp-chkbox svg { opacity: 1; transform: scale(1); }

/* Submit button */
.lp-root .lp-btn {
  width: 100%; padding: 15px; border: none; border-radius: 12px;
  font-size: 15px; font-weight: 600; font-family: inherit;
  cursor: pointer; position: relative; overflow: hidden;
  color: #0A0F1A;
  background: linear-gradient(135deg, var(--lp-accent), var(--lp-secondary));
  box-shadow: 0 4px 28px rgba(var(--lp-glow), 0.4);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.lp-root .lp-btn::before {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(135deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
  transform: translateX(-100%); transition: transform 0.6s ease;
}
.lp-root .lp-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 50px rgba(var(--lp-glow), 0.5), 0 0 80px rgba(var(--lp-glow), 0.15); }
.lp-root .lp-btn:hover::before { transform: translateX(100%); }
.lp-root .lp-btn:active { transform: translateY(0); }
.lp-root .lp-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
@keyframes lp-shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
.lp-root .lp-btn.loading {
  background: linear-gradient(90deg, var(--lp-dim), var(--lp-accent), var(--lp-dim)) !important;
  background-size: 200% 100% !important;
  animation: lp-shimmer 1.5s infinite !important;
  pointer-events: none;
}

/* Footer */
.lp-root .lp-ffooter { text-align: center; margin-top: 28px; font-size: 13px; color: #8A94A8; }
.lp-root .lp-ffooter a { color: var(--lp-accent); text-decoration: none; font-weight: 500; cursor: pointer; transition: opacity 0.2s; }
.lp-root .lp-ffooter a:hover { opacity: 0.7; }

/* Password toggle */
.lp-root .lp-ptoggle {
  position: absolute; right: 14px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: #8A94A8;
  cursor: pointer; padding: 4px; transition: color 0.2s;
  display: flex; align-items: center; z-index: 2;
}
.lp-root .lp-ptoggle:hover { color: var(--lp-accent); }
.lp-root .lp-ptoggle svg { width: 18px; height: 18px; }

/* Page footer */
.lp-root .lp-pfooter { text-align: center; padding: 24px 0 20px; position: relative; z-index: 10; pointer-events: none; }
.lp-root .lp-pfooter .lp-ver { font-size: 11px; color: rgba(138, 148, 168, 0.4); letter-spacing: 2px; margin-bottom: 4px; }
.lp-root .lp-pfooter .lp-cr { font-size: 10px; color: rgba(138, 148, 168, 0.3); letter-spacing: 1px; }

/* Animation toggle (desktop only) */
.lp-root .lp-atoggle {
  position: fixed; bottom: 20px; left: 20px; z-index: 300;
  display: flex; align-items: center; gap: 8px;
  background: rgba(10, 18, 40, 0.7);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(var(--lp-glow), 0.2);
  border-radius: 10px; padding: 8px 14px;
  cursor: pointer; user-select: none;
  font-size: 11px; color: #8A94A8; transition: all 0.3s;
}
.lp-root .lp-atoggle:hover { border-color: rgba(var(--lp-glow), 0.4); color: #E8ECF4; }

/* Register form tighter spacing */
.lp-root .lp-regform .lp-fg { margin-bottom: 14px; }
.lp-root .lp-regform .lp-fl { margin-bottom: 5px; }
.lp-root .lp-regform .lp-fi { padding-top: 10px; padding-bottom: 10px; }

/* Form error */
.lp-root .lp-ferr { color: #E84057; font-size: 12px; margin-top: 4px; }

/* ---- Lite tier: reduced effects for tablets ---- */
.lp-root.lp-lite .lp-bg-mesh {
  animation: none; will-change: auto; filter: none;
}
.lp-root.lp-lite .lp-aurora-band { filter: blur(25px); will-change: auto; }
.lp-root.lp-lite .lp-orb { filter: none; will-change: auto; }
.lp-root.lp-lite .lp-ring { will-change: auto; }
.lp-root.lp-lite .lp-cbar,
.lp-root.lp-lite .lp-atoggle,
.lp-root.lp-lite .lp-toast {
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}

/* ---- Minimal tier: no blur, baked gradient background ---- */
.lp-root.lp-minimal .lp-bg-mesh {
  animation: none; will-change: auto; filter: none;
  background:
    radial-gradient(ellipse 85% 65% at 8% 20%, rgba(var(--lp-glow), 0.28) 0%, transparent 55%),
    radial-gradient(ellipse 80% 70% at 78% 12%, rgba(var(--lp-glow), 0.38) 0%, transparent 55%),
    radial-gradient(ellipse 70% 70% at 50% 48%, rgba(var(--lp-glow), 0.30) 0%, transparent 55%),
    radial-gradient(ellipse 65% 75% at 85% 80%, rgba(var(--lp-purple), 0.12) 0%, transparent 50%),
    radial-gradient(ellipse 80% 55% at 15% 75%, rgba(var(--lp-glow), 0.22) 0%, transparent 55%),
    radial-gradient(ellipse 60% 45% at 55% 92%, rgba(var(--lp-glow), 0.16) 0%, transparent 50%),
    radial-gradient(ellipse 55% 50% at 5% 8%, rgba(var(--lp-glow), 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 45% 55% at 92% 88%, rgba(var(--lp-purple), 0.12) 0%, transparent 55%),
    linear-gradient(165deg, #061A14 0%, #0C3020 25%, #082820 55%, #061A20 100%);
}
.lp-root.lp-minimal .lp-cbar,
.lp-root.lp-minimal .lp-atoggle,
.lp-root.lp-minimal .lp-toast {
  backdrop-filter: none; -webkit-backdrop-filter: none;
  background: rgba(10, 18, 40, 0.9);
}

/* ---- Perf mode: animations completely off, baked orb gradient matches blur visual ---- */
.lp-root.lp-perf .lp-bg-mesh {
  animation: none; will-change: auto; filter: none;
  background:
    radial-gradient(ellipse 85% 65% at 8% 20%, rgba(var(--lp-glow), 0.28) 0%, transparent 55%),
    radial-gradient(ellipse 80% 70% at 78% 12%, rgba(var(--lp-glow), 0.24) 0%, transparent 55%),
    radial-gradient(ellipse 70% 70% at 50% 48%, rgba(var(--lp-glow), 0.28) 0%, transparent 55%),
    radial-gradient(ellipse 65% 75% at 85% 80%, rgba(var(--lp-purple), 0.16) 0%, transparent 50%),
    radial-gradient(ellipse 80% 55% at 15% 75%, rgba(var(--lp-glow), 0.22) 0%, transparent 55%),
    radial-gradient(ellipse 60% 45% at 55% 92%, rgba(var(--lp-glow), 0.16) 0%, transparent 50%),
    radial-gradient(ellipse 55% 50% at 5% 8%, rgba(var(--lp-glow), 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 45% 55% at 92% 88%, rgba(var(--lp-purple), 0.12) 0%, transparent 55%),
    linear-gradient(165deg, #061A14 0%, #0E3A26 25%, #0A3028 55%, #061A20 100%);
}
.lp-root .lp-form-panel {
  background: linear-gradient(170deg,
    rgba(var(--lp-glow), 0.18) 0%,
    rgba(var(--lp-glow), 0.10) 35%,
    rgba(var(--lp-glow), 0.14) 70%,
    rgba(var(--lp-glow), 0.12) 100%);
}
.lp-root.lp-perf .lp-cbar,
.lp-root.lp-perf .lp-atoggle,
.lp-root.lp-perf .lp-toast {
  backdrop-filter: none; -webkit-backdrop-filter: none;
  background: rgba(10, 18, 40, 0.9);
}

/* Mobile brand header (hidden on desktop) */
.lp-root .lp-mb { display: none; }
.lp-root .lp-mb-divider {
  display: none;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(var(--lp-glow), 0.25), transparent);
}

/* Responsive */
@media (max-width: 800px) {
  .lp-root .lp-brand { display: none; }
  .lp-root .lp-container {
    width: 100%; max-width: 420px; border-radius: 20px;
    flex-direction: column;
  }
  .lp-root .lp-mb {
    display: flex; padding: 28px 22px 0; gap: 16px; align-items: center;
    background: linear-gradient(180deg, rgba(var(--lp-glow), 0.08) 0%, transparent 100%);
  }
  .lp-root .lp-mb-icon {
    width: 52px; height: 52px; border-radius: 14px; flex-shrink: 0;
    background: linear-gradient(135deg, var(--lp-accent), var(--lp-secondary));
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 6px 24px rgba(var(--lp-glow), 0.35);
    position: relative;
  }
  .lp-root .lp-mb-icon::after {
    content: ''; position: absolute; inset: -4px; border-radius: 18px;
    border: 1.5px solid rgba(var(--lp-glow), 0.3);
    animation: lp-iconPulse 3s ease-in-out infinite;
  }
  .lp-root .lp-mb-icon svg { width: 26px; height: 26px; fill: white; }
  .lp-root .lp-mb-text { flex: 1; min-width: 0; }
  .lp-root .lp-mb-label {
    font-family: 'Noto Serif SC', serif; font-size: 10px; font-weight: 600;
    letter-spacing: 4px; color: var(--lp-accent); margin-bottom: 4px; opacity: 0.8;
  }
  .lp-root .lp-mb-title {
    font-family: 'Noto Serif SC', serif; font-size: 22px; font-weight: 900;
    line-height: 1.2;
    background: linear-gradient(135deg, #fff 0%, var(--lp-accent) 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
  }
  .lp-root .lp-mb-tagline { font-size: 11px; color: rgba(var(--lp-glow), 0.55); margin-top: 4px; line-height: 1.4; }
  .lp-root .lp-mb-divider { display: block; margin: 16px 22px 0; }
  .lp-root .lp-form-panel { width: 100%; padding: 20px 22px 28px; }
  .lp-root .lp-fheader { margin-bottom: 20px; }
  .lp-root .lp-fheader h2 { font-size: 18px; }
  .lp-root .lp-fheader p { font-size: 12px; }
  .lp-root .lp-regform .lp-fg { margin-bottom: 10px; }
  .lp-root .lp-regform .lp-fl { margin-bottom: 4px; font-size: 11px; }
  .lp-root .lp-regform .lp-fi { padding-top: 9px; padding-bottom: 9px; font-size: 13px; }
  .lp-root .lp-btn { padding: 13px; font-size: 14px; }
  .lp-root .lp-ffooter { margin-top: 18px; }
  .lp-root .lp-cbar { top: 12px; right: 12px; }
  .lp-root .lp-cbody { flex-direction: column; align-items: flex-start; gap: 8px; }
  .lp-root .lp-cbar.expanded .lp-cbody { max-width: 220px; max-height: 300px; padding: 8px 12px 12px 4px; }
  .lp-root .lp-cinput { width: 160px; font-size: 12px; }
  .lp-root .lp-wrapper { min-height: auto; padding: 48px 16px 20px; }
  .lp-root .lp-atoggle { bottom: 12px; left: 12px; }
}
@media (max-width: 380px) {
  .lp-root .lp-mb { padding: 22px 16px 0; gap: 12px; }
  .lp-root .lp-mb-icon { width: 44px; height: 44px; border-radius: 12px; }
  .lp-root .lp-mb-icon svg { width: 22px; height: 22px; }
  .lp-root .lp-mb-title { font-size: 19px; }
  .lp-root .lp-mb-divider { margin: 12px 16px 0; }
  .lp-root .lp-form-panel { padding: 16px 16px 24px; }
  .lp-root .lp-regform .lp-fg { margin-bottom: 8px; }
  .lp-root .lp-regform .lp-fi { padding-top: 8px; padding-bottom: 8px; padding-left: 38px; }
  .lp-root .lp-regform .lp-ii { left: 12px; width: 16px; height: 16px; }
  .lp-root .lp-fheader h2 { font-size: 17px; }
  .lp-root .lp-fheader { margin-bottom: 16px; }
  .lp-root .lp-btn { padding: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .lp-root *, .lp-root *::before, .lp-root *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .lp-root .lp-aurora, .lp-root .lp-ring, .lp-root .lp-stars { display: none; }
  .lp-root .lp-canvas { display: none; }
}
`;

/* ============ Component ============ */
interface Props { children: ReactNode }

export default function LoginBackground({ children }: Props) {
  const saved = useRef(loadConfig());
  const [theme, setTheme] = useState<ThemeName>(
    saved.current?.theme && VALID_THEMES.includes(saved.current.theme) ? saved.current.theme : 'viridian'
  );
  const [sysName, setSysName] = useState(saved.current?.sysName || '惊蛰');
  const [expanded, setExpanded] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [animEnabled, setAnimEnabled] = useState(() => {
    if (saved.current?.animEnabled !== undefined) return saved.current.animEnabled;
    return false; // All platforms default OFF — static gradient matches blur visual
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);
  const themeRef = useRef(theme);
  const animRef = useRef(animEnabled);
  const startRef = useRef<() => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toggleRafRef = useRef(0);

  const t = THEMES[theme];

  // Sync theme ref
  useEffect(() => { themeRef.current = theme; }, [theme]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearTimeout(collapseTimerRef.current);
      clearTimeout(toastTimerRef.current);
      if (toggleRafRef.current) {
        cancelAnimationFrame(toggleRafRef.current);
        toggleRafRef.current = 0;
      }
    };
  }, []);

  // Inject page CSS once (avoid re-parse on every render)
  useEffect(() => {
    const id = 'lp-page-css';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = PAGE_CSS;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById(id);
      if (el) el.parentNode?.removeChild(el);
    };
  }, []);

  // Load Google Fonts (global resource, don't remove on unmount)
  useEffect(() => {
    if (document.querySelector('link[data-font="lp"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.font = 'lp';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700;900&family=Noto+Sans+SC:wght@300;400;500;600&display=swap';
    document.head.appendChild(link);
  }, []);

  // Particle system — tier-aware
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (_tier === 'minimal') return; // No canvas on phones
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const count = _tier === 'lite' ? 20 : (window.innerWidth <= 800 ? 40 : 100);
    const drawConnections = _tier === 'full'; // Skip O(n²) on tablets

    function resize() {
      const oldW = canvas!.width;
      const oldH = canvas!.height;
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      // Clamp existing particles to new bounds
      if (particlesRef.current.length > 0 && oldW > 1 && oldH > 1) {
        const scaleX = canvas!.width / oldW;
        const scaleY = canvas!.height / oldH;
        for (const p of particlesRef.current) {
          p.x *= scaleX;
          p.y *= scaleY;
        }
      }
    }
    resize();

    particlesRef.current = Array.from({ length: count }, () =>
      createParticle(canvas!.width, canvas!.height)
    );

    function frame() {
      const w = canvas!.width, h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      const tm = THEMES[themeRef.current];
      const ps = particlesRef.current;
      const mx = mouseRef.current.x, my = mouseRef.current.y;
      const n = ps.length;

      for (let i = 0; i < n; i++) {
        const p = ps[i];
        p.x += p.vx; p.y += p.vy;
        const dx = p.x - mx, dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < MOUSE_DIST2) {
          const f = (1 - Math.sqrt(d2) / MOUSE_DIST) * 0.02;
          p.x += dx * f; p.y += dy * f;
          p.o = Math.min(p.bo + 0.35, 0.9);
        } else {
          p.o += (p.bo - p.o) * 0.04;
        }
        if (p.x < -20 || p.x > w + 20 || p.y < -20 || p.y > h + 20) {
          p.x = Math.random() * w; p.y = Math.random() * h;
        }
      }

      // Draw connections (only on full tier — O(n²) is too expensive for tablets)
      if (drawConnections) {
        for (let i = 0; i < n; i++) {
          const pi = ps[i];
          for (let j = i + 1; j < n; j++) {
            const pj = ps[j];
            const dx = pi.x - pj.x, dy = pi.y - pj.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < CONNECT_DIST2) {
              ctx!.beginPath();
              ctx!.moveTo(pi.x, pi.y);
              ctx!.lineTo(pj.x, pj.y);
              ctx!.strokeStyle = `rgba(${tm.glow},${(1 - Math.sqrt(d2) / CONNECT_DIST) * 0.18})`;
              ctx!.lineWidth = 0.6;
              ctx!.stroke();
            }
          }
        }
      }
      // Draw particles
      for (let i = 0; i < n; i++) {
        const pi = ps[i];
        ctx!.beginPath();
        ctx!.arc(pi.x, pi.y, pi.s, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${tm.hue},${tm.sat}%,65%,${pi.o})`;
        ctx!.fill();
      }

      rafRef.current = requestAnimationFrame(frame);
    }

    function start() { if (!rafRef.current) rafRef.current = requestAnimationFrame(frame); }
    function stop() { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } }

    // Expose start/stop for toggleAnim
    startRef.current = start;
    stopRef.current = stop;

    function onMouse(e: MouseEvent) { mouseRef.current.x = e.clientX; mouseRef.current.y = e.clientY; }
    function onVis() {
      if (document.hidden) stop();
      else if (animRef.current) start();
    }

    window.addEventListener('resize', resize);
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('visibilitychange', onVis);

    if (animRef.current) start();

    return () => {
      stop();
      startRef.current = () => {};
      stopRef.current = () => {};
      window.removeEventListener('resize', resize);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Persist partial config to localStorage (merge with existing)
  const persistConfig = useCallback((partial: Partial<Config>) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing = raw ? JSON.parse(raw) : {};
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...partial }));
    } catch {}
  }, []);

  // Animation toggle — uses refs exposed by particle useEffect, persists to localStorage
  const toggleAnim = useCallback(() => {
    setAnimEnabled(prev => {
      const next = !prev;
      animRef.current = next;
      if (next) {
        // Delay start until after React commits display:none removal
        toggleRafRef.current = requestAnimationFrame(() => {
          toggleRafRef.current = 0;
          startRef.current();
        });
      } else {
        if (toggleRafRef.current) {
          cancelAnimationFrame(toggleRafRef.current);
          toggleRafRef.current = 0;
        }
        stopRef.current();
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      persistConfig({ animEnabled: next });
      return next;
    });
  }, [persistConfig]);

  // Save config (name/theme)
  const doSave = useCallback((name: string, th: ThemeName) => {
    persistConfig({ sysName: name, theme: th });
    setShowToast(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowToast(false), 1500);
  }, [persistConfig]);

  // Theme switch
  const pickTheme = useCallback((name: ThemeName) => {
    if (name === theme) return;
    setTheme(name);
    doSave(sysName, name);
    setExpanded(false);
  }, [theme, sysName, doSave]);

  // System name change
  const handleNameBlur = useCallback(() => {
    doSave(sysName, theme);
    clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = setTimeout(() => setExpanded(false), 800);
  }, [sysName, theme, doSave]);

  // CSS variables
  const cssVars = {
    '--lp-accent': t.accent,
    '--lp-dim': t.dim,
    '--lp-secondary': t.secondary,
    '--lp-glow': t.glow,
    '--lp-purple': t.purple,
  } as React.CSSProperties;

  const animOff = !animEnabled;

  // Build root class: lp-perf (off) > lp-lite/lp-minimal (tier)
  let rootCls = 'lp-root';
  if (animOff) rootCls += ' lp-perf';
  else if (_tier === 'lite') rootCls += ' lp-lite';
  else if (_tier === 'minimal') rootCls += ' lp-minimal';

  return (
    <div className={rootCls} style={cssVars}>

      {/* Gradient mesh — always rendered, CSS controls animation per tier */}
      <div className="lp-bg-mesh" />

      {/* Stars — cheap static background, shown on all tiers when animating */}
      {!animOff && <div className="lp-stars" />}

      {/* Aurora — full: 3 bands, lite: 1 band, minimal/off: none */}
      {!animOff && _tier !== 'minimal' && (
        <div className="lp-aurora">
          <div className="lp-aurora-band lp-ab1" />
          {_tier === 'full' && <div className="lp-aurora-band lp-ab2" />}
          {_tier === 'full' && <div className="lp-aurora-band lp-ab3" />}
        </div>
      )}

      {/* Rings — full: 3, lite: 1, minimal/off: none */}
      {!animOff && _tier !== 'minimal' && (
        <>
          <div className="lp-ring lp-ring1" />
          {_tier === 'full' && <div className="lp-ring lp-ring2" />}
          {_tier === 'full' && <div className="lp-ring lp-ring3" />}
        </>
      )}

      {/* Orbs — full: 3 (with blur), lite: 1 (no blur via CSS), minimal/off: none */}
      {!animOff && _tier !== 'minimal' && (
        <>
          <div className="lp-orb lp-orb1" />
          {_tier === 'full' && <div className="lp-orb lp-orb2" />}
          {_tier === 'full' && <div className="lp-orb lp-orb3" />}
        </>
      )}

      {/* TCM symbols — full: 3, lite: 2, minimal: 1, off: none */}
      {!animOff && (
        <>
          <div className="lp-tcm lp-tcm1">医</div>
          {_tier !== 'minimal' && <div className="lp-tcm lp-tcm2">药</div>}
          {_tier === 'full' && <div className="lp-tcm lp-tcm3">脉</div>}
        </>
      )}

      {/* Ink strokes — full: 2, lite: 1, minimal/off: none */}
      {!animOff && _tier !== 'minimal' && (
        <>
          <div className="lp-ink lp-ink1">
            <svg viewBox="0 0 400 220" fill="none">
              <path d="M20 110 Q90 20, 200 80 T380 55" stroke={t.accent} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5" />
              <path d="M50 160 Q130 60, 240 130 T400 105" stroke={t.dim} strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.35" />
            </svg>
          </div>
          {_tier === 'full' && (
            <div className="lp-ink lp-ink2">
              <svg viewBox="0 0 320 200" fill="none">
                <path d="M10 90 Q70 170, 160 100 T300 140" stroke={t.accent} strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.5" />
              </svg>
            </div>
          )}
        </>
      )}

      {/* Canvas — hidden when off or minimal tier */}
      <canvas ref={canvasRef} className="lp-canvas" style={(animOff || _tier === 'minimal') ? { display: 'none' } : undefined} />

      {/* Customizer */}
      <div className={`lp-cbar${expanded ? ' expanded' : ''}`}>
        <button className="lp-cbtn" title="自定义设置" onClick={() => {
          setExpanded(v => !v);
          clearTimeout(collapseTimerRef.current);
        }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <div className="lp-cbody">
          <label htmlFor="lp-sysname">名称</label>
          <input
            id="lp-sysname"
            type="text"
            className="lp-cinput"
            value={sysName}
            maxLength={20}
            onChange={e => { setSysName(e.target.value); clearTimeout(collapseTimerRef.current); }}
            onBlur={handleNameBlur}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }}}
          />
          <label>主题</label>
          <div className="lp-pills">
            {VALID_THEMES.map(name => (
              <div
                key={name}
                className={`lp-pill lp-pill-${name}${theme === name ? ' active' : ''}`}
                title={{ viridian: '碧波', jade: '翡翠', amber: '琥珀', crimson: '朱砂', azure: '青瓷' }[name]}
                tabIndex={0}
                role="radio"
                aria-checked={theme === name}
                aria-label={{ viridian: '碧波', jade: '翡翠', amber: '琥珀', crimson: '朱砂', azure: '青瓷' }[name]}
                onClick={() => pickTheme(name)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTheme(name); }}}
              />
            ))}
          </div>
        </div>
      </div>
      <div className={`lp-toast${showToast ? ' show' : ''}`}>已保存到本地</div>

      {/* Animation toggle */}
      <div
        className="lp-atoggle"
        role="button"
        tabIndex={0}
        aria-pressed={animEnabled}
        aria-label="切换动画"
        onClick={toggleAnim}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAnim(); }}}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: animEnabled ? t.accent : '#555',
          boxShadow: animEnabled ? `0 0 8px rgba(${t.glow}, 0.5)` : 'none',
          transition: 'all 0.3s',
        }} />
        <span>{animEnabled ? '动画: 开' : '动画: 关'}</span>
      </div>

      {/* Main card */}
      <div className="lp-wrapper">
        <div className="lp-container">
          {/* Brand panel (left) */}
          <div className="lp-brand">
            <div className="lp-bicon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            <div className="lp-btitle-area">
              <div className="lp-blabel">中医智慧 · 数字赋能</div>
              <h1 className="lp-btitle">{sysName || '惊蛰'}</h1>
              <p className="lp-bdesc">融汇传统医学智慧与现代数字技术，为临床诊疗提供全方位智能化支持。</p>
            </div>
            <div className="lp-bfeats">
              <div className="lp-feat"><span className="lp-fdot" />患者病历全生命周期管理</div>
              <div className="lp-feat"><span className="lp-fdot" />中药方剂智能辅助开方</div>
              <div className="lp-feat"><span className="lp-fdot" />五运六气 · 经络穴位查询</div>
              <div className="lp-feat"><span className="lp-fdot" />多维度统计分析与报表</div>
            </div>
          </div>

          {/* Mobile brand header (shown only on mobile via CSS) */}
          <div className="lp-mb">
            <div className="lp-mb-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
              </svg>
            </div>
            <div className="lp-mb-text">
              <div className="lp-mb-label">中医智慧 · 数字赋能</div>
              <div className="lp-mb-title">{sysName || '惊蛰'}</div>
              <div className="lp-mb-tagline">传统医学与数字技术的融合</div>
            </div>
          </div>
          <div className="lp-mb-divider" />

          {/* Form panel (right on desktop, below on mobile) */}
          <div className="lp-form-panel">
            {children}
          </div>
        </div>
      </div>

      {/* Page footer */}
      <div className="lp-pfooter">
        <div className="lp-ver">V 2.0 · DESIGNED WITH CARE</div>
        <div className="lp-cr">&copy; 2024-2026 空无 All Rights Reserved</div>
      </div>
    </div>
  );
}
