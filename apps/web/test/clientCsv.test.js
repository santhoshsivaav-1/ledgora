import { describe, expect, it } from 'vitest';
import {
  CLIENT_COLUMNS,
  CLIENT_TEMPLATE,
  clientCsvToRecords,
  parseCsv,
} from '../src/features/import-export/bulkCsv.js';
import { ensureGroupPath } from '../src/lib/data/partyGroups';

// Clients › Import CSV: the template, the parser, and how a Group cell finds or makes its group.

describe('client CSV template', () => {
  it('has the columns the import reads, and imports cleanly', () => {
    expect(parseCsv(CLIENT_TEMPLATE)[0]).toEqual(CLIENT_COLUMNS);
    const { clients, errors } = clientCsvToRecords(CLIENT_TEMPLATE);
    expect(errors).toEqual([]);
    expect(clients.map((c) => [c.name, c.group, c.city, c.pin])).toEqual([
      ['Sharma Traders', 'Wholesale', 'Pune', '411001'],
      ['Ravi Stores', 'Retail > Chennai', 'Chennai', '600002'],
    ]);
  });
});

describe('clientCsvToRecords', () => {
  it('still reads the old six-column files', () => {
    const csv =
      'name,address,state,gstin,email,phone\nAcme,"1, Main Rd",Kerala,32abcde1234f1z5,a@b.in,999';
    expect(clientCsvToRecords(csv).clients[0]).toEqual({
      name: 'Acme',
      group: '',
      gstin: '32ABCDE1234F1Z5',
      phone: '999',
      email: 'a@b.in',
      address: '1, Main Rd',
      city: '',
      pin: '',
      state: 'Kerala',
    });
  });

  it('matches loose headers and Excel BOM', () => {
    const csv = '﻿Client Name,Party Group,Mobile,Pin Code\nOm,Vendors,98,600001';
    expect(clientCsvToRecords(csv).clients[0]).toMatchObject({
      name: 'Om',
      group: 'Vendors',
      phone: '98',
      pin: '600001',
    });
  });

  it('skips names already saved or repeated in the file, any case, and reports rows without a name', () => {
    const csv = 'Name,City\nAcme,Pune\nacme ,Pune\nZed,Goa\n,Delhi';
    const res = clientCsvToRecords(csv, { existing: [{ name: 'ZED' }] });
    expect(res.clients.map((c) => c.name)).toEqual(['Acme']);
    expect(res.skipped).toEqual(['acme', 'Zed']);
    expect(res.errors).toEqual([{ line: 5, message: 'Name is required' }]);
  });
});

describe('ensureGroupPath', () => {
  const make = () => {
    let n = 0;
    const made = [];
    const create = async ({ name, parentId }) => {
      const g = { id: `new${++n}`, name, parentId };
      made.push(g);
      return g;
    };
    return { made, create };
  };

  it('uses an existing group by name, any case', async () => {
    const { made, create } = make();
    const groups = [{ id: 'w', name: 'Wholesale', parentId: null }];
    expect(await ensureGroupPath(groups, 'wholesale', create)).toBe('w');
    expect(made).toEqual([]);
  });

  it('creates each missing level of a path once, and reuses it for later rows', async () => {
    const { made, create } = make();
    const groups = [{ id: 'r', name: 'Retail', parentId: null }];
    const id = await ensureGroupPath(groups, 'Retail > Chennai', create);
    expect(made).toEqual([{ id: 'new1', name: 'Chennai', parentId: 'r' }]);
    expect(await ensureGroupPath(groups, 'Retail › chennai', create)).toBe(id);
    expect(await ensureGroupPath(groups, 'Vendors > Local', create)).toBe('new3');
    expect(made.map((g) => [g.name, g.parentId])).toEqual([
      ['Chennai', 'r'],
      ['Vendors', null],
      ['Local', 'new2'],
    ]);
  });

  it('a name used elsewhere in the tree is that group (names are unique per business)', async () => {
    const { made, create } = make();
    const groups = [
      { id: 'r', name: 'Retail', parentId: null },
      { id: 'c', name: 'Chennai', parentId: 'x' },
    ];
    expect(await ensureGroupPath(groups, 'Retail > Chennai', create)).toBe('c');
    expect(made).toEqual([]);
  });

  it('a blank cell means no group', async () => {
    expect(
      await ensureGroupPath([], '  ', async () => {
        throw new Error('no');
      }),
    ).toBeNull();
  });
});
