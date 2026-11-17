# Connecting a GST service provider (e-invoice, e-way bill, GST portal)

Ledgora reaches the e-invoice portal (IRP), the e-way bill portal and the GST portal through **a GST Suvidha Provider (GSP)**. Providers differ, so the app speaks one small contract and a provider sits behind it. **None of this has been run against a real portal.**

## Modes (`GSP_MODE`)

| Mode | What it is |
|---|---|
| `off` (default) | Nothing is called. The manual route stays: download the IRP JSON, upload on the portal, paste the IRN back; record the ARN yourself. |
| `sandbox` | A built-in stand-in. It enforces what the portals enforce (a repeated IRN is refused, only an IRN under 24 hours old can be cancelled, e-way validity is one day per 200 km, a vehicle number must look like one, a return gets a status and an ARN) but signs nothing real. Everything it returns is marked sandbox, and the printed invoice says **SANDBOX: not a real IRN**. It forgets everything when the server restarts. |
| `http` | A real provider: set `GSP_BASE_URL` and `GSP_API_KEY`. The key stays on the server and is sent as `Authorization: Bearer ...` with the business GSTIN in `x-gstin`. |

## The contract (what a provider, or a thin shim in front of one, must answer)

All bodies are JSON. A non-2xx answer carries `{ "error": { "message": "..." } }`; the message is shown to the user, so quote the portal's own error code in it (409 for a duplicate, 404 for not found).

| Call | Request | Answer |
|---|---|---|
| `POST /einvoice/generate` | `{ invoice }` the IRP INV-1 JSON | `{ irn, ackNo, ackDt, signedQr }` |
| `POST /einvoice/cancel` | `{ irn, reason: "1"-"4", remark }` | `{ irn, cancelDate }` |
| `POST /eway/generate` | `{ bill }` the NIC e-way JSON | `{ ewayNo, ewayDate, validUntil }` |
| `POST /eway/vehicle` | `{ ewayNo, vehicleNo, reason, remark }` | `{ validUntil }` |
| `POST /eway/cancel` | `{ ewayNo, reason, remark }` | `{ cancelDate }` |
| `POST /gstn/upload` | `{ gstin, kind: "gstr1"\|"gstr3b", period: "MMYYYY", payload }` | `{ reference }` |
| `GET /gstn/status?reference=` | | `{ status: "processing"\|"processed"\|"error"\|"filed", arn?, filedOn?, errors? }` |
| `GET /gstn/gstr2b?gstin=&period=` | | the GSTR-2B JSON |

## What the app does with it

- **E-invoice:** the invoice list's E-invoice dialog shows **Generate IRN** when a provider is connected. The invoice is checked first (the same checks as the manual route), sent, and stored locked with the IRN, ack and signed QR. The print carries the QR. Cancel asks the provider, and only within 24 hours of the acknowledgement; after that the answer is a credit note.
- **E-way bill:** `POST /v1/gsp/eway/generate`, `/vehicle` (Part-B) and `/cancel` on the API; when an invoice is named, the e-way register on that invoice is updated. There is no button for these yet beyond the register.
- **GSTR-1 and GSTR-3B:** an approved or ready pack shows **Upload to GST portal**, then **Check status**. When the provider reports it filed, the ARN and date are recorded and the months lock with no manual step, through the same code as the manual "Record as filed". Other returns are still filed on the portal. A pack that went to a CA for review needs the CA's approval of the exact file first.
- **GSTR-2B:** `GET /v1/gsp/gstr2b?businessId=&period=` returns the provider's JSON, which is what the reconciliation screen takes.

## Before you rely on it

1. Register with a GSP, authorize it on the GST portal for your GSTIN, and get sandbox access from the portals.
2. Write (or buy) the shim that maps the table above to the provider's real API.
3. Run it in the portals' sandbox first. File nothing real until a CA has checked a sandbox return end to end.
