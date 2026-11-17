// v1.9.9 — Visual design presets. Each is a starting point that flips
// the pdfTemplate + color palette + thermal typography + a couple of
// layout tweaks in one click. Users can still edit every individual
// setting below afterwards (the preset just seeds sensible defaults for
// the vibe they picked).
//
// v1.9.10 — presets now shape BOTH the PDF and the thermal render.
// Colors are PDF-only (thermal printers are B&W by physics), but font
// family / weight / spacing / all-caps / header alignment / content
// toggles all apply to both, so switching preset visibly changes the
// thermal preview too.
// v1.10.36 — Design presets rewrite. Reported: "current ones are not
// good at all". Prior set had 9 designs with ~3 near-duplicate pairs
// (Modern/Enterprise/IT Services all used pdfTemplate:'modern' with
// tiny palette tweaks — hard to tell apart from the swatch bar), a
// yellow-on-navy Corporate that looked dated, and no real editorial
// or brand-forward direction. Refreshed to 8 SHARPLY DIFFERENT designs
// with intentional palettes drawn from modern invoice design references
// (Stripe, Vercel, Linear, Ramp, boutique retail, editorial press).
//
// Each preset keeps the same `id` where the ID slot mapped to a
// pdfTemplate the codebase already renders — no template code changes,
// only palette + typographic pairing shifts. That way users with
// activePresetId already in localStorage continue to see something
// active, and any per-invoice pdfStyle overrides keep working.
//
// The `mockup` array on each preset drives the mini-preview render
// (see DesignStyleSection) — a proper little invoice thumbnail instead
// of the old 3-color strip.
export const DESIGN_PRESETS = [
  {
    id: 'modern',
    name: 'Aurora',
    icon: '✦',
    description: 'Cool slate + electric blue. Modern SaaS invoice.',
    tag: 'Freelancers · Tech',
    settings: {
      pdfTemplate: 'modern',
      userColorsEnabled: true,
      pdfPrimaryText: '#0f172a', pdfMutedText: '#64748b',
      pdfAccent: '#2563eb', pdfAccentText: '#ffffff',
      pdfHeaderBg: '#f8fafc', pdfDividerColor: '#e2e8f0',
      fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
      lineSpacing: 'normal', allCaps: false,
      headerAlign: 'left', headerCaps: true, contrast: 'high',
    },
  },
  {
    id: 'classic',
    name: 'Editorial',
    icon: '❋',
    description: 'Deep charcoal on warm ivory. Newspaper-authority feel.',
    tag: 'Law · Consulting',
    settings: {
      pdfTemplate: 'classic',
      userColorsEnabled: true,
      pdfPrimaryText: '#1c1917', pdfMutedText: '#78716c',
      pdfAccent: '#1c1917', pdfAccentText: '#f5f5f4',
      pdfHeaderBg: '#f5f5f4', pdfDividerColor: '#d6d3d1',
      fontFamily: 'mono', fontWeight: 'ultra', fontSize: 'medium',
      lineSpacing: 'compact', allCaps: true,
      headerAlign: 'center', headerCaps: true, contrast: 'ultra',
    },
  },
  {
    id: 'corporate',
    name: 'Executive',
    icon: '◆',
    description: 'Deep navy + soft champagne. Boardroom serious.',
    tag: 'Enterprise · B2B',
    settings: {
      pdfTemplate: 'corporate',
      userColorsEnabled: true,
      pdfPrimaryText: '#0c1e3d', pdfMutedText: '#475569',
      pdfAccent: '#0c1e3d', pdfAccentText: '#e8dcc4',
      pdfHeaderBg: '#f4f2ed', pdfDividerColor: '#c4b896',
      fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
      lineSpacing: 'comfortable', allCaps: false,
      headerAlign: 'center', headerCaps: true, contrast: 'high',
    },
  },
  {
    id: 'minimalist',
    name: 'Whisper',
    icon: '○',
    description: 'Off-white, single hairline, zero clutter.',
    tag: 'Designers · Studios',
    settings: {
      pdfTemplate: 'minimalist',
      userColorsEnabled: true,
      pdfPrimaryText: '#171717', pdfMutedText: '#a3a3a3',
      pdfAccent: '#171717', pdfAccentText: '#ffffff',
      pdfHeaderBg: '#fafafa', pdfDividerColor: '#e5e5e5',
      fontFamily: 'sans', fontWeight: 'normal', fontSize: 'medium',
      lineSpacing: 'comfortable', allCaps: false,
      headerAlign: 'left', headerCaps: false, contrast: 'normal',
    },
  },
  {
    id: 'colorful',
    name: 'Sunset',
    icon: '❉',
    description: 'Warm terracotta on cream. Boutique, cafe, salon.',
    tag: 'Retail · Cafe',
    settings: {
      pdfTemplate: 'modern',
      userColorsEnabled: true,
      pdfPrimaryText: '#7c2d12', pdfMutedText: '#9a3412',
      pdfAccent: '#ea580c', pdfAccentText: '#ffffff',
      pdfHeaderBg: '#fef3ec', pdfDividerColor: '#fdba74',
      fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
      lineSpacing: 'normal', allCaps: false,
      headerAlign: 'center', headerCaps: true, contrast: 'high',
      showTagline: true,
    },
  },
  {
    id: 'minimal',
    name: 'Monoline',
    icon: '⌘',
    description: 'Editorial mono, dense rows, developer aesthetic.',
    tag: 'Dev · Agency',
    settings: {
      pdfTemplate: 'minimal',
      userColorsEnabled: true,
      pdfPrimaryText: '#0a0a0a', pdfMutedText: '#525252',
      pdfAccent: '#16a34a', pdfAccentText: '#ffffff',
      pdfHeaderBg: '#ffffff', pdfDividerColor: '#0a0a0a',
      pdfFontScale: 0.9,
      fontFamily: 'mono', fontWeight: 'ultra', fontSize: 'small',
      lineSpacing: 'compact', allCaps: true,
      headerAlign: 'left', headerCaps: true, contrast: 'ultra',
      showRateLine: false,
    },
  },
  {
    id: 'enterprise',
    name: 'Nordic',
    icon: '❄',
    description: 'Cool teal on frosted white. Calm, professional.',
    tag: 'SaaS · Studios',
    settings: {
      pdfTemplate: 'modern',
      userColorsEnabled: true,
      pdfPrimaryText: '#134e4a', pdfMutedText: '#0f766e',
      pdfAccent: '#0d9488', pdfAccentText: '#ffffff',
      pdfHeaderBg: '#f0fdfa', pdfDividerColor: '#99f6e4',
      pdfDarkenOnPrint: true,
      fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
      lineSpacing: 'normal', allCaps: false,
      headerAlign: 'left', headerCaps: true, contrast: 'high',
      showHSN: true,
    },
  },
  {
    id: 'retail',
    name: 'Bold Retail',
    icon: '▲',
    description: 'Aggressive black + red pop. Fashion, sports, street.',
    tag: 'Fashion · Sports',
    settings: {
      pdfTemplate: 'minimalist',
      userColorsEnabled: true,
      pdfPrimaryText: '#0a0a0a', pdfMutedText: '#404040',
      pdfAccent: '#dc2626', pdfAccentText: '#ffffff',
      pdfHeaderBg: '#ffffff', pdfDividerColor: '#0a0a0a',
      pdfDarkenOnPrint: true,
      fontFamily: 'sans', fontWeight: 'bold', fontSize: 'medium',
      lineSpacing: 'normal', allCaps: true,
      headerAlign: 'left', headerCaps: true, contrast: 'high',
      showHSN: true,
    },
  },
];
