import { useState } from 'react';
import { Pencil } from 'lucide-react';

// "● Enter Business Name" in the new top bar (P0-S2). A business with no name yet is named right here; once it has
// one, the pencil opens Settings › Business, where a rename also moves the invoice numbering (renameNumberSeries)
// and the saved profiles along with it. The red dot stays until the profile has a name, a state and an address.

export const profileIncomplete = (p) => !p?.businessName?.trim() || !p?.state || !p?.address?.trim();

export default function BusinessNameField({ profile, onSave, onEdit, onSetup }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const name = profile?.businessName?.trim();
  const incomplete = profileIncomplete(profile);

  const save = async () => {
    const v = draft.trim();
    if (!v || saving) return;
    setSaving(true);
    try {
      await onSave(v);
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vy-biz">
      {incomplete && (
        <button type="button" className="vy-biz-dot" onClick={onSetup} aria-label="Finish setting up your business profile" title="Finish setting up your business profile" />
      )}
      {name ? (
        <button type="button" className="vy-biz-name" onClick={onEdit} title="Edit business profile">
          <span>{name}</span>
          <Pencil size={13} aria-hidden="true" />
        </button>
      ) : (
        <input
          className="vy-biz-input"
          aria-label="Business name"
          placeholder="Enter Business Name"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setDraft('');
          }}
        />
      )}
    </div>
  );
}
