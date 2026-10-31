// Role helpers, matching firestore.rules. A member is the user's own members/{uid} document.
import { t } from './i18n.js';

export const isActive = (m) => !!m && m.disabled !== true;
export const isOwner = (m) => isActive(m) && m.role === 'owner';
export const isManager = (m) => isActive(m) && (m.role === 'owner' || m.role === 'manager');

export function roleLabel(role) {
  return t(role === 'owner' ? 'roleOwner' : role === 'manager' ? 'roleManager' : 'roleEmployee');
}

// Owners see every location; managers with no list see all; otherwise only their own.
export function canUseLocation(m, locId) {
  if (!isActive(m)) return false;
  if (m.role === 'owner') return true;
  const ids = m.branchIds || [];
  return m.role === 'manager' && !ids.length ? true : ids.includes(locId);
}
