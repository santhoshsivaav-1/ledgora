import { useState } from 'react';
import {
  AlertTriangle, ArrowRight, BarChart3, BookOpen, Calculator, Check, ChevronDown, FileText, Landmark, Minus, Package,
  Receipt, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Users, Clock,
} from 'lucide-react';
import { FEATURES, PLANS, TRIAL_DAYS } from '@ledgora/contracts';
import PlanMatrix from '../billing/PlanMatrix';
import { inr } from '../billing/planFormat';
import { COMPANY } from '../../config/company';
import {
  AUDIENCES, COMPARE_COLUMNS, COMPARE_LEGEND, COMPARE_ROWS, DIFFERENT, FAQ, MODULES, STATS, STEPS, TRUST,
} from './content';
import './landing.css';

// The page at / for anyone who is not signed in. Its calls to action go to /signup and /login (features/auth/LoginScreen.jsx).
// Everything it says is in content.js; prices and plan features come from the plan catalogue, so this page can not disagree with
// what an account actually gets.

const ICONS = {
  receipt: Receipt, cart: ShoppingCart, bag: ShoppingBag, box: Package, bank: Landmark, book: BookOpen, file: FileText,
  calc: Calculator, chart: BarChart3, spark: Sparkles, people: Users, shield: ShieldCheck,
};
const NAV = [['features', 'Features'], ['different', 'Why Ledgora'], ['compare', 'Compare'], ['pricing', 'Pricing'], ['faq', 'FAQ']];
const FREE_CORE = [
  'GST invoices, quotations, challans and credit notes',
  'Parties, items, stock and purchases',
  'Expenses, GST returns and reports',
  'Download your data any time',
];

function Proof({ title, rows }) {
  return (
    <figure className="lp-proof" aria-label={title}>
      <figcaption>{title}</figcaption>
      <ul>
        {rows.map(([code, text, state]) => (
          <li key={code} data-state={state}>
            <span className="lp-proof-icon" aria-hidden="true">{state === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />}</span>
            <b>{code}</b>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function Flow({ steps }) {
  return (
    <ol className="lp-flow" aria-label="From invoices to your return">
      {steps.map((s, i) => (
        <li key={s}>
          <span>{s}</span>
          {i < steps.length - 1 && <ArrowRight size={16} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function Mark({ value }) {
  const label = COMPARE_LEGEND[value];
  return (
    <span className={`lp-mark lp-mark-${value}`} title={label}>
      {value === 'yes' && <Check size={16} aria-hidden="true" />}
      {value === 'no' && <Minus size={16} aria-hidden="true" />}
      {value === 'part' && <span aria-hidden="true">Varies</span>}
      {value === 'soon' && <><Clock size={14} aria-hidden="true" /><span aria-hidden="true">Roadmap</span></>}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Pricing() {
  const [interval, setInterval] = useState('year');
  const lines = PLANS.map((p, i) => {
    if (p.id === 'free') return FREE_CORE;
    const before = new Set(PLANS[i - 1].features);
    return p.features.filter((f) => !before.has(f)).map((f) => FEATURES.find((x) => x.id === f)?.label).filter(Boolean);
  });
  return (
    <section id="pricing" className="lp-section" aria-labelledby="lp-pricing-h">
      <div className="lp-wrap">
        <h2 id="lp-pricing-h">Simple pricing, in rupees</h2>
        <p className="lp-lead">Try every feature free for {TRIAL_DAYS} days, no card needed. Then pick a plan or stay on Free. Prices exclude GST.</p>
        <div role="radiogroup" aria-label="Billing period" className="lp-toggle">
          {[['month', 'Monthly'], ['year', 'Yearly, about 2 months free']].map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={interval === v} onClick={() => setInterval(v)}>{l}</button>
          ))}
        </div>
        <div className="lp-plans">
          {PLANS.map((p, i) => {
            const price = interval === 'year' ? p.priceYearly : p.priceMonthly;
            return (
              <article key={p.id} className={`lp-plan${p.id === 'silver' ? ' lp-plan-hot' : ''}`}>
                {p.id === 'silver' && <span className="lp-plan-flag">Most chosen by small shops</span>}
                <h3>{p.name}</h3>
                <p className="lp-price">{price ? inr(price) : '₹0'}<small>{price ? ` / ${interval === 'year' ? 'year' : 'month'}` : ' forever'}</small></p>
                <p className="lp-plan-blurb">{p.blurb}</p>
                <p className="lp-limits">
                  {p.limits.businesses} business{p.limits.businesses > 1 ? 'es' : ''} · {p.limits.users} user{p.limits.users > 1 ? 's' : ''} ·{' '}
                  {p.limits.docsPerMonth === null ? 'unlimited' : p.limits.docsPerMonth} sale documents a month
                </p>
                <p className="lp-plan-incl">{i === 0 ? 'Includes' : `Everything in ${PLANS[i - 1].name}, plus`}</p>
                <ul>{lines[i].map((l) => <li key={l}><Check size={15} aria-hidden="true" />{l}</li>)}</ul>
                <a className={`lp-btn ${p.id === 'silver' ? 'lp-btn-primary' : 'lp-btn-line'}`} href="/signup">
                  {p.id === 'free' ? 'Start free' : `Try ${p.name} free for ${TRIAL_DAYS} days`}
                </a>
              </article>
            );
          })}
        </div>
        <details className="lp-matrix">
          <summary>Compare every feature, plan by plan <ChevronDown size={16} aria-hidden="true" /></summary>
          <PlanMatrix plans={PLANS} features={FEATURES} interval={interval} choosable={false} />
        </details>
        <p className="lp-fine">Your data stays readable on every plan and you can download it at any time.</p>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <a className="lp-brand" href="/">{COMPANY.name}</a>
          <nav aria-label="Sections">
            {NAV.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
          <div className="lp-nav-cta">
            <a className="lp-btn lp-btn-quiet" href="/login">Sign in</a>
            <a className="lp-btn lp-btn-primary" href="/signup">Start free trial</a>
          </div>
        </div>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="lp-h1">
          <div className="lp-wrap lp-hero-in">
            <div>
              <p className="lp-kicker">GST billing, accounting and tax in one place</p>
              <h1 id="lp-h1">Bill, keep the books, and file returns that are right the first time</h1>
              <p className="lp-lead lp-lead-big">
                Invoices, stock, bank and ledger for your business, and GST and income-tax returns built from them, checked against the
                government&rsquo;s own rules, and reviewed by your CA on the same data.
              </p>
              <div className="lp-hero-cta">
                <a className="lp-btn lp-btn-primary lp-btn-big" href="/signup">Start your {TRIAL_DAYS}-day free trial <ArrowRight size={18} aria-hidden="true" /></a>
                <a className="lp-btn lp-btn-line lp-btn-big" href="#features">See what is inside</a>
              </div>
              <ul className="lp-assure">
                <li><Check size={15} aria-hidden="true" /> No card needed</li>
                <li><Check size={15} aria-hidden="true" /> A Free plan that stays free</li>
                <li><Check size={15} aria-hidden="true" /> Download your data any time</li>
              </ul>
            </div>
            <figure className="lp-hero-card" aria-label="A return being checked">
              <figcaption>GSTR-3B · October · ready for your CA</figcaption>
              <dl>
                <div><dt>Outward taxable supplies</dt><dd>₹12,48,000</dd></div>
                <div><dt>Output tax</dt><dd>₹2,24,640</dd></div>
                <div><dt>Eligible input credit</dt><dd>₹1,61,200</dd></div>
                <div className="lp-hero-total"><dt>Net tax to pay</dt><dd>₹63,440</dd></div>
              </dl>
              <ul>
                <li data-state="ok"><Check size={14} aria-hidden="true" /> Matches your GSTR-1 and the ledger</li>
                <li data-state="ok"><Check size={14} aria-hidden="true" /> Checked against the portal&rsquo;s JSON rules</li>
                <li data-state="warn"><AlertTriangle size={14} aria-hidden="true" /> 2 items have no HSN code. Fix before filing</li>
              </ul>
              <p className="lp-hero-note">An example of how a return looks before you file it.</p>
            </figure>
          </div>
        </section>

        <section className="lp-stats" aria-label="At a glance">
          <div className="lp-wrap lp-stats-in">
            {STATS.map(([n, t]) => (
              <div key={n}><b>{n}</b><span>{t}</span></div>
            ))}
          </div>
        </section>

        <section id="features" className="lp-section" aria-labelledby="lp-features-h">
          <div className="lp-wrap">
            <h2 id="lp-features-h">Everything a small business runs on, in one place</h2>
            <p className="lp-lead">Twelve areas that share one set of books, so a bill you raise today is already in your stock, your ledger, your GST return and your tax.</p>
            <div className="lp-modules">
              {MODULES.map((m) => {
                const Icon = ICONS[m.icon];
                return (
                  <article key={m.id} id={`m-${m.id}`} className="lp-module">
                    <h3><span className="lp-icon" aria-hidden="true"><Icon size={20} /></span>{m.title}</h3>
                    <p className="lp-module-blurb">{m.blurb}</p>
                    <ul>{m.points.map((p) => <li key={p}><Check size={14} aria-hidden="true" />{p}</li>)}</ul>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="different" className="lp-section lp-alt" aria-labelledby="lp-diff-h">
          <div className="lp-wrap">
            <h2 id="lp-diff-h">Where Ledgora is different</h2>
            <p className="lp-lead">Most billing apps stop at the invoice. We carry on to the return, and make sure it is right.</p>
            {DIFFERENT.map((d, i) => (
              <article key={d.id} id={`d-${d.id}`} className={`lp-diff${i % 2 ? ' lp-diff-flip' : ''}`}>
                <div>
                  <p className="lp-kicker">{d.kicker}</p>
                  <h3>{d.title}</h3>
                  <p>{d.body}</p>
                  {d.bullets && <ul className="lp-bullets">{d.bullets.map((b) => <li key={b}><Check size={15} aria-hidden="true" />{b}</li>)}</ul>}
                </div>
                {d.proof && <Proof {...d.proof} />}
                {d.flow && <Flow steps={d.flow} />}
                {d.bullets && !d.proof && !d.flow && (
                  <div className="lp-trust" aria-label="Security">
                    {TRUST.map(([t, x]) => <div key={t}><ShieldCheck size={18} aria-hidden="true" /><b>{t}</b><span>{x}</span></div>)}
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="lp-section" aria-labelledby="lp-how-h">
          <div className="lp-wrap">
            <h2 id="lp-how-h">From sign-up to a filed return</h2>
            <ol className="lp-steps">
              {STEPS.map(([t, x], i) => <li key={t}><span className="lp-step-n" aria-hidden="true">{i + 1}</span><h3>{t}</h3><p>{x}</p></li>)}
            </ol>
          </div>
        </section>

        <section id="who" className="lp-section lp-alt" aria-labelledby="lp-who-h">
          <div className="lp-wrap">
            <h2 id="lp-who-h">Built for how Indian businesses actually work</h2>
            <div className="lp-who">
              {AUDIENCES.map(([t, x]) => <article key={t}><h3>{t}</h3><p>{x}</p></article>)}
            </div>
          </div>
        </section>

        <section id="compare" className="lp-section" aria-labelledby="lp-compare-h">
          <div className="lp-wrap">
            <h2 id="lp-compare-h">How Ledgora compares</h2>
            <p className="lp-lead">An honest look, including what we do not have yet. Columns are kinds of product, not a verdict on any one of them.</p>
            <div className="lp-table-wrap" role="region" aria-label="Comparison table" tabIndex={0}>
              <table className="lp-compare">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">Capability</span></th>
                    {COMPARE_COLUMNS.map((c) => (
                      <th key={c.id} scope="col" className={c.id === 'us' ? 'lp-us' : ''}>
                        {c.name}{c.hint && <small>{c.hint}</small>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map(([label, ...vals]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {vals.map((v, i) => <td key={COMPARE_COLUMNS[i].id} className={i === 0 ? 'lp-us' : ''}><Mark value={v} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="lp-fine">
              Based on publicly listed features in November 2026. Products change, so check each vendor before you decide. &ldquo;Varies&rdquo;
              means it depends on the product and the plan; &ldquo;Roadmap&rdquo; means we do not offer it yet.
            </p>
          </div>
        </section>

        <Pricing />

        <section id="faq" className="lp-section lp-alt" aria-labelledby="lp-faq-h">
          <div className="lp-wrap lp-faq">
            <h2 id="lp-faq-h">Questions people ask</h2>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}<ChevronDown size={18} aria-hidden="true" /></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final" aria-labelledby="lp-final-h">
          <div className="lp-wrap">
            <h2 id="lp-final-h">Start with your next invoice</h2>
            <p>Set up in about three minutes. Every feature free for {TRIAL_DAYS} days, no card needed.</p>
            <a className="lp-btn lp-btn-light lp-btn-big" href="/signup">Start your free trial <ArrowRight size={18} aria-hidden="true" /></a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div><a className="lp-brand" href="/">{COMPANY.name}</a><p>GST billing, books and tax for Indian businesses.</p></div>
          <nav aria-label="Product">
            <b>Product</b>
            {NAV.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
          </nav>
          <nav aria-label="Company">
            <b>Account</b>
            <a href="/login">Sign in</a>
            <a href="/signup">Start free trial</a>
            <a href="/pricing">Pricing</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>
        <p className="lp-fine lp-wrap">The software prepares returns and does not file them for you. Nothing here is tax or legal advice.</p>
      </footer>
    </div>
  );
}
