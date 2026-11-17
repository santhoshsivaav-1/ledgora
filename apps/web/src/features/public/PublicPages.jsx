import { useEffect, useState } from 'react';
import { PLANS, FEATURES, TRIAL_DAYS } from '@ledgora/contracts';
import PlanMatrix from '../billing/PlanMatrix';
import { COMPANY, LEGAL_UPDATED } from '../../config/company';
import './public.css';

// Pages anyone can open without signing in: pricing, privacy policy and terms of use (and so the links on the sign-up form
// land somewhere). They are drawn outside the sign-in gate (app/providers.tsx). Prices come from the same plan catalogue the
// server enforces (packages/contracts/src/plans.ts), so this page can never disagree with what an account gets.

const LINKS = [
  ['/', 'Home'],
  ['/pricing', 'Pricing'],
  ['/security', 'Security'],
  ['/switch', 'Switch to Ledgora'],
  ['/contact', 'Contact'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
];

// Each public page sets its own title and description, so a search result or a shared link says what the page is.
function usePageMeta(title, description) {
  useEffect(() => {
    const before = { title: document.title, desc: document.querySelector('meta[name="description"]')?.getAttribute('content') };
    document.title = `${title} | ${COMPANY.name}`;
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', 'description'); document.head.appendChild(tag); }
    tag.setAttribute('content', description);
    return () => { document.title = before.title; if (before.desc != null) tag.setAttribute('content', before.desc); };
  }, [title, description]);
}

function Frame({ title, intro, children, path, description }) {
  usePageMeta(title, description || intro || title);
  return (
    <div className="pub-shell">
      <header className="pub-head">
        <a className="pub-brand" href="/">{COMPANY.name}</a>
        <nav aria-label="Public pages">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</a>
          ))}
          <a className="pub-signin" href="/login">Sign in</a>
        </nav>
      </header>
      <main className="pub-main">
        <h1>{title}</h1>
        {intro && <p className="pub-intro">{intro}</p>}
        {children}
      </main>
      <footer className="pub-foot">
        {LINKS.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        <span>{COMPANY.name}</span>
      </footer>
    </div>
  );
}

function Contact() {
  return COMPANY.email
    ? <p>Write to <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.</p>
    : <p>Use the contact details of the service provider you signed up with.</p>;
}

export function PricingPage() {
  const [interval, setInterval] = useState('year');
  return (
    <Frame path="/pricing" title="Simple pricing"
      intro={`Try every feature free for ${TRIAL_DAYS} days, no card needed. After that, pick a plan or stay on Free. Prices are in rupees and exclude GST.`}>
      <div role="radiogroup" aria-label="Billing period" className="pub-interval">
        {[['month', 'Monthly'], ['year', 'Yearly (about 2 months free)']].map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={interval === v}
            className={`btn ${interval === v ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setInterval(v)}>{l}</button>
        ))}
      </div>
      <PlanMatrix plans={PLANS} features={FEATURES} interval={interval} choosable={false} />
      <p className="pub-cta"><a className="btn btn-primary" href="/signup">Start your {TRIAL_DAYS}-day free trial</a></p>
      <p className="pub-note">Your data stays readable on every plan, and you can download it at any time.</p>
    </Frame>
  );
}

export function PrivacyPage() {
  return (
    <Frame path="/privacy" title="Privacy policy"
      intro={`How ${COMPANY.name} handles the information you put into it. Last updated ${LEGAL_UPDATED}.`}>
      <h2>What we keep</h2>
      <ul>
        <li><b>Your account:</b> your name, e-mail address and, if you use phone sign-in, your phone number; your sign-in sessions (device, approximate time and address) so you can see and end them.</li>
        <li><b>Your business records:</b> the businesses, parties, items, invoices, purchases, payments, ledger entries, returns and files you create.</li>
        <li><b>Tax identity:</b> if you prepare an income-tax return, your PAN, date of birth, address, Aadhaar number and bank account numbers. Aadhaar and bank account numbers are encrypted with a key tied to your organization; screens show only the last digits.</li>
        <li><b>A change history:</b> an append-only edit log of who changed which accounting record and when, which Indian law expects of books kept on a computer.</li>
      </ul>
      <h2>What we do with it</h2>
      <p>Only what the software needs to work for you: show your records, calculate tax, prepare returns for you to file, send the messages you ask it to send, and keep backups. We do not sell your information and we do not show advertising.</p>
      <h2>Who else handles it</h2>
      <p>Service providers act for us and only for these purposes: the host that runs the servers and database; an e-mail provider and an SMS provider for sign-in codes, invoices and reminders you send; a payment provider if you buy a plan; and Google Drive only if you connect it for backups. Messages you share by WhatsApp are sent from your own device.</p>
      <h2>Cookies and local storage</h2>
      <p>One sign-in cookie that scripts on the page cannot read, and a few settings kept in your browser (such as dark mode and your last-open screen). There are no advertising or tracking cookies.</p>
      <h2>How long we keep it</h2>
      <p>For as long as your account exists. A deleted invoice stays in the Trash for 30 days. You can download your data at any time from Backup &amp; Restore and Settings. When you close your account your records are deleted, except what the law requires us to keep.</p>
      <h2>Your rights</h2>
      <p>Under India&rsquo;s Digital Personal Data Protection Act, 2023 you can ask to see your data, correct it, have it erased, and withdraw consent, and you can complain if we do not deal with a request. Most of this you can do yourself in the app; for anything else:</p>
      <Contact />
      <h2>Security</h2>
      <p>Each organization&rsquo;s data is separated at the database level, access is controlled by roles you set, sign-in can use two-step verification, and sensitive identity numbers are encrypted. No system is perfectly safe; if something affecting your data goes wrong we will tell you.</p>
    </Frame>
  );
}

export function TermsPage() {
  return (
    <Frame path="/terms" title="Terms of use"
      intro={`The rules for using ${COMPANY.name}. By creating an account you agree to them. Last updated ${LEGAL_UPDATED}.`}>
      <h2>Your account</h2>
      <p>You are responsible for what happens under your sign-in, for keeping your password safe, and for giving true information. The person who creates an organization is its owner and decides who else may use it and what each person may do.</p>
      <h2>Your data</h2>
      <p>Your records belong to you. You give us permission to store and process them to run the service. You can export them whenever you like.</p>
      <h2>What the software does and does not do</h2>
      <p>It helps you keep books, raise invoices and prepare return files. It <b>does not file anything for you</b>: you (or your chartered accountant) check each return and file it on the government portal. Tax rules change; the figures are checked against the rules we know of on the date shown on each screen, and you remain responsible for what you file. Nothing here is tax or legal advice.</p>
      <h2>Plans, trial and payment</h2>
      <p>New accounts get a {TRIAL_DAYS}-day trial with every feature. After it ends the account falls back to the Free plan unless you choose a paid one; your data stays readable. Prices are shown before GST. Paid plans renew until you cancel, and a cancelled plan runs to the end of the period paid for.</p>
      <h2>Acceptable use</h2>
      <p>Do not use the service to break the law, to send spam, to attack or overload it, or to look at another organization&rsquo;s data.</p>
      <h2>Availability and liability</h2>
      <p>We work to keep the service running and your data safe, but we cannot promise it will never be interrupted. To the extent the law allows, we are not liable for losses from interruptions or from filings made from figures you did not check.</p>
      <h2>Changes and contact</h2>
      <p>If these terms change in a way that matters, we will tell you in the app before it takes effect.</p>
      <Contact />
    </Frame>
  );
}

const SWITCH = {
  vyapar: {
    name: 'Vyapar',
    steps: [
      ['Export your data from Vyapar', 'In Vyapar, open Reports and export the party list, the item list and the party-wise outstanding as Excel or CSV. Keep your last Tally or Excel backup too.'],
      ['Import parties and items', 'In Ledgora, go to Parties and Items and use Import. Match the columns once; GSTIN, state, opening balance and HSN come across.'],
      ['Bring the opening balances', 'Opening balances for parties, items (stock) and bank are posted straight to the ledger, so your books start where Vyapar left off.'],
      ['Check, then switch', 'Run Verify My Data, compare the receivable and stock totals with Vyapar, and raise your next invoice here. Keep Vyapar read-only for the rest of the year.'],
    ],
  },
  tally: {
    name: 'Tally',
    steps: [
      ['Export masters and balances', 'From Tally, export the ledger list, the stock items and the trial balance as Excel.'],
      ['Import parties and items', 'Import the debtor and creditor ledgers as parties and the stock items as items. Opening balances go to the ledger.'],
      ['Set up the chart of accounts', 'Accounting setup creates a standard chart of accounts; map your Tally groups to it once.'],
      ['Check the trial balance', 'Open the trial balance here and compare it with Tally. You can also export from Ledgora back to Tally if your CA still works in it.'],
    ],
  },
  zoho: {
    name: 'Zoho Books',
    steps: [
      ['Export from Zoho Books', 'Export contacts, items and the opening balances report as CSV.'],
      ['Import contacts and items', 'Contacts become parties and items stay items; GSTIN and place of supply are kept.'],
      ['Post the opening balances', 'Enter the closing balances of your last period as opening balances so the ledger starts correct.'],
      ['Run both for a month, then switch', 'Raise new invoices here, and compare the month-end GST totals with Zoho before you stop using it.'],
    ],
  },
};

export function SwitchPage({ which }) {
  const g = SWITCH[which];
  if (!g) {
    return (
      <Frame path="/switch" title="Switch to Ledgora" intro="Moving from another app takes an afternoon, not a project. Pick where you are coming from.">
        <ul className="pub-cards">
          {Object.entries(SWITCH).map(([k, v]) => <li key={k}><a href={`/switch/${k}`}><b>From {v.name}</b><span>Export, import, check.</span></a></li>)}
        </ul>
        <p className="pub-note">A one-click import straight from other billing apps is on our roadmap. Until then the steps use the files they export.</p>
      </Frame>
    );
  }
  return (
    <Frame path="/switch" title={`Switch from ${g.name} to Ledgora`}
      intro={`Four steps, using the files ${g.name} already exports. Your history stays in ${g.name}; Ledgora starts from the balances you bring.`}>
      <ol className="pub-steps">{g.steps.map(([t, x]) => <li key={t}><h2>{t}</h2><p>{x}</p></li>)}</ol>
      <p className="pub-cta"><a className="btn btn-primary" href="/signup">Start your {TRIAL_DAYS}-day free trial</a></p>
      <p className="pub-note">Not sure about a step? Write to us through the <a href="/contact">contact page</a>.</p>
    </Frame>
  );
}

export function SecurityPage() {
  return (
    <Frame path="/security" title="Security and your data"
      intro="What protects your books, and where they live. Plain statements, no badges we have not earned.">
      <h2>Your organization&rsquo;s data is separated by the database</h2>
      <p>Every row carries your organization, and the database itself refuses to show it to anyone else, even if a request were wrong. This is row-level security, not only application code.</p>
      <h2>Sensitive numbers are encrypted</h2>
      <p>Aadhaar and bank account numbers are sealed with AES-256-GCM using a key tied to your organization and are shown by their last digits only.</p>
      <h2>Sign-in</h2>
      <p>Passwords are hashed, sign-in can use two-step verification, you can see and end your own sessions, and a new device sends you an alert.</p>
      <h2>An edit log nobody can switch off</h2>
      <p>Changes to accounting records are written to an append-only log: who, what, when. Periods you lock stay locked.</p>
      <h2>Backups and exit</h2>
      <p>Encrypted, scheduled backups with an optional copy to your Google Drive; a 30-day trash for deleted records; and a full export at any time. Your data is yours when you leave.</p>
      <h2>Where it runs</h2>
      <p>The application and its database run in one cloud region chosen by the operator of this installation. Ask us for the current region and sub-processors before you sign up if your policy needs them.</p>
      <h2>Reporting a problem</h2>
      <p>If you find a security issue, please tell us through the contact page before telling anyone else, and we will respond quickly.</p>
      <Contact />
    </Frame>
  );
}

export function ContactPage() {
  return (
    <Frame path="/contact" title="Contact" intro="Questions before you start, help while you use it, or a request about your data.">
      <h2>Write to us</h2>
      <Contact />
      <h2>Your data</h2>
      <p>To see, correct or erase your personal data, sign in and use Settings, Data and privacy. We answer within 30 days.</p>
      <h2>Before you sign up</h2>
      <p>The <a href="/pricing">pricing page</a> and the <a href="/switch">switching guides</a> answer most questions.</p>
    </Frame>
  );
}

const PAGES = { '/pricing': PricingPage, '/privacy': PrivacyPage, '/terms': TermsPage, '/security': SecurityPage, '/contact': ContactPage };

/** The page for a public address (app/providers.tsx draws it outside the sign-in gate). */
export default function PublicPages({ path }) {
  const m = /^\/switch(?:\/([a-z]+))?$/.exec(path);
  if (m) return <SwitchPage which={m[1]} />;
  const Page = PAGES[path] ?? PricingPage;
  return <Page />;
}
