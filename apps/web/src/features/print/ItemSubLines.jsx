import { getAllAppSettings } from '../../lib/appSettings';
import { itemSubLines } from '../items/itemExtras';

// The small lines under an item's name on a printed bill (description, MRP, batch, serials), chosen in Settings › Print.
export default function ItemSubLines({ item, fmt, style }) {
  const lines = itemSubLines(item, getAllAppSettings(), fmt);
  if (!lines.length) return null;
  return <div style={{ whiteSpace: 'pre-wrap', ...style }}>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>;
}
