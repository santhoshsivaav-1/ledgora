import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import ReportShell from '../../components/ui/ReportShell';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { apiClient } from '../../lib/apiClient';
import { listBusinesses } from '../../lib/data/accounting';
import { cashbankSettings, listBankAccounts, listLoans } from '../../lib/data/cashbank';
import { getPrefs, noteRecent } from '../../lib/data/reports';
import {
  CLIENT_REPORTS,
  columnsFromRows,
  genericDefinition,
  reportDefinition,
  runServerReport,
} from './definitions';
import { specDefinition } from './serverSpecs';
import EwayRecorder from './EwayRecorder';
import ReportTools from './ReportTools';

// Vyapar parity P6-S1: one page for every report, /reports/:reportId. It loads what the definition needs (the business,
// and for some reports its parties, items, groups, banks or loans), then hands the definition to ReportShell. Beside
// Export sit the star, saved views, the full CSV and the e-mail schedule (P6-S8). A server report with no definition on
// the web still opens: its columns come from the rows it returns.

const EMPTY_PREFS = { favourites: [], recent: [], views: [] };
const list = (p) => p.then((r) => r.data ?? r).catch(() => []);

/** One screen per report: keyed by its id, so opening another report starts clean. */
export default function ReportPage() {
  const { reportId } = useParams();
  return <ReportScreen key={reportId} reportId={reportId} />;
}

function ReportScreen({ reportId }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(EMPTY_PREFS);
  const [view, setView] = useState({ params: null, nonce: 0 });
  const params = useRef({});

  useEffect(() => {
    let live = true;
    (async () => {
      const b = await listBusinesses();
      const biz = b[0];
      if (!biz)
        return { kind: 'empty', title: 'No business yet', hint: 'Create a business first.' };
      const businessId = biz.id;
      const catalog = (await apiClient.get('/v1/reports')).data;
      const server = catalog.find((r) => r.id === reportId);
      const meta = server ?? CLIENT_REPORTS.find((r) => r.id === reportId);
      if (!meta)
        return { kind: 'empty', title: 'No such report', hint: 'Choose a report from Reports.' };
      if (meta.allowed === false)
        return {
          kind: 'empty',
          title: 'Not for your role',
          hint: 'Profit reports are hidden for your role. Ask the owner.',
        };
      const ctx = { businessId };
      if (meta.needs === 'cashbank') {
        if (!(await cashbankSettings(businessId)).enabled)
          return {
            kind: 'empty',
            title: 'Cash & Bank is off',
            hint: 'Turn on Cash & Bank to see bank, loan and cheque reports.',
          };
        [ctx.banks, ctx.loans] = await Promise.all([
          listBankAccounts(businessId, true),
          listLoans(businessId),
        ]);
      }
      [ctx.parties, ctx.items, ctx.groups, ctx.categories] = await Promise.all([
        list(apiClient.get('/v1/parties?limit=200')),
        list(apiClient.get('/v1/items?limit=200')),
        list(apiClient.get('/v1/party-groups')),
        list(apiClient.get('/v1/expense-categories?kind=expense')),
      ]);
      let def = reportDefinition(reportId, ctx) ?? specDefinition(meta, ctx);
      if (!def) {
        def = genericDefinition(meta, ctx);
        def.columns = columnsFromRows((await runServerReport(reportId, businessId, {})).rows);
      }
      return {
        kind: 'report',
        def,
        title: meta.title,
        server: !!server,
        businessId,
        businessLine: [biz.name, biz.gstin && `GSTIN ${biz.gstin}`].filter(Boolean).join(' · '),
      };
    })()
      .then((s) => live && setState(s))
      .catch((e) => live && setError(e));
    getPrefs()
      .then((p) => live && setPrefs(p))
      .catch(() => {});
    noteRecent(reportId).catch(() => {});
    return () => {
      live = false;
    };
  }, [reportId]);

  const getParams = useCallback(() => params.current, []);
  if (error)
    return (
      <ErrorState
        message={error?.body?.error?.message || error.message}
        onRetry={() => window.location.reload()}
      />
    );
  if (!state) return <LoadingState label="Opening the report…" />;
  if (state.kind === 'empty') return <EmptyState title={state.title} hint={state.hint} />;
  return (
    <div className="dashboard-container">
      {reportId === 'eway-register' && (
        <EwayRecorder
          businessId={state.businessId}
          onSaved={() => setView((v) => ({ ...v, nonce: v.nonce + 1 }))}
        />
      )}
      <ReportShell
        key={`${reportId}:${view.nonce}`}
        def={state.def}
        initial={view.params}
        onParams={(p) => {
          params.current = p;
        }}
        businessLine={state.businessLine}
        breadcrumb={[{ label: 'Reports', to: '/reports' }, { label: state.title }]}
        headerExtra={
          <ReportTools
            reportId={reportId}
            businessId={state.businessId}
            server={state.server}
            prefs={prefs}
            onPrefs={setPrefs}
            getParams={getParams}
            onApplyView={(v) => setView((cur) => ({ params: v.params, nonce: cur.nonce + 1 }))}
          />
        }
      />
    </div>
  );
}
