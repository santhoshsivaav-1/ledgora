// Build-time feature flags (Vite replaces import.meta.env.* statically, so a
// disabled feature's code is dropped from the bundle).
//
// billScan: photo/PDF bill reading (Purchases -> Scan bill). It used a copy of
// Tesseract bundled into public/tesseract (~30 MB), which Phase 0 removed. OCR
// comes back as a server job in change 6.10, so the button stays hidden until
// then. Set VITE_ENABLE_BILL_SCAN=true only after that work lands.
export const FEATURES = {
  billScan: import.meta.env.VITE_ENABLE_BILL_SCAN === 'true',
};
