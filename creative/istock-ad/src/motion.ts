import { Easing, interpolate, spring } from 'remotion';
import { VIDEO } from './theme';

const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const outExpo = Easing.bezier(0.16, 1, 0.3, 1);
const inOut = Easing.bezier(0.65, 0, 0.35, 1);

export const ease = (frame: number, start: number, end: number, from = 0, to = 1) =>
  interpolate(frame, [start, end], [from, to], { ...clamp, easing: outExpo });

export const glide = (frame: number, start: number, end: number, from: number, to: number) =>
  interpolate(frame, [start, end], [from, to], { ...clamp, easing: inOut });

export const fade = (frame: number, start: number, end: number, tail = 10, head = 8) =>
  Math.min(ease(frame, start, start + head), 1 - ease(frame, end - tail, end));

export const pop = (frame: number, start: number, config: { damping?: number; stiffness?: number; mass?: number } = {}) =>
  spring({
    frame: Math.max(0, frame - start),
    fps: VIDEO.fps,
    config: { damping: 16, stiffness: 170, mass: 0.6, ...config },
  });

export const settle = (frame: number, start: number) =>
  spring({ frame: Math.max(0, frame - start), fps: VIDEO.fps, config: { damping: 24, stiffness: 110, mass: 0.9 } });
