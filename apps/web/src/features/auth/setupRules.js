import { SETTINGS } from '@ledgora/contracts';

// The business-setup wizard's rules, pure so they are tested without a browser: what each step needs before "Next", and
// which registry settings the answers become.

export const STEPS = [
  { id: 'business', title: 'Business' },
  { id: 'contact', title: 'Address & contact' },
  { id: 'money', title: 'Bank & year' },
  { id: 'defaults', title: 'Invoice defaults' },
];

/** The first thing wrong on a step, as a field and a message; null when the step can go on. */
export function stepProblem(stepId, f, gstinOk) {
  if (stepId === 'business') {
    if (!f.name.trim()) return { field: 'name', message: 'Enter your business name' };
    if (!f.state) return { field: 'state', message: 'Choose your state' };
    if (f.gstin.trim() && !gstinOk) return { field: 'gstin', message: 'This GSTIN is not valid. Check it, or leave it blank if you are not registered.' };
    if (f.regType !== 'unregistered' && !f.gstin.trim()) return { field: 'gstin', message: 'A registered business needs its GSTIN. Choose "Not registered" if you have none yet.' };
    if (f.regType === 'composition' && !(Number(f.compRate) > 0 && Number(f.compRate) <= 100)) return { field: 'compRate', message: 'Enter the composition rate, for example 1' };
  }
  if (stepId === 'contact') {
    if (f.pin.trim() && !/^\d{6}$/.test(f.pin.trim())) return { field: 'pin', message: 'A PIN code is 6 digits' };
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return { field: 'email', message: 'That e-mail does not look right' };
    if (f.phone.trim() && !/^[+\d][\d\s-]{6,}$/.test(f.phone.trim())) return { field: 'phone', message: 'That phone number does not look right' };
  }
  if (stepId === 'money') {
    if (f.ifsc.trim() && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.ifsc.trim())) return { field: 'ifsc', message: 'An IFSC is 4 letters, a zero and 6 letters or digits' };
    if (f.upiId.trim() && !/^[\w.-]{2,}@[\w.-]{2,}$/.test(f.upiId.trim())) return { field: 'upiId', message: 'A UPI id looks like name@bank' };
  }
  if (stepId === 'defaults') {
    const r = Number(f.defaultGst);
    if (!(r >= 0 && r <= 100)) return { field: 'defaultGst', message: 'GST rate must be 0 to 100' };
  }
  return null;
}

/** The answers that become settings (only keys the registry knows, so a typo can not slip through). */
export function settingsFrom(f) {
  const out = {
    'gst.regType': f.regType,
    'fy.startMonth': Number(f.fyStart) || 4,
    'tax.defaultItemRate': Number(f.defaultGst),
    'item.defaultGst': Number(f.defaultGst),
    'tax.priceInclusive': !!f.taxInclusive,
    'txn.terms.text': f.terms.trim().slice(0, 1000),
  };
  if (f.regType === 'composition') out['gst.compRate'] = Number(f.compRate);
  for (const k of Object.keys(out)) if (!(k in SETTINGS)) delete out[k];
  return out;
}

/** The profile fields the bill and print screens read. */
export const profileFrom = (f) => ({
  bankName: f.bankName.trim(), accountNumber: f.accountNumber.trim(), ifsc: f.ifsc.trim().toUpperCase(), upiId: f.upiId.trim(),
});
