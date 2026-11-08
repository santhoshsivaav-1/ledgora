// v1.10.77 (#85) - "all reports and statements should be downloadable in CSV,
// PDF and Excel". One set of buttons for every report table, so they all
// export the same way: CSV (toCsvLine, formula-safe), Excel (.xlsx, numbers
// stay numbers) and Print / PDF (the table alone on its own page; choose
// "Save as PDF" in the print dialog).
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { tableExportActions } from './tableExportActions';

// headers: column titles; rows: arrays of cells (numbers stay numbers).
// subtitle: one line under the title on the printed page (period, business).
export default function TableExport({ title, subtitle = '', headers, rows, filename, landscape = false }) {
  const { csv, excel, print } = tableExportActions({ title, subtitle, headers, rows, filename, landscape });

  return (
    <span style={{ display: 'inline-flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary" onClick={print} title="Print, or Save as PDF"><Printer size={15} /> Print / PDF</button>
      <button type="button" className="btn btn-secondary" onClick={excel} title="Excel (.xlsx)"><FileSpreadsheet size={15} /> Excel</button>
      <button type="button" className="btn btn-secondary" onClick={csv} title="CSV"><Download size={15} /> CSV</button>
    </span>
  );
}
