import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllClients, saveClient } from '../../../lib/data';
import { decodeGstin } from '../../../utils';
import { getAppSetting } from '../../../lib/appSettings';
import { toast } from '../../../components/ui/Toast';

// The Billed To side of the sheet: the saved-clients autocomplete (with keyboard nav), the add/edit client modal,
// the GSTIN blur check that fills and validates the state, and the per-client print preferences applied when a
// client is picked. The form's `client` object itself stays with the page — this hook only reads and patches it.
export function useInvoiceClients({ client, setClient, profile, editingBill, setInvoiceOptions }) {
  const [savedClients, setSavedClients] = useState([]);
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);
  // v1.10.37 — Keyboard nav on client picker. Arrow keys cycle,
  // Enter commits, Escape closes. -1 = no highlight yet.
  const [clientPickerIdx, setClientPickerIdx] = useState(-1);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [showClientModal, setShowClientModal] = useState(false);
  const [modalClient, setModalClient] = useState(null);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const clientNameRef = useRef(null);
  const clientSuggestionsRef = useRef(null);
  // v1.10.68 (#68, idea from @deppen12) — the GSTIN already names the state and
  // carries a checksum, so fill the state and catch a typo without any API key
  // or internet. The state decides place of supply: get it wrong and the
  // invoice charges CGST + SGST where it owes IGST, or the other way round.
  const [gstinHint, setGstinHint] = useState(null);

  const handleClientGstinBlur = () => {
    const decoded = decodeGstin(client.gstin);
    if (!decoded) { setGstinHint(null); return; }
    if (!decoded.checksumOk) {
      setGstinHint({ tone: 'warn', message: 'This GSTIN fails its own checksum — check for a typo.' });
      return;
    }
    if (!decoded.state) { setGstinHint(null); return; }
    if (!client.state?.trim()) {
      setClient(prev => ({ ...prev, state: decoded.state }));
      setGstinHint({ tone: 'ok', message: `Registered in ${decoded.state} — state filled in.` });
    } else if (client.state.trim().toLowerCase() !== decoded.state.toLowerCase()) {
      setGstinHint({ tone: 'warn', message: `This GSTIN is registered in ${decoded.state}, but the state says ${client.state}.` });
    } else {
      setGstinHint({ tone: 'ok', message: `Registered in ${decoded.state}.` });
    }
  };

  const selectSavedClient = (cli) => {
    // Spread the FULL client — earlier versions cherry-picked six fields
    // and silently dropped country/email/phone/isSEZ. Consequence: loading
    // an SEZ client via auto-complete cleared the SEZ flag, so the invoice
    // computed CGST+SGST instead of IGST → wrong tax on the filed return.
    setClient({
      name: cli.name || '',
      address: cli.address || '',
      city: cli.city || '',
      pin: cli.pin || '',
      state: cli.state || '',
      gstin: cli.gstin || '',
      country: cli.country || '',
      email: cli.email || '',
      phone: cli.phone || '',
      isSEZ: !!cli.isSEZ,
    });
    setSelectedClientId(cli.id);
    setShowClientSuggestions(false);
    // Settings > Party > TDS / TCS on party: a party flagged for either starts a new bill with that line on.
    if (!editingBill && getAppSetting('party.tdsTcs')) {
      setInvoiceOptions((prev) => ({ ...prev, ...(cli.tcsApplicable ? { showTCS: true } : {}), ...(cli.tdsApplicable ? { showTDS: true } : {}) }));
    }
    // v1.9.1 — auto-apply per-client print preferences (if set on the client
    // record). Overrides invoice-level defaults for this session. Only fires
    // for NEW bills (not when editing) since editing bills keep saved options.
    //
    // v1.10.12 — reported: "one client is set with thermal invoice print,
    // others are also changing the preview". Root cause: prior code only
    // set a patch WHEN the client had a preference — so switching from
    // Client A (thermal) → Client B (no preference) left the thermal
    // setting sticky. Now we ALWAYS assign paperSize / currency /
    // clientAutoPrint to the new client's value OR the app default, so
    // client B resets to A4/INR cleanly.
    if (!editingBill) {
      setInvoiceOptions(prev => ({
        ...prev,
        // v1.10.33 — Was `cli.preferredPaperSize || 'a4'` which HARD-RESET
        // to A4 for every client without an explicit preference — wiping
        // out the user's globally saved default (e.g. someone who prints
        // every invoice on 80mm thermal would land back on A4 the moment
        // they picked a client). Now falls back to prev.paperSize so
        // globally-persisted choice sticks until the user changes it.
        paperSize: cli.preferredPaperSize || prev.paperSize || 'a4',
        // v1.10.48 — Custom paper carries its dimensions in SEPARATE
        // fields, and prior code restored only `preferredPaperSize`. So a
        // client saved on 'custom' came back as 'custom' with no width —
        // and getPaperSize() defaults a missing custom width to 80mm,
        // whose `kind` is 'thermal'. Net effect: selecting that client
        // silently turned the invoice into an 80mm receipt. Restore the
        // dimensions with the size, falling back to the current values
        // rather than to getPaperSize's thermal default.
        customPaperWidth: cli.preferredCustomPaperWidth || prev.customPaperWidth || 80,
        customPaperHeight: cli.preferredCustomPaperHeight || prev.customPaperHeight || 297,
        currency: cli.preferredCurrency || prev.currency || 'INR',
        // v1.10.5 — client-level auto-print override (see original comment).
        clientAutoPrint: !!cli.autoPrint,
      }));
    }
    toast(`Loaded client: ${cli.name}`, 'info');
  };

  // Open modal to add new client (pre-fill from current invoice fields)
  const openAddClientModal = () => {
    // v1.10.74 - pass country too; without it the modal fell back to the
    // business country and saving could overwrite the invoice's country.
    setModalClient({ name: client.name || '', address: client.address || '', city: client.city || '', pin: client.pin || '', state: client.state || '', gstin: client.gstin || '', country: client.country || '' });
    setIsEditingClient(false);
    setShowClientModal(true);
    setShowClientSuggestions(false);
  };

  // Open modal to edit existing saved client
  const openEditClientModal = (cli) => {
    setModalClient(cli);
    setIsEditingClient(true);
    setShowClientModal(true);
  };

  // Save from modal (add or update)
  const handleClientModalSave = async (formData) => {
    const data = { ...formData };
    if (isEditingClient && modalClient?.id) data.id = modalClient.id;
    await saveClient(data);
    const updated = await getAllClients();
    setSavedClients(updated);
    // Sync the invoice form with the FULL saved record — dropping
    // country/email/phone/isSEZ here was the SEZ tax bug.
    setClient({
      name: data.name || '',
      address: data.address || '',
      city: data.city || '',
      pin: data.pin || '',
      state: data.state || '',
      gstin: data.gstin || '',
      country: data.country || '',
      email: data.email || '',
      phone: data.phone || '',
      isSEZ: !!data.isSEZ,
    });
    if (isEditingClient && modalClient?.id) {
      setSelectedClientId(modalClient.id);
      toast(`Client "${data.name}" updated!`, 'success');
    } else {
      const found = updated.find(c => c.name === data.name.trim() && !savedClients.some(old => old.id === c.id));
      if (found) setSelectedClientId(found.id);
      toast(`Client "${data.name}" saved!`, 'success');
    }
    setShowClientModal(false);
  };

  // v1.10.6 — audit L15. Small filter but cheap to memoize; keeps the
  // suggestion list identity stable across renders where neither
  // input matters (saves a downstream re-render of the suggestion
  // dropdown).
  const filteredClients = useMemo(() => {
    const q = client.name.trim().toLowerCase();
    if (!q) return savedClients;
    return savedClients.filter(cli => cli.name.toLowerCase().includes(q));
  }, [client.name, savedClients]);

  // Close suggestions on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (clientSuggestionsRef.current && !clientSuggestionsRef.current.contains(e.target) &&
          clientNameRef.current && !clientNameRef.current.contains(e.target)) {
        setShowClientSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return {
    savedClients, setSavedClients,
    showClientSuggestions, setShowClientSuggestions,
    clientPickerIdx, setClientPickerIdx,
    selectedClientId, setSelectedClientId,
    showClientModal, setShowClientModal,
    modalClient, isEditingClient,
    clientNameRef, clientSuggestionsRef,
    gstinHint, setGstinHint,
    handleClientGstinBlur,
    selectSavedClient,
    openAddClientModal, openEditClientModal, handleClientModalSave,
    filteredClients,
  };
}
