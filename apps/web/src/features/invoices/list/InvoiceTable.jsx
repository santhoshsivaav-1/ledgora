import { STATUS_CONFIG } from './statusConfig';
import { FileText, Plus, IndianRupee, Edit3, Search, Copy, X, CheckCircle, Clock, AlertTriangle, MessageCircle, Mail, StickyNote, Send, Download, Printer, Ban, Undo2, Eye } from 'lucide-react';
import { formatCurrency, INVOICE_TYPES, isCancelledBill, SALES_INVOICE_TYPES, amountDue } from '../../../utils';
import ActionsMenu from './ActionsMenu';

// The invoice list (change 3.10): the filters, the quick-print and bulk actions, and the table with its row actions.
// The Dashboard and the Invoices page both show it. It only draws; the page that holds it owns the data and the handlers.
export default function InvoiceTable({
  bills, bulkBusy, bulkCancel, bulkExportJSON, bulkExportPDF, bulkMarkStatus, bulkPrintByFilter, changeStatus, clearFilters, clearSelection, dateFrom, dateTo, filtered, fyFilter, fyOptions, getClientPhone, handleCancelInvoice, handleView, hasFilters, onConvert, onDuplicate, onNew, onPrint, openPaymentModal, search, selectedIds, sendReminder, setDateFrom, setDateTo, setFyFilter, setSearch, setShowColumnPicker, setStatusFilter, setTypeFilter, setViewBill, setVisibleColumns, shareEmail, shareWhatsApp, showColumnPicker, statusFilter, toggleSelect, toggleSelectAllVisible, typeFilter, undoCancel, visibleColumns,
}) {
  return (
        <div className="glass-panel">
          <div className="table-header"><h3>Invoices</h3></div>
          <div className="filters-bar">
            <div className="search-box">
              <Search size={16} className="search-icon" />
              <input type="text" placeholder="Search client or invoice..." value={search}
                onChange={e => setSearch(e.target.value)} className="search-input" />
            </div>
            <select className="filter-select" value={fyFilter} onChange={e => setFyFilter(e.target.value)}>
              <option value="all">All Years</option>
              {fyOptions.map(fy => <option key={fy.value} value={fy.value}>{fy.label}</option>)}
            </select>
            <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              {Object.entries(INVOICE_TYPES).map(([key, val]) => <option key={key} value={key}>{val.label}</option>)}
            </select>
            <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">All Status</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              {/* v1.10.74 - rows can be Cancelled, so the filter needs it too */}
              <option value="cancelled">Cancelled</option>
            </select>
            <input type="date" className="filter-date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From" />
            <input type="date" className="filter-date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To" />
            {hasFilters && <button className="icon-btn icon-btn-red" onClick={clearFilters} title="Clear" aria-label="Clear filters"><X size={15} /></button>}
            <button type="button" className="btn btn-secondary" onClick={() => setShowColumnPicker(v => !v)}
              title="Choose which columns to show" aria-label="Column picker"
              style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '0.4rem 0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
              <FileText size={15} /> Columns
            </button>
          </div>

          {/* v1.9.4 — column picker popover */}
          {showColumnPicker && (
            <div style={{
              padding: '0.75rem 1rem', margin: '0.5rem 0',
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
            }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Pick columns to show
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {[
                  ['date', 'Date'], ['invoice', 'Invoice #'], ['type', 'Type'],
                  ['client', 'Client'], ['amount', 'Amount'], ['currency', 'Currency'],
                  ['status', 'Status'], ['dueDate', 'Due date'],
                  ['printed', 'Print count'], ['actions', 'Actions'],
                ].map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!visibleColumns[key]}
                      onChange={e => setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                      style={{ width: 14, height: 14, accentColor: 'var(--primary)' }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* v1.9.1 — Quick bulk-print filters. One-click "print everything
               matching X" without needing to manually tick rows. Useful for
               month-end filing, wholesale reminders, CA handoffs. */}
          <div style={{
            padding: '0.5rem 0.85rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap',
            alignItems: 'center', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Quick print:
            </span>
            <button type="button" className="btn btn-secondary" disabled={bulkBusy}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
              onClick={() => bulkPrintByFilter('all')}
              title="Combine all filtered invoices into one PDF">
              <Download size={12} /> All shown ({filtered.length})
            </button>
            <button type="button" className="btn btn-secondary" disabled={bulkBusy}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
              onClick={() => bulkPrintByFilter('unpaid')}
              title="Only invoices marked Unpaid (not Partial or Overdue)">
              {/* v1.10.74 - label says "only": Partial and Overdue are not included */}
              <Clock size={12} /> Unpaid only ({filtered.filter(b => (b.status || 'unpaid') === 'unpaid').length})
            </button>
            <button type="button" className="btn btn-secondary" disabled={bulkBusy}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
              onClick={() => bulkPrintByFilter('overdue')}>
              <AlertTriangle size={12} /> Overdue ({filtered.filter(b => b.status === 'overdue').length})
            </button>
            <button type="button" className="btn btn-secondary" disabled={bulkBusy}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
              onClick={() => bulkPrintByFilter('paid')}>
              <CheckCircle size={12} /> Paid ({filtered.filter(b => b.status === 'paid').length})
            </button>
          </div>

          {/* Bulk-action toolbar — only renders when at least one row is ticked. */}
          {selectedIds.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
              padding: '0.6rem 0.85rem', marginBottom: '0.6rem',
              background: 'var(--info-bg)', border: '1px solid var(--info-border)',
              borderRadius: '8px', color: 'var(--info-text)',
            }}>
              <strong style={{ fontSize: '0.88rem' }}>{selectedIds.size} selected</strong>
              <button type="button" className="btn btn-secondary" disabled={bulkBusy} onClick={() => bulkMarkStatus('paid')}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}><CheckCircle size={13} /> Mark paid</button>
              <button type="button" className="btn btn-secondary" disabled={bulkBusy} onClick={() => bulkMarkStatus('unpaid')}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}><Clock size={13} /> Mark unpaid</button>
              <button type="button" className="btn btn-secondary" disabled={bulkBusy} onClick={() => bulkMarkStatus('overdue')}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}><AlertTriangle size={13} /> Mark overdue</button>
              <button type="button" className="btn btn-secondary" disabled={bulkBusy} onClick={bulkExportJSON}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}><FileText size={13} /> Export JSON</button>
              <button type="button" className="btn btn-secondary" disabled={bulkBusy} onClick={() => bulkExportPDF()}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} title="Combine selected invoices into one multi-page PDF — CAs love this for filing archives"><Download size={13} /> Bulk PDF</button>
              {/* v1.10.7 — Cancel button for the in-flight bulk export. The
                   underlying abort flag was wired in v1.10.3; this is the
                   UI surface promised by that changelog. Setting the flag
                   stops the export loop after the current invoice, so
                   whatever's already assembled still gets saved. */}
              {bulkBusy && (
                <button type="button" className="btn btn-secondary"
                  onClick={() => { window.__fgsbBulkAbort = true; }}
                  style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--warn-text)', borderColor: 'var(--warn-border)' }}
                  title="Stop the bulk export after the current invoice — partial results still get saved."><X size={13} /> Cancel</button>
              )}
              <button type="button" className="btn btn-secondary" disabled={bulkBusy} onClick={bulkCancel}
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                <Ban size={13} /> Cancel invoices
              </button>
              <button type="button" className="icon-btn" onClick={clearSelection} title="Clear selection" style={{ marginLeft: 'auto' }}>
                <X size={14} />
              </button>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="empty-state">
              <FileText size={48} />
              <p>{bills.length === 0 ? 'No invoices yet.' : 'No invoices match your filters.'}</p>
              {bills.length === 0 && <button className="btn btn-primary" onClick={onNew}><Plus size={18} /> Create Invoice</button>}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '32px', padding: '0.5rem 0.25rem 0.5rem 0.75rem' }}>
                      <input type="checkbox"
                        checked={filtered.length > 0 && filtered.every(b => selectedIds.has(b.id))}
                        onChange={toggleSelectAllVisible}
                        title="Select all visible"
                        style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                    </th>
                    {visibleColumns.date && <th>Date</th>}
                    {visibleColumns.invoice && <th>Invoice No.</th>}
                    {visibleColumns.type && <th className="col-center">Type</th>}
                    {visibleColumns.client && <th>Client</th>}
                    {visibleColumns.amount && <th>Amount</th>}
                    {visibleColumns.currency && <th>Currency</th>}
                    {visibleColumns.dueDate && <th>Due Date</th>}
                    {visibleColumns.printed && <th>Printed</th>}
                    <th className="col-center">Paid</th>
                    {visibleColumns.status && <th className="col-center">Status</th>}
                    {visibleColumns.actions && <th className="col-center">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(bill => {
                    const status = bill.status || 'unpaid';
                    const sc = STATUS_CONFIG[status] || STATUS_CONFIG.unpaid;
                    // v1.10.76 (#83) - only real sales get paid, so only they get the
                    // Paid / Unpaid / Partial menu (and can be overdue).
                    const tracksPayment = SALES_INVOICE_TYPES.includes(bill.invoiceType || 'tax-invoice');
                    const readOnly = status === 'cancelled' || !!bill.convertedTo;
                    const isOverdue = tracksPayment && status !== 'paid' && status !== 'cancelled' && bill.data?.details?.dueDate && new Date(bill.data.details.dueDate) < new Date();
                    const daysOverdue = isOverdue ? Math.floor((new Date() - new Date(bill.data.details.dueDate)) / 86400000) : 0;
                    const billCurrency = bill.currency || bill.data?.invoiceOptions?.currency || 'INR';
                    return (
                      <tr key={bill.id} className={isOverdue || status === 'overdue' ? 'row-overdue' : ''}
                        style={selectedIds.has(bill.id) ? { background: 'var(--info-bg)' } : undefined}>
                        <td style={{ padding: '0.5rem 0.25rem 0.5rem 0.75rem' }}>
                          <input type="checkbox" checked={selectedIds.has(bill.id)} onChange={() => toggleSelect(bill.id)}
                            style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                        </td>
                        {visibleColumns.date && <td className="text-muted">{new Date(bill.invoiceDate).toLocaleDateString('en-IN')}</td>}
                        {visibleColumns.invoice && <td><span className="invoice-badge">{bill.invoiceNumber}</span></td>}
                        {visibleColumns.type && <td><span className="type-badge">{(INVOICE_TYPES[bill.invoiceType || 'tax-invoice'])?.label}</span></td>}
                        {visibleColumns.client && <td className="font-medium td-client" title={bill.clientName}>
                          {bill.clientName}
                          {bill.data?.internalNote && (
                            <span title={bill.data.internalNote} style={{ marginLeft: 4, cursor: 'help', verticalAlign: 'middle' }}>
                              <StickyNote size={13} style={{ color: '#ca8a04' }} />
                            </span>
                          )}
                        </td>}
                        {visibleColumns.amount && <td className="font-bold">
                          {formatCurrency(bill.totalAmount, billCurrency)}
                          {billCurrency !== 'INR' && !visibleColumns.currency && <span className="currency-chip">{billCurrency}</span>}
                        </td>}
                        {visibleColumns.currency && <td className="text-muted">{billCurrency}</td>}
                        {visibleColumns.dueDate && <td className="text-muted">{bill.data?.details?.dueDate ? new Date(bill.data.details.dueDate).toLocaleDateString('en-IN') : <span className="cell-empty">—</span>}</td>}
                        {visibleColumns.printed && <td className="text-muted" style={{ textAlign: 'center' }}>{Number(bill.printedCount) || 0}×</td>}
                        <td className="text-muted col-center">{(bill.paidAmount || 0) > 0 ? formatCurrency(bill.paidAmount, billCurrency) : <span className="cell-empty">—</span>}</td>
                        {visibleColumns.status && <td className="col-center">
                          {/* v1.10.77 (#86) - a cancelled document is read-only: its status
                              menu is locked, with Undo to bring it back. */}
                          {status === 'cancelled' ? (
                            <span className="type-badge" style={{ background: sc.bg, color: sc.color }}>Cancelled</span>
                          ) : !tracksPayment ? (
                            <span className="type-badge" title={bill.convertedTo ? `Converted to ${bill.convertedTo}` : ''}>
                              {bill.convertedTo ? 'Converted' : bill.invoiceType === 'credit-note' ? 'Issued' : 'Open'}
                            </span>
                          ) : <>
                          <select className="status-select" value={isOverdue && status !== 'overdue' ? 'overdue' : status}
                            style={{ background: sc.bg, color: sc.color, borderColor: sc.color + '44' }}
                            onChange={e => changeStatus(bill, e.target.value)}>
                            {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                              <option key={key} value={key}>{val.label}</option>
                            ))}
                          </select>
                          {daysOverdue > 0 && <span style={{ fontSize: '0.7rem', color: '#dc2626', display: 'block', marginTop: 2 }}>{daysOverdue}d overdue</span>}
                          </>}
                        </td>}
                        {visibleColumns.actions && <td>
                          {/* v1.10.80 (#100) - View (read-only preview) and Edit up front,
                              with Payment, Convert and Undo where they apply; the rest
                              in the ⋯ menu instead of a long row of icons. */}
                          <div className="table-actions" style={{ justifyContent: 'center' }}>
                            {bill.data && (
                              <button className="icon-btn icon-btn-blue" onClick={() => setViewBill(bill)} title="View"
                                aria-label={`View ${bill.invoiceNumber}`}><Eye size={15} /></button>
                            )}
                            {!readOnly && (
                              <button className="icon-btn icon-btn-blue" onClick={() => handleView(bill)} title="Edit"><Edit3 size={15} /></button>
                            )}
                            {status === 'cancelled' && (
                              <button className="icon-btn icon-btn-blue" onClick={() => undoCancel(bill)} title="Undo cancel" aria-label={`Undo cancel of ${bill.invoiceNumber}`}>
                                <Undo2 size={15} />
                              </button>
                            )}
                            {/* Payments on sales; on anything else (cancelled, converted, an
                                advance on a proforma) only to see the history it has. */}
                            {((tracksPayment && !readOnly) || (bill.payments || []).length > 0) && (
                              <button className="icon-btn icon-btn-green" onClick={() => openPaymentModal(bill)}
                                title={tracksPayment && !readOnly ? 'Payment' : 'Payment history'}><IndianRupee size={15} /></button>
                            )}
                            {/* v1.10.76 (#83) - gone once it has been converted (bill.convertedTo) */}
                            {!readOnly && ['quotation', 'proforma', 'delivery-challan'].includes(bill.invoiceType) && !bill.convertedTo && (
                              <button className="icon-btn icon-btn-green" onClick={() => onConvert(bill)} title="Convert to Tax Invoice"><FileText size={15} /></button>
                            )}
                            {/* v1.10.77 (#86) - cancelled and converted documents are read-only:
                                View and Duplicate only (Undo is in the Status column). */}
                            <ActionsMenu label={`More actions for ${bill.invoiceNumber}`} items={[
                              { label: 'Duplicate', icon: Copy, onClick: () => onDuplicate(bill) },
                              { label: 'Print', icon: Printer, onClick: () => onPrint(bill), hidden: readOnly },
                              { label: 'WhatsApp', icon: MessageCircle, tone: 'green', onClick: () => shareWhatsApp(bill), hidden: readOnly,
                                title: 'Share via WhatsApp — PDF attaches on mobile Chrome/Safari. On desktop it sends the invoice as text only (browser can\'t attach files to WhatsApp Web — security limitation, not our app).' },
                              // v1.10.12 — reminder for unpaid, partial and overdue bills.
                              { label: status === 'partial' ? 'Reminder (partial pending)' : 'Send reminder', icon: Send, onClick: () => sendReminder({ ...bill, clientPhone: getClientPhone(bill) }),
                                hidden: readOnly || isCancelledBill(bill) || !(isOverdue || status === 'overdue' || status === 'unpaid' || status === 'partial') || !(amountDue(bill) - (bill.paidAmount || 0) > 0.01) },
                              { label: 'Email', icon: Mail, onClick: () => shareEmail(bill), hidden: readOnly },
                              { label: 'Cancel invoice', icon: Ban, tone: 'danger', onClick: () => handleCancelInvoice(bill), hidden: readOnly,
                                title: 'Cancel invoice — keeps the number; Undo from the Status column' },
                            ]} />
                          </div>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
  );
}
