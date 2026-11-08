// The three ways a report table leaves the app (v1.10.77, #85): CSV (toCsvLine, formula-safe), Excel (.xlsx,
// numbers stay numbers) and Print / PDF (the table alone on its own page; choose "Save as PDF" in the print dialog).
// Moved out of TableExport.jsx unchanged so the new ExportMenu (components/ui/ExportMenu.jsx) uses the same code.
import { toCsvLine } from '../../utils';
import { buildXlsx } from './xlsx';
import { toast } from '../../components/ui/Toast';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const save = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const safeName = (s) => String(s || 'report').replace(/[^A-Za-z0-9 _.-]+/g, '-').replace(/\s+/g, '_').slice(0, 80);

// headers: column titles; rows: arrays of cells (numbers stay numbers).
// subtitle: one line under the title on the printed page (period, business).
export function tableExportActions({ title, subtitle = '', headers, rows, filename, landscape = false }) {
  const empty = !rows || rows.length === 0;
  const name = safeName(filename || title);
  const guard = () => { if (empty) { toast('Nothing to export', 'warning'); return true; } return false; };

  const csvText = () => [headers, ...rows].map(toCsvLine).join('\n');
  const csv = () => {
    if (guard()) return;
    save(new Blob([csvText()], { type: 'text/csv;charset=utf-8;' }), `${name}.csv`);
    toast('CSV downloaded', 'success');
  };
  const excel = () => {
    if (guard()) return;
    save(new Blob([buildXlsx([headers, ...rows], title)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
    toast('Excel file downloaded', 'success');
  };
  const print = () => {
    if (guard()) return;
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this page to print the report', 'error'); return; }
    const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : esc(v));
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; } body { font: 10px Arial, sans-serif; color: #000; }
      h1 { font-size: 14px; margin: 0; } p { margin: 2px 0 8px; } table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #555; padding: 3px 4px; text-align: left; } th { background: #eee; } td.n { text-align: right; white-space: nowrap; }
      </style></head><body><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>
      <table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
      ${rows.map((r) => `<tr>${r.map((v) => `<td${typeof v === 'number' ? ' class="n"' : ''}>${fmt(v)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  // The phone share sheet with the CSV attached, where the browser has one (Android Chrome, Safari).
  const share = async () => {
    if (guard()) return;
    const file = new File([csvText()], `${name}.csv`, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
      } catch {
        /* closed the share sheet */
      }
      return;
    }
    toast('Sharing is not available in this browser. Download the file instead.', 'info');
  };

  return { csv, excel, print, share };
}
