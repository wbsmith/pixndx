/**
 * Color Analysis Library
 * 
 * Provides color space conversions, analysis, and utilities for
 * working with image color palettes.
 */

// ============================================================================
// COLOR TYPES
// ============================================================================

export interface RGB {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

export interface HSV {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

export interface LAB {
  l: number; // 0-100
  a: number; // -128 to 127
  b: number; // -128 to 127
}

export interface LCH {
  l: number; // 0-100
  c: number; // 0-~150
  h: number; // 0-360
}

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

export type ColorFamily = 
  | 'red' 
  | 'orange' 
  | 'yellow' 
  | 'green' 
  | 'cyan' 
  | 'blue' 
  | 'purple' 
  | 'magenta' 
  | 'neutral';

export interface ColorAnalysis {
  hex: string;
  rgb: RGB;
  hsl: HSL;
  lab: LAB;
  family: ColorFamily;
  isWarm: boolean;
  isCool: boolean;
  isNeutral: boolean;
  luminance: number;
  saturationLevel: 'low' | 'medium' | 'high';
  lightnessLevel: 'dark' | 'medium' | 'light';
}

// ============================================================================
// COLOR SPACE CONVERSIONS
// ============================================================================

/**
 * Parse hex color to RGB
 */
export function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 128, g: 128, b: 128 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Convert RGB to HSL
 */
export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    case b:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return { h: h * 360, s, l };
}

/**
 * Convert HSL to RGB
 */
export function hslToRgb(hsl: HSL): RGB {
  const { h, s, l } = hsl;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  return {
    r: Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hNorm) * 255),
    b: Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255),
  };
}

/**
 * Convert RGB to HSV
 */
export function rgbToHsv(rgb: RGB): HSV {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s, v };
}

/**
 * Convert RGB to XYZ (CIE 1931)
 */
export function rgbToXyz(rgb: RGB): XYZ {
  // Linearize sRGB
  const linearize = (c: number) => {
    c = c / 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  };

  const r = linearize(rgb.r);
  const g = linearize(rgb.g);
  const b = linearize(rgb.b);

  // sRGB to XYZ matrix (D65 illuminant)
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
    z: r * 0.0193339 + g * 0.1191920 + b * 0.9503041,
  };
}

/**
 * Convert XYZ to LAB (CIE L*a*b*)
 */
export function xyzToLab(xyz: XYZ): LAB {
  // D65 reference white
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;

  const f = (t: number) => {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  };

  const x = f(xyz.x / refX);
  const y = f(xyz.y / refY);
  const z = f(xyz.z / refZ);

  return {
    l: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  };
}

/**
 * Convert RGB to LAB
 */
export function rgbToLab(rgb: RGB): LAB {
  return xyzToLab(rgbToXyz(rgb));
}

/**
 * Convert LAB to LCH
 */
export function labToLch(lab: LAB): LCH {
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  let h = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
  if (h < 0) h += 360;

  return { l: lab.l, c, h };
}

/**
 * Convert hex directly to HSL
 */
export function hexToHsl(hex: string): HSL {
  return rgbToHsl(hexToRgb(hex));
}

/**
 * Convert hex directly to LAB
 */
export function hexToLab(hex: string): LAB {
  return rgbToLab(hexToRgb(hex));
}

// ============================================================================
// COLOR DISTANCE METRICS
// ============================================================================

/**
 * Euclidean distance in RGB space
 */
export function rgbDistance(c1: RGB, c2: RGB): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Weighted Euclidean distance (perceptual)
 */
export function weightedRgbDistance(c1: RGB, c2: RGB): number {
  const rMean = (c1.r + c2.r) / 2;
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;

  const rWeight = 2 + rMean / 256;
  const gWeight = 4;
  const bWeight = 2 + (255 - rMean) / 256;

  return Math.sqrt(rWeight * dr * dr + gWeight * dg * dg + bWeight * db * db);
}

/**
 * CIEDE2000 color difference (perceptually uniform)
 */
export function ciede2000(lab1: LAB, lab2: LAB): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.sqrt(lab1.a * lab1.a + lab1.b * lab1.b);
  const C2 = Math.sqrt(lab2.a * lab2.a + lab2.b * lab2.b);
  const Cb = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  
  const a1p = lab1.a * (1 + G);
  const a2p = lab2.a * (1 + G);
  
  const C1p = Math.sqrt(a1p * a1p + lab1.b * lab1.b);
  const C2p = Math.sqrt(a2p * a2p + lab2.b * lab2.b);
  
  const h1p = Math.atan2(lab1.b, a1p) * (180 / Math.PI);
  const h2p = Math.atan2(lab2.b, a2p) * (180 / Math.PI);
  
  const dLp = lab2.l - lab1.l;
  const dCp = C2p - C1p;
  
  let dhp = h2p - h1p;
  if (Math.abs(dhp) > 180) {
    dhp = dhp > 0 ? dhp - 360 : dhp + 360;
  }
  
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * (Math.PI / 180));
  
  const Lbp = (lab1.l + lab2.l) / 2;
  const Cbp = (C1p + C2p) / 2;
  
  let Hbp = (h1p + h2p) / 2;
  if (Math.abs(h1p - h2p) > 180) {
    Hbp = Hbp < 180 ? Hbp + 180 : Hbp - 180;
  }
  
  const T = 1 
    - 0.17 * Math.cos((Hbp - 30) * (Math.PI / 180))
    + 0.24 * Math.cos((2 * Hbp) * (Math.PI / 180))
    + 0.32 * Math.cos((3 * Hbp + 6) * (Math.PI / 180))
    - 0.20 * Math.cos((4 * Hbp - 63) * (Math.PI / 180));
  
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  
  const RT = -2 
    * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)))
    * Math.sin((60 * Math.exp(-Math.pow((Hbp - 275) / 25, 2))) * (Math.PI / 180));
  
  const dE = Math.sqrt(
    Math.pow(dLp / (kL * SL), 2)
    + Math.pow(dCp / (kC * SC), 2)
    + Math.pow(dHp / (kH * SH), 2)
    + RT * (dCp / (kC * SC)) * (dHp / (kH * SH))
  );
  
  return dE;
}

/**
 * Color distance using CIEDE2000 from hex values
 */
export function colorDistance(hex1: string, hex2: string): number {
  const lab1 = hexToLab(hex1);
  const lab2 = hexToLab(hex2);
  return ciede2000(lab1, lab2);
}

// ============================================================================
// COLOR ANALYSIS
// ============================================================================

/**
 * Determine color family from hue
 */
export function getColorFamily(hsl: HSL): ColorFamily {
  if (hsl.s < 0.1 || (hsl.l < 0.15 || hsl.l > 0.85)) {
    return 'neutral';
  }

  const h = hsl.h;

  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 75) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'cyan';
  if (h < 255) return 'blue';
  if (h < 285) return 'purple';
  return 'magenta';
}

/**
 * Calculate relative luminance (WCAG)
 */
export function relativeLuminance(rgb: RGB): number {
  const rsrgb = rgb.r / 255;
  const gsrgb = rgb.g / 255;
  const bsrgb = rgb.b / 255;

  const r = rsrgb <= 0.03928 ? rsrgb / 12.92 : Math.pow((rsrgb + 0.055) / 1.055, 2.4);
  const g = gsrgb <= 0.03928 ? gsrgb / 12.92 : Math.pow((gsrgb + 0.055) / 1.055, 2.4);
  const b = bsrgb <= 0.03928 ? bsrgb / 12.92 : Math.pow((bsrgb + 0.055) / 1.055, 2.4);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors
 */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Full color analysis
 */
export function analyzeColor(hex: string): ColorAnalysis {
  const rgb = hexToRgb(hex);
  const hsl = rgbToHsl(rgb);
  const lab = rgbToLab(rgb);
  const family = getColorFamily(hsl);
  const luminance = relativeLuminance(rgb);

  const warmFamilies: ColorFamily[] = ['red', 'orange', 'yellow'];
  const coolFamilies: ColorFamily[] = ['cyan', 'blue', 'purple'];

  return {
    hex,
    rgb,
    hsl,
    lab,
    family,
    isWarm: warmFamilies.includes(family),
    isCool: coolFamilies.includes(family),
    isNeutral: family === 'neutral',
    luminance,
    saturationLevel: hsl.s < 0.3 ? 'low' : hsl.s < 0.6 ? 'medium' : 'high',
    lightnessLevel: hsl.l < 0.3 ? 'dark' : hsl.l < 0.7 ? 'medium' : 'light',
  };
}

// ============================================================================
// PALETTE ANALYSIS
// ============================================================================

/**
 * Analyze a color palette
 */
export function analyzePalette(hexColors: string[]): {
  dominant: ColorAnalysis;
  families: Map<ColorFamily, string[]>;
  warmth: number;
  averageSaturation: number;
  averageLightness: number;
  isMonochromatic: boolean;
  isComplementary: boolean;
  harmony: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'mixed';
} {
  if (hexColors.length === 0) {
    const defaultAnalysis = analyzeColor('#808080');
    return {
      dominant: defaultAnalysis,
      families: new Map(),
      warmth: 0.5,
      averageSaturation: 0,
      averageLightness: 0.5,
      isMonochromatic: true,
      isComplementary: false,
      harmony: 'monochromatic',
    };
  }

  const analyses = hexColors.map(analyzeColor);
  const dominant = analyses[0];

  // Group by family
  const families = new Map<ColorFamily, string[]>();
  analyses.forEach((a) => {
    if (!families.has(a.family)) {
      families.set(a.family, []);
    }
    families.get(a.family)!.push(a.hex);
  });

  // Calculate warmth (0 = cool, 1 = warm)
  const warmCount = analyses.filter((a) => a.isWarm).length;
  const coolCount = analyses.filter((a) => a.isCool).length;
  const warmth = (warmCount - coolCount + analyses.length) / (2 * analyses.length);

  // Average saturation and lightness
  const avgSat = analyses.reduce((sum, a) => sum + a.hsl.s, 0) / analyses.length;
  const avgLight = analyses.reduce((sum, a) => sum + a.hsl.l, 0) / analyses.length;

  // Check color harmony
  const hues = analyses.filter((a) => !a.isNeutral).map((a) => a.hsl.h);
  const uniqueFamilies = families.size;

  let harmony: 'monochromatic' | 'analogous' | 'complementary' | 'triadic' | 'mixed';
  
  if (uniqueFamilies <= 1) {
    harmony = 'monochromatic';
  } else if (uniqueFamilies === 2 && hues.length >= 2) {
    const hueDiff = Math.abs(hues[0] - hues[1]);
    const normalizedDiff = Math.min(hueDiff, 360 - hueDiff);
    
    if (normalizedDiff < 60) {
      harmony = 'analogous';
    } else if (normalizedDiff > 150 && normalizedDiff < 210) {
      harmony = 'complementary';
    } else {
      harmony = 'mixed';
    }
  } else if (uniqueFamilies === 3) {
    harmony = 'triadic';
  } else {
    harmony = 'mixed';
  }

  return {
    dominant,
    families,
    warmth,
    averageSaturation: avgSat,
    averageLightness: avgLight,
    isMonochromatic: uniqueFamilies <= 1,
    isComplementary: harmony === 'complementary',
    harmony,
  };
}

/**
 * Generate complementary color
 */
export function complementary(hex: string): string {
  const hsl = hexToHsl(hex);
  hsl.h = (hsl.h + 180) % 360;
  return rgbToHex(hslToRgb(hsl));
}

/**
 * Generate analogous colors
 */
export function analogous(hex: string, spread = 30): [string, string, string] {
  const hsl = hexToHsl(hex);
  
  const left = { ...hsl, h: (hsl.h - spread + 360) % 360 };
  const right = { ...hsl, h: (hsl.h + spread) % 360 };
  
  return [
    rgbToHex(hslToRgb(left)),
    hex,
    rgbToHex(hslToRgb(right)),
  ];
}

/**
 * Generate triadic colors
 */
export function triadic(hex: string): [string, string, string] {
  const hsl = hexToHsl(hex);
  
  const second = { ...hsl, h: (hsl.h + 120) % 360 };
  const third = { ...hsl, h: (hsl.h + 240) % 360 };
  
  return [
    hex,
    rgbToHex(hslToRgb(second)),
    rgbToHex(hslToRgb(third)),
  ];
}

/**
 * Lighten a color
 */
export function lighten(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.l = Math.min(1, hsl.l + amount);
  return rgbToHex(hslToRgb(hsl));
}

/**
 * Darken a color
 */
export function darken(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.l = Math.max(0, hsl.l - amount);
  return rgbToHex(hslToRgb(hsl));
}

/**
 * Saturate a color
 */
export function saturate(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.s = Math.min(1, hsl.s + amount);
  return rgbToHex(hslToRgb(hsl));
}

/**
 * Desaturate a color
 */
export function desaturate(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  hsl.s = Math.max(0, hsl.s - amount);
  return rgbToHex(hslToRgb(hsl));
}

/**
 * Mix two colors
 */
export function mix(hex1: string, hex2: string, weight = 0.5): string {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);

  return rgbToHex({
    r: Math.round(rgb1.r * (1 - weight) + rgb2.r * weight),
    g: Math.round(rgb1.g * (1 - weight) + rgb2.g * weight),
    b: Math.round(rgb1.b * (1 - weight) + rgb2.b * weight),
  });
}
