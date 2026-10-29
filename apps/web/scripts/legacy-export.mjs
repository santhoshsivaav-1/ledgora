// Turns the data/ folder of the old single-user app (JSON files on this computer) into ONE backup file you can import
// into your Ledgora account: sign in, then Settings > Data > Import (or the optional step at the end of first-run setup).
//
//   node apps/web/scripts/legacy-export.mjs [path-to-data-folder] > my-backup.json      (default: ./data)
//
// It only reads; nothing in the folder is changed.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || 'data');
if (!existsSync(dir)) {
  console.error(`No folder at ${dir}. Pass the path of the old app's data folder.`);
  process.exit(1);
}
const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const readAll = (name) => {
  const folder = path.join(dir, name);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(folder, f), null))
    .filter(Boolean);
};

const meta = readJson(path.join(dir, 'meta.json'), {});
delete meta.appLock; // the old PIN hash never travels
const backup = {
  __freegstbill_backup: true,
  exportedAt: new Date().toISOString(),
  bills: readAll('bills'),
  profile: readJson(path.join(dir, 'profile.json'), null),
  profiles: readAll('profiles'),
  clients: readAll('clients'),
  termsTemplates: readAll('templates'),
  products: readAll('products'),
  expenses: readAll('expenses'),
  recurring: readAll('recurring'),
  receipts: readAll('receipts'),
  purchases: readAll('purchases'),
  meta,
};
process.stdout.write(JSON.stringify(backup));
console.error(
  `Read ${backup.bills.length} invoices, ${backup.clients.length} clients, ${backup.products.length} products, ` +
    `${backup.purchases.length} purchases, ${backup.expenses.length} expenses from ${dir}.`,
);
