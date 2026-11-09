import { useCallback, useEffect, useState } from 'react';
import Combobox from '../../components/ui/Combobox';
import { toast } from '../../components/ui/Toast';
import { useEntitlements } from '../billing/useEntitlements';
import { createPartyGroup, groupPath, groupRows, listPartyGroups } from '../../lib/data/partyGroups';

// Vyapar parity P1-S1: the Party Group field of Add / Edit Party. Typing a name that does not exist offers
// `+ Add new "<name>"`, which creates the group and selects it without leaving the party form.

const NONE = { id: '', path: 'No group' };

export default function PartyGroupPicker({ value, onChange, id }) {
  const { can } = useEntitlements();
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    let live = true;
    listPartyGroups()
      .then((g) => live && setGroups(g))
      .catch(() => {}); // the picker then just offers "No group"; the form still saves
    return () => {
      live = false;
    };
  }, []);

  const options = useCallback(
    (q) => {
      const all = groupRows(groups, q).map((g) => ({ id: g.id, path: groupPath(groups, g.id), count: g.partyCount }));
      return q ? all : [NONE, ...all];
    },
    [groups],
  );

  const create = async (name) => {
    try {
      const g = await createPartyGroup({ name });
      setGroups((list) => [...list, g]);
      onChange(g.id);
      toast(`Group "${g.name}" added`, 'success');
    } catch (e) {
      if (e.status !== 403) toast(e.message || 'Could not add the group', 'error');
    }
  };

  const selected = value ? { id: value, path: groupPath(groups, value) || '…' } : null;
  return (
    <Combobox
      id={id}
      value={selected}
      onChange={(o) => onChange(o?.id || null)}
      search={options}
      getLabel={(o) => o?.path ?? ''}
      getKey={(o) => o.id || 'none'}
      renderOption={(o) => (
        <span>
          {o.path}
          {o.count !== undefined && <span className="ui-help"> · {o.count}</span>}
        </span>
      )}
      onCreate={can('party:write') ? create : undefined}
      placeholder="No group"
      emptyText="No group matches"
    />
  );
}
