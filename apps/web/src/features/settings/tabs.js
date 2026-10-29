// Which page of Settings (change 3.19) each section belongs to; /settings/<tab> shows only that tab's sections.
export const SETTINGS_TABS = [
  ['business', 'Business', 'Company details, profiles and region'],
  ['documents', 'Invoices & print', 'Terms and conditions, print layout and PDF style'],
  ['features', 'Features & stock', 'Switch features on or off, stock alerts'],
  ['data', 'Data', 'Trash, export and import'],
];
export const TAB_OF = {
  'section-company': 'business', 'section-profiles': 'business', 'section-region': 'business',
  'section-terms': 'documents', 'section-print': 'documents',
  'section-modules': 'features', 'section-stock': 'features',
  'section-backups': 'data', 'section-data': 'data',
};

