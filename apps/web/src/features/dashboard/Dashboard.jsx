import { useAppSetting } from '../../lib/appSettings';
import { useState, useEffect, useMemo, useRef } from 'react';
import { Plus } from 'lucide-react';
import HelpButton from '../../components/ui/HelpButton';
import { getProfile, getAllClients, getAllProducts, getStockAlertSettings, deleteReceipt } from '../../lib/data';
import { formatCurrency, getFYOptions, belongsToProfile, salesSign, isCancelledBill, markPaidPatch, markUnpaidPatch, SALES_INVOICE_TYPES, amountDue } from '../../utils';
import { openWhatsAppShare } from '../import-export/share';
import PageHeader from '../../components/ui/PageHeader';
import BulkCsvImport from '../import-export/BulkCsvImport';
import PrintPreviewModal from '../print/PrintPreviewModal';
import { toast } from '../../components/ui/Toast';
import { confirmAction } from '../../components/ui/ConfirmModal';
import InvoiceTable from '../invoices/list/InvoiceTable';
import { STATUS_CONFIG } from '../invoices/list/statusConfig';
import ScopeSummary from './ScopeSummary';
import HomePanel from './HomePanel';
import PaymentModals from './PaymentModals';
import { useBillsLoader } from './useBillsLoader';
import { usePaymentActions } from './usePaymentActions';
import { createStatusActions } from './statusActions';
import { createPdfExportActions, generateSingleBillPdfBlob } from './pdfExport';
import { buildShareMessage, reminderMessage } from './shareMessages';

// v1.10.64 — requested (#55, @sangwanmail-eng): "An invoice belonging to one
// company should not appear under the other."
//
// Bills and the active business load independently, so filtering at load
// time would race — whichever arrived second would be ignored. Instead the
// raw list is held and the visible list derived, which stays correct when
// either changes, including when the user switches business from the
// header without a reload.
//
// Anything that cannot be attributed to a business is SHOWN, never hidden.
// See belongsToProfile() in utils.js for why that matters here.

// v1.10.65 — requested (#58 item 1, @sangwanmail-eng): "Dashboard should
// refresh automatically after company switch."
//
// It did not, because the dashboard fetched the business ONCE when it
// mounted. Switching business from the header updated the app, but this
// screen never heard about it and kept showing the previous company's
// invoices until a manual reload.
//
// The live value is now passed in as a prop, so a switch re-filters
// immediately. The locally fetched copy stays as a fallback for the first
// paint, before the prop has arrived.

// The status values the server understands on the paged bills endpoint.
// 'open' and 'converted' are client-side concepts (convertedTo flag), so
// they are never sent — those stay client-side filters.
const SERVER_STATUSES = new Set(['unpaid', 'partial', 'paid', 'overdue', 'cancelled']);

export default function Dashboard({ mode = 'home', scope = null, onNew, onEdit, onPrint, onDuplicate, onConvert, onOpenProducts, onOpenSettings, onOpenGuide, activeProfile }) {
  const [allBills, setBills] = useState([]);
  const [profileState, setProfileState] = useState(null);

  const profile = activeProfile ?? profileState;

  // A page under Sales (quotations, sales orders, ...) passes `scope` and lists only its own document types.
  const bills = useMemo(
    () => allBills.filter(b => belongsToProfile(b, profile) && (!scope || scope.types.includes(b.invoiceType || 'tax-invoice'))),
    [allBills, profile, scope],
  );
  // Paid / unpaid only mean something for documents that are sales; the other pages track Open / Converted instead.
  const tracksPayments = !scope || scope.types.some(t => SALES_INVOICE_TYPES.includes(t));
  const newDoc = () => onNew(scope?.newType);
  const [filtered, setFiltered] = useState([]);

  // v1.10.66 (#64 item 3) — the headline cards are computed from `bills`, the
  // list already narrowed to the active business. They used to be summed in
  // loadBills() from the raw server response, so Total Invoiced, Tax Collected,
  // Outstanding and the invoice count added up EVERY company's invoices while
  // the table underneath showed only one.
  const stats = useMemo(() => {
    // v1.10.67 (#66 item 7, @sangwanmail-eng) — these cards are turnover, so
    // only real sales count. A proforma is a quote, a delivery challan moves
    // goods without selling them, a credit note takes money back, and a
    // cancelled document counts for nothing.
    const byCurrency = {};
    let count = 0;
    for (const b of bills) {
      const sign = salesSign(b);
      if (sign === 0) continue;
      count += 1;
      const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
      if (!byCurrency[cur]) byCurrency[cur] = { total: 0, tax: 0, unpaid: 0 };
      byCurrency[cur].total += sign * (b.totalAmount || 0);
      byCurrency[cur].tax += sign * (b.totalTaxAmount || 0);
      if (sign > 0 && b.status !== 'paid') byCurrency[cur].unpaid += Math.max(0, amountDue(b) - (b.paidAmount || 0));
    }
    return { byCurrency, count };
  }, [bills]);

  // ---- Invoice-list loading (audit S6, server-side pagination) ----
  // The /invoices screen (`mode === 'invoices'`, no `scope`) pages the list
  // 50 invoices at a time from the server so a 50,000-invoice book opens
  // instantly; the text search, plain status and date-range filters map to
  // the server's q / status / from / to params, and a "Load more" button
  // fetches the next cursor page. Scoped Sales pages (quotations, credit
  // notes, ...) keep the previous whole-collection load: their lists are
  // type-filtered client-side, which the paged endpoint cannot do, and they
  // are far smaller than the full invoice book.
  const paged = mode === 'invoices' && !scope;
  const { loadBills, loadMore, nextCursor, loadingMore } = useBillsLoader({ paged, setBills });
  const { planStock, saveWithStock, syncSavedPdfs, handleCancelInvoice, changeStatus, undoCancel } = createStatusActions({ loadBills });

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fyFilter, setFyFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // The filter set currently sent to the server (paged mode only). Rebuilt
  // each render so post-mutation refreshes and "Load more" reuse exactly
  // what the user is looking at.
  const statusParam = SERVER_STATUSES.has(statusFilter) ? statusFilter : undefined;
  const serverFilters = {
    q: search.trim() || undefined,
    status: statusParam,
    from: dateFrom || undefined,
    to: dateTo || undefined,
  };

  // Bulk-selection state. Stores a Set of bill IDs (not the bills themselves)
  // so we don't hold stale references when the underlying bill is edited
  // elsewhere. Cleared whenever filters change so the user doesn't accidentally
  // bulk-act on bills they can no longer see.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // v1.10.74 - the comment above was never wired up, so bulk actions could hit
  // ticked rows hidden by a filter. Reset during render (React's "adjust state
  // on prop change" pattern) when any filter changes.
  const filterKey = [search, typeFilter, statusFilter, fyFilter, dateFrom, dateTo].join('|');
  const [selectionFilterKey, setSelectionFilterKey] = useState(filterKey);
  if (selectionFilterKey !== filterKey) {
    setSelectionFilterKey(filterKey);
    if (selectedIds.size) setSelectedIds(new Set());
  }
  // v1.9.4 — column picker. Persist to localStorage. Default set matches
  // the pre-v1.9.4 hardcoded columns so no visual change on upgrade.
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('gst_dashboardColumns') || 'null');
      if (saved && typeof saved === 'object') return saved;
    } catch { /* ignore */ }
    return {
      date: true, invoice: true, type: true, client: true, amount: true,
      status: true, actions: true, printed: false, currency: false, dueDate: false,
    };
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('gst_dashboardColumns', JSON.stringify(visibleColumns)); } catch { /* ignore */ }
  }, [visibleColumns]);
  const [bulkBusy, setBulkBusy] = useState(false);
  // v1.10.80 (#100) - the invoice shown read-only by the View button.
  const [viewBill, setViewBill] = useState(null);

  const [showRemindAll, setShowRemindAll] = useState(false);
  const [clients, setClients] = useState([]);
  const [productCount, setProductCount] = useState(null);   // null = not loaded yet
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try { return localStorage.getItem('freegstbill_startedDismissed') === '1'; } catch { return false; }
  });
  const [lowStockProducts, setLowStockProducts] = useState([]);

  // v1.10.4 — audit M14. getFYOptions is date-based (only changes across
  // April-1 boundary); memoize with an empty dep so we run it once per
  // component mount, not on every render.
  const fyStartMonth = useAppSetting('fy.startMonth');
  const fyOptions = useMemo(() => getFYOptions(5, new Date(), fyStartMonth), [fyStartMonth]);

  const payment = usePaymentActions({ onBillsChanged: () => loadBills() });
  const { openPaymentModal } = payment;

  useEffect(() => {
    if (!paged) loadBills();
    getProfile().then(p => setProfileState(p)).catch(() => {});
    getAllClients().then(c => setClients(c)).catch(() => {});
    // Pull the stock-alert config alongside products so the Dashboard's
    // low-stock card honours the user's threshold + on/off preference.
    Promise.all([
      getAllProducts().catch(() => []),
      getStockAlertSettings().catch(() => ({ enabled: true, threshold: 5 })),
    ]).then(([prods, cfg]) => {
      setProductCount(prods.length);
      if (cfg?.enabled === false) { setLowStockProducts([]); return; }
      const threshold = Number(cfg?.threshold ?? 5);
      setLowStockProducts(prods.filter(p => (p.stock ?? 0) <= threshold));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paged mode: (re)fetch page 1 whenever a server-side filter changes. The
  // first run fetches immediately (so the screen opens fast); later runs are
  // debounced so typing in the search box doesn't fire a request per letter.
  const firstPagedRun = useRef(true);
  useEffect(() => {
    if (!paged) return undefined;
    const filters = serverFilters;
    if (firstPagedRun.current) {
      firstPagedRun.current = false;
      loadBills(filters);
      return undefined;
    }
    const t = setTimeout(() => { loadBills(filters); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged, search, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    let result = bills;
    if (search.trim() && !paged) {
      // Paged mode searches on the server (`q`) — the server may match on
      // more fields than this client-side check, so re-filtering here could
      // wrongly drop rows the server considered a match.
      const q = search.toLowerCase();
      result = result.filter(b =>
        (b.clientName || '').toLowerCase().includes(q) ||
        (b.invoiceNumber || '').toLowerCase().includes(q)
      );
    }
    if (typeFilter !== 'all') result = result.filter(b => (b.invoiceType || 'tax-invoice') === typeFilter);
    if (statusFilter === 'open') result = result.filter(b => !b.convertedTo && b.status !== 'cancelled');
    else if (statusFilter === 'converted') result = result.filter(b => !!b.convertedTo);
    else if (statusFilter !== 'all' && !(paged && statusParam)) result = result.filter(b => (b.status || 'unpaid') === statusFilter);
    if (fyFilter !== 'all') {
      const fy = fyOptions.find(f => f.value === fyFilter);
      if (fy) result = result.filter(b => b.invoiceDate >= fy.from && b.invoiceDate <= fy.to);
    }
    if (dateFrom && !paged) result = result.filter(b => b.invoiceDate >= dateFrom);
    if (dateTo && !paged) result = result.filter(b => b.invoiceDate <= dateTo);
    setFiltered(result);
  }, [bills, paged, statusParam, search, typeFilter, statusFilter, fyFilter, dateFrom, dateTo, fyOptions]);

  const handleView = (bill) => {
    if (bill.data) onEdit(bill);
    else toast('No editable data saved for this invoice', 'warning');
  };

  // ---- Bulk operations ----
  // All bulk handlers fan out concurrently via Promise.allSettled so one
  // failure can't strand the rest. After every bulk action we refresh the
  // bills list and clear the selection.
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAllVisible = () => setSelectedIds(prev => {
    const allVisible = filtered.every(b => prev.has(b.id));
    if (allVisible) {
      // Deselect only the visible ones, leave any off-screen selections alone
      const next = new Set(prev);
      filtered.forEach(b => next.delete(b.id));
      return next;
    }
    const next = new Set(prev);
    filtered.forEach(b => next.add(b.id));
    return next;
  });
  const clearSelection = () => setSelectedIds(new Set());
  const getSelectedBills = () => bills.filter(b => selectedIds.has(b.id));

  const bulkMarkStatus = async (newStatus) => {
    // v1.10.76 (#83) - payment statuses only apply to real sales; a ticked
    // quotation or challan is left alone unless it is being un-cancelled.
    const sel = getSelectedBills().filter((b) => isCancelledBill(b) || SALES_INVOICE_TYPES.includes(b.invoiceType || 'tax-invoice'));
    if (sel.length === 0) { toast('Payment status only applies to tax invoices and bills of supply', 'info'); return; }
    if (!await confirmAction({
      title: `Mark ${sel.length} invoice${sel.length !== 1 ? 's' : ''} as ${STATUS_CONFIG[newStatus]?.label || newStatus}?`,
      message: newStatus === 'paid'
        ? 'A payment for the balance is recorded on each, so payment history and reports stay right.'
        : 'The status change is reversible — you can flip it back any time.',
      confirmLabel: `Mark as ${STATUS_CONFIG[newStatus]?.label || newStatus}`,
    })) return;
    setBulkBusy(true);
    try {
      // Bulk mark-paid must push synthetic payments per bill so payment
       // history and cashflow stay consistent — see changeStatus in
       // statusActions.js for the same fix on the single-row path (P1 #18).
      // Invoices being brought back from Cancelled take their stock out
      // again, as on the single-row dropdown.
      const plans = sel.map((b) => (isCancelledBill(b) ? planStock(b, newStatus) : { bill: b, changes: {} }));
      const results = await saveWithStock(plans, (b) => {
        const patch = { ...b, status: newStatus };
        delete patch.cancelledAt;
        if (newStatus === 'paid') Object.assign(patch, markPaidPatch(b, 'Marked paid (bulk)'));
        if (newStatus === 'unpaid') Object.assign(patch, markUnpaidPatch(b));
        return patch;
      });
      const failed = results.filter(r => r.status === 'rejected').length;
      const done = sel.filter((_, i) => results[i]?.status !== 'rejected');
      syncSavedPdfs(done.filter((b) => isCancelledBill(b)), false);
      if (newStatus === 'unpaid') {
        for (const b of done) {
          const kept = markUnpaidPatch(b).payments;
          for (const pay of (b.payments || []).filter((x) => !kept.includes(x))) if (pay.id) deleteReceipt(pay.id).catch(() => {});
        }
      }
      if (failed > 0) toast(`${sel.length - failed} updated, ${failed} failed`, 'warning');
      else toast(`Marked ${sel.length} as ${newStatus}`, 'success');
      clearSelection();
      loadBills();
    } catch (err) { toast('Bulk update failed: ' + err.message, 'error'); }
    setBulkBusy(false);
  };

  const bulkCancel = async () => {
    const sel = getSelectedBills().filter(b => !isCancelledBill(b));
    if (sel.length === 0) return;
    if (!await confirmAction({
      title: `Cancel ${sel.length} invoice${sel.length !== 1 ? 's' : ''}?`,
      message: 'They keep their numbers but stop counting in totals, reports and GST returns. Stock is restored for any products on them. You can undo each one from its status dropdown.',
      confirmLabel: `Cancel ${sel.length}`,
      tone: 'danger',
    })) return;
    setBulkBusy(true);
    try {
      const at = new Date().toISOString();
      const results = await saveWithStock(sel.map((b) => planStock(b, 'cancelled')), (b) => ({ ...b, status: 'cancelled', cancelledAt: at }));
      const failed = results.filter(r => r.status === 'rejected').length;
      syncSavedPdfs(sel.filter((_, i) => results[i]?.status !== 'rejected'), true);
      if (failed > 0) toast(`${sel.length - failed} cancelled, ${failed} failed`, 'warning');
      else toast(`Cancelled ${sel.length} invoice${sel.length !== 1 ? 's' : ''}`, 'success');
      clearSelection();
      loadBills();
    } catch (err) { toast('Bulk cancel failed: ' + err.message, 'error'); }
    setBulkBusy(false);
  };

  const bulkExportJSON = () => {
    const sel = getSelectedBills();
    if (sel.length === 0) return;
    // Lightweight "give me these N bills as a portable file". Different from
    // the full Settings → Export Backup — this is a per-selection share, e.g.
    // for sending a CA only Q1 invoices. Could be re-imported via the
    // existing Import Backup modal (which only restores ticked sections).
    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      __freegstbill_backup: true,
      __selection: true,
      bills: sel,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freegstbill-bills-${sel.length}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${sel.length} invoice${sel.length !== 1 ? 's' : ''} as JSON`, 'success');
  };

  const { bulkExportPDF, bulkPrintByFilter } = createPdfExportActions({ getSelectedBills, filtered, setBulkBusy });

  const shareWhatsApp = async (bill) => {
    const msg = buildShareMessage(bill, profile);
    // v1.10.22 — try the native Web Share API first, with the actual PDF
    // attached. On mobile Chrome / Safari the share sheet lets the user
    // pick WhatsApp (or any other target). Falls through to the text-only
    // wa.me URL on desktop and older browsers.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        toast('Preparing PDF for share…', 'info', 1500);
        const blob = await generateSingleBillPdfBlob(bill);
        const file = new File([blob], `${bill.invoiceNumber}.pdf`, { type: 'application/pdf' });
        const canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
        if (canShareFile) {
          await navigator.share({
            title: `Invoice ${bill.invoiceNumber}`,
            text: msg,
            files: [file],
          });
          return;
        }
      } catch (e) {
        // AbortError = user dismissed the share sheet; not an error.
        if (e?.name !== 'AbortError') console.warn('Web Share failed, falling back to WhatsApp URL:', e);
        else return;
      }
    }
    // Fallback: text-only WhatsApp URL (existing behaviour).
    // v1.10.24 — Explain WHY the PDF didn't attach the first time a
    // desktop user hits this path. Once per session, then silent — no
    // one wants a toast on every share. Framed as a browser limitation
    // (which is what it is) so users don't blame the app.
    try {
      if (!sessionStorage.getItem('fgsb_whatsappDesktopExplained')) {
        toast('Desktop browsers can\'t attach PDF to WhatsApp Web (a browser security rule). Sharing invoice details as text — download PDF and drop it into WhatsApp Web manually if you need the file. On phone the PDF attaches automatically.', 'info', 7000);
        sessionStorage.setItem('fgsb_whatsappDesktopExplained', '1');
      }
    } catch { /* sessionStorage sandboxed — skip */ }
    openWhatsAppShare(bill.clientPhone, msg);
  };

  const shareEmail = (bill) => {
    // v1.10.24 — same rich payment status as the WhatsApp share (strip
    // markdown asterisks since mailto: doesn't render them).
    const subject = `Invoice ${bill.invoiceNumber} - ${formatCurrency(bill.totalAmount, bill.currency)}`;
    const richBody = buildShareMessage(bill, profile).replace(/\*/g, '');
    const body = `Dear ${bill.clientName},\n\n${richBody}\n\nRegards`;
    // v1.10.74 - fill in the client's email (from the invoice, else the saved
    // client) so the mail opens addressed. Only a plain address is used, so a
    // stray "?" or "&" can't break the mailto link.
    const rawTo = (bill.data?.client?.email || clients.find(c => c.name === bill.clientName)?.email || '').trim();
    const to = /^[^\s@?&#]+@[^\s@?&#]+$/.test(rawTo) ? rawTo : '';
    window.open(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  const clearFilters = () => {
    setSearch(''); setTypeFilter('all'); setStatusFilter('all'); setFyFilter('all'); setDateFrom(''); setDateTo('');
  };

  // v1.10.4 — trivial boolean, still cheap but consistent with the rest.
  const hasFilters = useMemo(
    () => Boolean(search || typeFilter !== 'all' || statusFilter !== 'all' || fyFilter !== 'all' || dateFrom || dateTo),
    [search, typeFilter, statusFilter, fyFilter, dateFrom, dateTo]);

  const sendReminder = (bill) => {
    const clientPhone = bill.clientPhone || bill.data?.client?.phone || '';
    const outstanding = amountDue(bill) - (bill.paidAmount || 0);
    // v1.10.23 — don't send a payment reminder for overpaid or already-paid
    // bills. The old message read "Hi X, kindly arrange the payment of -₹1"
    // which is obviously wrong.
    if (outstanding <= 0.005) {
      toast('This invoice has no outstanding balance — no reminder to send.', 'info');
      return;
    }
    openWhatsAppShare(clientPhone, reminderMessage(bill, profile?.businessName || 'Our Company'));
  };

  const getClientPhone = (bill) => {
    if (bill.clientPhone) return bill.clientPhone;
    if (bill.data?.client?.phone) return bill.data.client.phone;
    const savedClient = clients.find(c => c.name === bill.clientName);
    return savedClient?.phone || '';
  };

  // v1.10.4 — audit M14. Both were rebuilt every render even though
  // they only change when `bills` changes.
  const overdueBills = useMemo(() => bills.filter(b => b.status === 'overdue'), [bills]);
  const overdueByCurrency = useMemo(() => {
    const acc = {};
    for (const b of overdueBills) {
      const cur = b.currency || b.data?.invoiceOptions?.currency || 'INR';
      acc[cur] = (acc[cur] || 0) + amountDue(b) - (b.paidAmount || 0);
    }
    return acc;
  }, [overdueBills]);
  const overdueStr = Object.entries(overdueByCurrency).map(([cur, amt]) => formatCurrency(amt, cur)).join(' + ');

  // The four things a shop owner has to do before this app is useful to them,
  // each answered from what is actually saved - never from "did you look at
  // this screen". null while the data is still loading, so the card cannot
  // flash up half-ticked; null once it is all done, so it retires itself.
  const startedSteps = useMemo(() => {
    if (guideDismissed || productCount === null || !profile) return null;
    const hasBank = !!(profile.paymentAccounts?.length || profile.upiId || profile.accountNumber);
    const steps = [
      { key: 'business', done: !!profile.businessName?.trim(),
        title: 'Add your business details', hint: 'Name, address and GSTIN - these print on every invoice',
        cta: 'Open Settings', go: onOpenSettings },
      { key: 'invoice', done: allBills.length > 0,
        title: 'Make your first invoice', hint: 'Client, what you sold, and the GST is worked out for you',
        cta: 'Start', go: onNew },
      { key: 'products', done: productCount > 0,
        title: 'Add your products or services', hint: 'Saves typing - pick them from a list on every invoice',
        cta: 'Open', go: onOpenProducts },
      { key: 'bank', done: hasBank,
        title: 'Add bank details or UPI', hint: 'So clients can pay you, with a UPI QR on the invoice',
        cta: 'Open Settings', go: onOpenSettings },
    ];
    return steps.every(s => s.done) ? null : steps;
  }, [guideDismissed, productCount, profile, allBills.length, onNew, onOpenProducts, onOpenSettings]);

  const dismissGuide = () => {
    try { localStorage.setItem('freegstbill_startedDismissed', '1'); } catch { /* private mode */ }
    setGuideDismissed(true);
  };

  return (
    <div className="dashboard-container">
      <PageHeader
        compact
        icon="📊"
        title={scope ? scope.label : mode === 'invoices' ? 'All documents' : 'Dashboard'}
        subtitle={scope ? scope.blurb : mode === 'invoices' ? 'Every invoice, quotation and credit note' : 'Overview of your invoices'}
        meta={scope ? `${bills.length} ${scope.singular.toLowerCase()}${bills.length === 1 ? '' : 's'}` : `${bills.length} invoice${bills.length === 1 ? '' : 's'}`}>
        <HelpButton title="Dashboard — how to use" doc="dashboard">
          <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
            <li><strong>New Invoice</strong> — start a fresh tax invoice / proforma / credit note / bill of supply / delivery challan.</li>
            <li><strong>Filter row</strong> — search by client name or invoice number; filter by financial year, type, status and date range. <strong>Columns</strong> picks what the list shows.</li>
            <li><strong>Row actions</strong> — 👁 View shows the invoice as it prints without opening the editor; Edit, ₹ Payment (records a payment and prints a receipt) and Convert sit beside it. The <strong>⋯</strong> menu has Duplicate, Print, WhatsApp, reminder, Email and Cancel. Cancelling keeps the invoice number but takes it out of totals and GST returns; undo it from the status dropdown.</li>
            <li><strong>WhatsApp share — mobile vs. desktop:</strong> on Android / iPhone the PDF attaches automatically via the OS share sheet (works with WhatsApp, Signal, Telegram, anywhere). On desktop, browsers block sending files to WhatsApp Web for security — we fall back to a text-only message with all invoice details. To send the PDF from desktop: open the invoice, click Save &amp; Download, then drag the file into WhatsApp Web.</li>
            <li><strong>Bulk actions</strong> — tick rows to mark them paid / unpaid / overdue, export them, combine them into one PDF, or cancel them. <strong>Quick print</strong> combines the filtered list into one PDF.</li>
            <li><strong>Overdue banner</strong> — click it to jump to overdue invoices with one tap.</li>
            <li><strong>Low-stock alert</strong> — appears when any product is at or below your threshold (Settings → Stock alert).</li>
          </ul>
        </HelpButton>
        {(!scope || scope.id === 'sales-invoices') && <BulkCsvImport kind="sales" onDone={() => loadBills()} />}
        <button className="btn btn-primary" onClick={newDoc}><Plus size={18} /> {scope ? `New ${scope.singular}` : 'New Invoice'}</button>
      </PageHeader>

      {/* The home page shows the getting-started checklist, alerts and totals above the list; the Invoices page is the list alone. */}
      {mode === 'home' && (
        <HomePanel
          startedSteps={startedSteps}
          onDismissGuide={dismissGuide}
          overdueBills={overdueBills}
          overdueStr={overdueStr}
          setStatusFilter={setStatusFilter}
          showRemindAll={showRemindAll}
          setShowRemindAll={setShowRemindAll}
          getClientPhone={getClientPhone}
          sendReminder={sendReminder}
          stats={stats}
          lowStockProducts={lowStockProducts}
          onOpenProducts={onOpenProducts}
          onOpenGuide={onOpenGuide}
        />
      )}

      {scope && <ScopeSummary scope={scope} bills={bills} />}

      <InvoiceTable
        scope={scope}
        onBillChanged={() => loadBills()}
        tracksPayments={tracksPayments}
        bills={bills}
        bulkBusy={bulkBusy}
        bulkCancel={bulkCancel}
        bulkExportJSON={bulkExportJSON}
        bulkExportPDF={bulkExportPDF}
        bulkMarkStatus={bulkMarkStatus}
        bulkPrintByFilter={bulkPrintByFilter}
        changeStatus={changeStatus}
        clearFilters={clearFilters}
        clearSelection={clearSelection}
        dateFrom={dateFrom}
        dateTo={dateTo}
        filtered={filtered}
        fyFilter={fyFilter}
        fyOptions={fyOptions}
        getClientPhone={getClientPhone}
        handleCancelInvoice={handleCancelInvoice}
        handleView={handleView}
        hasFilters={hasFilters}
        onConvert={onConvert}
        onDuplicate={onDuplicate}
        onNew={newDoc}
        onPrint={onPrint}
        openPaymentModal={openPaymentModal}
        search={search}
        selectedIds={selectedIds}
        sendReminder={sendReminder}
        setDateFrom={setDateFrom}
        setDateTo={setDateTo}
        setFyFilter={setFyFilter}
        setSearch={setSearch}
        setShowColumnPicker={setShowColumnPicker}
        setStatusFilter={setStatusFilter}
        setTypeFilter={setTypeFilter}
        setViewBill={setViewBill}
        setVisibleColumns={setVisibleColumns}
        shareEmail={shareEmail}
        shareWhatsApp={shareWhatsApp}
        showColumnPicker={showColumnPicker}
        statusFilter={statusFilter}
        toggleSelect={toggleSelect}
        toggleSelectAllVisible={toggleSelectAllVisible}
        typeFilter={typeFilter}
        undoCancel={undoCancel}
        visibleColumns={visibleColumns}
      />

      {/* S6 — paged list: fetch the next 50 invoices with the stored cursor.
          The button only appears while the server says there is another page. */}
      {paged && nextCursor && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '0.75rem 0 1.5rem' }}>
          <button className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Load 50 more invoices (showing ${bills.length})`}
          </button>
        </div>
      )}

      {/* v1.10.80 (#100) - View: the invoice as it prints, without opening the editor. */}
      {viewBill?.data && (
        <PrintPreviewModal
          isOpen
          onClose={() => setViewBill(null)}
          onPrint={() => onPrint(viewBill)}
          cancelled={isCancelledBill(viewBill)}
          profile={viewBill.data.profile}
          client={viewBill.data.client || {}}
          details={viewBill.data.details || {}}
          items={viewBill.data.items || []}
          totals={viewBill.data.totals || {}}
          invoiceType={viewBill.invoiceType || viewBill.data.invoiceType || 'tax-invoice'}
          customTerms={viewBill.data.customTerms}
          customNotes={viewBill.data.customNotes}
          extraSections={viewBill.data.extraSections || []}
          invoiceOptions={viewBill.data.invoiceOptions || {}}
        />
      )}

      {/* Payment / edit-payment / receipt modals (state + handlers in usePaymentActions). */}
      <PaymentModals
        paymentModal={payment.paymentModal}
        setPaymentModal={payment.setPaymentModal}
        paymentInput={payment.paymentInput}
        setPaymentInput={payment.setPaymentInput}
        recordPayment={payment.recordPayment}
        openReceiptFor={payment.openReceiptFor}
        editPaymentAt={payment.editPaymentAt}
        deletePaymentAt={payment.deletePaymentAt}
        editPaymentModal={payment.editPaymentModal}
        setEditPaymentModal={payment.setEditPaymentModal}
        saveEditedPayment={payment.saveEditedPayment}
        receiptTarget={payment.receiptTarget}
        setReceiptTarget={payment.setReceiptTarget}
      />
    </div>
  );
}
