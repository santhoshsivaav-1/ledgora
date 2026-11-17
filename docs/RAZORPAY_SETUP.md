# Connecting Razorpay (taking payment for Silver and Gold)

The code is finished and tested with a stand-in provider. These steps need **your** Razorpay account. Do them in **Test mode first**, then repeat in Live mode.

## 1. Get the keys

1. Sign in at <https://dashboard.razorpay.com>. For a new account, finish the business verification (needed for Live mode, not for Test mode).
2. Top of the dashboard: switch to **Test Mode**.
3. **Account & Settings → API keys → Generate Test Key.** Copy the **Key Id** (`rzp_test_...`) and **Key Secret**. The secret is shown once.
4. Subscriptions must be enabled on the account (**Products → Subscriptions**). If you do not see it, ask Razorpay support to switch it on.

## 2. Create the four plans

Silver and Gold, monthly and yearly. The script creates them for you, with each amount equal to the price **plus 18% GST** (the GST invoice splits what was charged):

```
RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx node apps/api/scripts/razorpay-setup.mjs
```

Add `--dry-run` first to see the amounts without calling Razorpay (Silver ₹352.82 a month and ₹3,538.82 a year; Gold ₹588.82 and ₹5,898.82). It prints one line:

```
RAZORPAY_PLAN_IDS=silver:month=plan_...,silver:year=plan_...,gold:month=plan_...,gold:year=plan_...
```

If you change a price in `packages/contracts/src/plans.ts`, create new plans (Razorpay plans cannot be edited) and update this line.

## 3. Set the environment

Put these in `.env` locally, or in Railway's Variables for the deployed service:

```
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string     # you invent it; step 4 uses the same one
RAZORPAY_PLAN_IDS=<the line from step 2>
SELLER_NAME=<your registered name>
SELLER_GSTIN=<your GSTIN, or leave empty until registered>
SELLER_STATE=<your state, e.g. Tamil Nadu>
SELLER_ADDRESS=<your address>
SUPPORT_EMAIL=<where you want data requests and support mail>
PLATFORM_ADMIN_EMAILS=<your own e-mail, to see the subscribers page>
```

Restart the API. "Choose Silver / Gold" on Settings → Plan & billing is now enabled (it says "Online payment is not set up" until all four Razorpay values are present).

## 4. Add the webhook (this is what upgrades the account after payment)

1. Razorpay Dashboard → **Account & Settings → Webhooks → Add New Webhook.**
2. **URL:** `https://<your API address>/v1/billing/webhook` (the address of the deployed service, the same `API_URL`). It must be reachable from the internet. To try it on your own computer, expose port 4000 with a tunnel such as `cloudflared tunnel --url http://localhost:4000` or `ngrok http 4000` and use that address.
3. **Secret:** exactly the `RAZORPAY_WEBHOOK_SECRET` from step 3.
4. **Events:** tick `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `subscription.resumed`.
5. Save.

## 5. Try a test purchase

1. Sign in as an account owner. Settings → Plan & billing → choose Silver, yearly.
2. On Razorpay's page pay with a test card: `4111 1111 1111 1111`, any future expiry, any CVV; or test UPI `success@razorpay`. Test mode never moves real money.
3. Within a few seconds the account shows **Silver**, and Settings → Plan & billing → **Your invoices** lists a numbered GST invoice (also e-mailed to the owner).
4. If nothing changes: Razorpay Dashboard → Webhooks → the webhook's **recent deliveries**. A `401` means the secret differs from `RAZORPAY_WEBHOOK_SECRET`; a timeout means the URL is not reachable.

## 6. Go live

Repeat steps 1 to 4 with **Live Mode** keys (new key pair, new plans from the script, a new webhook with its own secret) and replace the four variables. Check that your GSTIN and address in `SELLER_*` are right first, because every invoice carries them.

## Seeing who has subscribed, and how many businesses

Go to `https://<your site>/admin` (your own door: "Owner sign-in", no sign-up, and no plan or business-setup screens). Sign in with an address listed in `PLATFORM_ADMIN_EMAILS` (the e-mail must be confirmed, so `REQUIRE_EMAIL_VERIFICATION` must be `true` in production). The page shows how many **businesses** are registered (and how many have a GSTIN), separately from how many **accounts** (subscribers) there are, then lists every account with the owner's e-mail, plan, status, trial and renewal dates and how much each has paid, with filters and a CSV download.

## What the software does and does not do

- It creates the subscription and sends the customer to Razorpay's hosted page; the card or UPI details never touch your server.
- It trusts only webhooks whose signature matches your secret, and one payment gives one invoice even if Razorpay repeats the event.
- Cancelling stops renewal at the end of the paid period. Refunds are done in the Razorpay dashboard.
