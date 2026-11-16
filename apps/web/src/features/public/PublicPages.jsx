import { useState } from 'react';
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
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
];

function Frame({ title, intro, children, path }) {
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

const PAGES = { '/pricing': PricingPage, '/privacy': PrivacyPage, '/terms': TermsPage };

/** The page for a public address (app/providers.tsx draws it outside the sign-in gate). */
export default function PublicPages({ path }) {
  const Page = PAGES[path] ?? PricingPage;
  return <Page />;
}
