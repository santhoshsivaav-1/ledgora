import { Download, FileSpreadsheet, Printer, Share2 } from 'lucide-react';
import Menu from './Menu';
import { tableExportActions } from '../../features/import-export/tableExportActions';

// Export ▾ for every list and report (P0-S3.2): Print / PDF, Excel, CSV and Share, the same code TableExport uses.
// `getRows` is called on click, so a large table is only turned into cells when someone actually exports it.

export default function ExportMenu({ title, subtitle, headers, rows, getRows, filename, landscape, formats = ['print', 'xlsx', 'csv', 'share'] }) {
  const run = (kind) => {
    const actions = tableExportActions({ title, subtitle, headers, rows: getRows ? getRows() : rows, filename, landscape });
    ({ print: actions.print, xlsx: actions.excel, csv: actions.csv, share: actions.share })[kind]?.();
  };
  const items = [
    { kind: 'print', label: 'Print / PDF', icon: Printer },
    { kind: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
    { kind: 'csv', label: 'CSV', icon: Download },
    { kind: 'share', label: 'Share', icon: Share2 },
  ]
    .filter((i) => formats.includes(i.kind))
    .map((i) => ({ label: i.label, icon: i.icon, perm: 'data:export', onSelect: () => run(i.kind) }));
  return (
    <Menu
      label="Export"
      trigger={
        <>
          <Download size={15} aria-hidden="true" /> Export
        </>
      }
      items={items}
    />
  );
}
