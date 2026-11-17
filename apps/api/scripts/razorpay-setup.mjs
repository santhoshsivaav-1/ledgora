// Creates the four Razorpay subscription plans Ledgora sells (Silver and Gold, monthly and yearly) in YOUR Razorpay account and prints
// the RAZORPAY_PLAN_IDS line for your environment. Each plan's amount is the catalogue price plus GST, because the GST invoice splits
// what was charged. Run it once per Razorpay mode (test keys, then live keys): plans are not shared between the two.
//
//   RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx node apps/api/scripts/razorpay-setup.mjs
//   add --dry-run to print what would be created without calling Razorpay.
import { PLANS } from '../../../packages/contracts/src/plans.ts';

const GST = Number(process.env.SELLER_GST_RATE ?? 18);
const dry = process.argv.includes('--dry-run');
const id = process.env.RAZORPAY_KEY_ID;
const secret = process.env.RAZORPAY_KEY_SECRET;
if (!dry && (!id || !secret)) {
  console.error('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (from Razorpay Dashboard, Account & Settings, API keys), or use --dry-run.');
  process.exit(1);
}
const paise = (rupees) => Math.round(rupees * (1 + GST / 100) * 100);
const out = [];
for (const plan of PLANS.filter((p) => p.id !== 'free')) {
  for (const [interval, period, price] of [['month', 'monthly', plan.priceMonthly], ['year', 'yearly', plan.priceYearly]]) {
    const body = { period, interval: 1, item: { name: `Ledgora ${plan.name} (${period})`, amount: paise(price), currency: 'INR', description: `${plan.name}, ${period}: Rs ${price} + ${GST}% GST` }, notes: { plan: plan.id, interval } };
    if (dry) { console.log(`would create ${plan.id}:${interval}  Rs ${(body.item.amount / 100).toFixed(2)} (price ${price} + ${GST}% GST)`); out.push(`${plan.id}:${interval}=plan_xxx`); continue; }
    const res = await fetch('https://api.razorpay.com/v1/plans', {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`Razorpay refused ${plan.id}:${interval}: ${json?.error?.description || res.status}`); process.exit(1); }
    console.log(`created ${plan.id}:${interval}  ${json.id}  Rs ${(json.item.amount / 100).toFixed(2)}`);
    out.push(`${plan.id}:${interval}=${json.id}`);
  }
}
console.log(`\nPut this in your environment:\nRAZORPAY_PLAN_IDS=${out.join(',')}`);
