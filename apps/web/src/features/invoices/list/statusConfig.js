// How each invoice status is labelled and coloured, in the list and in the payment screens.

import { Clock, CheckCircle, AlertTriangle, Ban } from 'lucide-react';

export const STATUS_CONFIG = {
  unpaid:  { label: 'Unpaid',  icon: Clock,          color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' },
  partial: { label: 'Partial', icon: Clock,          color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.14)' },
  paid:    { label: 'Paid',    icon: CheckCircle,    color: '#059669', bg: 'rgba(5, 150, 105, 0.14)'  },
  overdue: { label: 'Overdue', icon: AlertTriangle,  color: '#dc2626', bg: 'rgba(220, 38, 38, 0.14)'  },
  // v1.10.67 (#66 item 12) — a cancelled document keeps its number but counts
  // for nothing. Picking any other status here un-cancels it.
  cancelled: { label: 'Cancelled', icon: Ban, color: '#64748b', bg: 'rgba(100, 116, 139, 0.16)' },
};
