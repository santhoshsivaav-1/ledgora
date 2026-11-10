// Build-time feature flags (Vite replaces import.meta.env.* statically, so a
// disabled feature's code is dropped from the bundle).
//
// billScan: photo/PDF bill reading (Purchases -> Scan bill). It used a copy of
// Tesseract bundled into public/tesseract (~30 MB), which Phase 0 removed. OCR
// comes back as a server job in change 6.10, so the button stays hidden until
// then. Set VITE_ENABLE_BILL_SCAN=true only after that work lands.
//
// saleInlinePayments ("sale.inlinePayments" in docs/VYAPAR_IMPLEMENTATION_PHASES.md): the Phase 2 sale editor -
// payments received with the sale, additional charges, salesman, credit-limit / §269ST checks on save, the single-page
// layout with Save & New, the Payment In discount/TDS fields, credit-note reason/restock/refund and sale-order
// progress. Off = the editor and receipts behave exactly as before. Turn on with VITE_ENABLE_SALE_INLINE_PAYMENTS=true.
export const FEATURES = {
  billScan: import.meta.env.VITE_ENABLE_BILL_SCAN === 'true',
  saleInlinePayments: import.meta.env.VITE_ENABLE_SALE_INLINE_PAYMENTS === 'true',
};
