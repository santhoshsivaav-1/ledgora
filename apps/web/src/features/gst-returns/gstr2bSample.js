// A small GSTR-2B in the portal's JSON shape (data.docdata.b2b[].inv[].items[]), for the "Sample JSON" button: it
// shows the layout Import 2B JSON reads and lets someone try the reconciliation before downloading their own file.
// The GSTINs and invoices are made up.
export const GSTR2B_SAMPLE = {
  data: {
    gstin: '27ABCDE1234F1Z5',
    rtnprd: '102026',
    docdata: {
      b2b: [
        {
          ctin: '27AAACG1234K1Z2',
          trdnm: 'Gupta Steel',
          inv: [
            {
              inum: 'SUP/552',
              dt: '03-10-2026',
              val: 7080,
              itcavl: 'Y',
              items: [{ rt: 18, txval: 6000, igst: 0, cgst: 540, sgst: 540 }],
            },
          ],
        },
        {
          ctin: '29AABCK5678L1Z9',
          trdnm: 'Kumar Packaging',
          inv: [
            {
              inum: 'KP-1043',
              dt: '15-10-2026',
              val: 2360,
              itcavl: 'Y',
              items: [{ rt: 18, txval: 2000, igst: 360, cgst: 0, sgst: 0 }],
            },
          ],
        },
      ],
    },
  },
};

export function downloadJSON(filename, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
