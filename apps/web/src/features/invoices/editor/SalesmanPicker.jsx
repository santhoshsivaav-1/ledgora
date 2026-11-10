import { useEffect, useState } from 'react';
import { Field, Select } from '../../../components/ui/Field';
import { listStaff } from '../../../lib/data/staff';

// Vyapar parity P2-S1: the Salesman field of Invoice Details. Active salesmen only; an invoice already credited to
// someone since deactivated keeps showing them. The name is saved with the id so lists and prints need no lookup.

export default function SalesmanPicker({ value, name, onChange }) {
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    let live = true;
    listStaff({ activeOnly: true })
      .then((s) => live && setStaff(s))
      .catch(() => {}); // no salesmen (or no permission): the field just offers "None"
    return () => {
      live = false;
    };
  }, []);
  const options = staff.map((s) => ({ value: s.id, label: s.name }));
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: name || 'Former salesman' });
  return (
    <Field label="Salesman">
      <Select
        value={value || ''}
        placeholder="None"
        options={options}
        onChange={(id) => onChange(id ? { salesmanId: id, salesmanName: options.find((o) => o.value === id)?.label || '' } : { salesmanId: '', salesmanName: '' })}
      />
    </Field>
  );
}
