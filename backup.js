// Backup and restore (owner). A backup is the whole shop as JSON: download it as a file or keep it
// in the cloud (split into chunks under 1 MB). Restores and bulk deletions always save a cloud
// backup first. While a restore runs, shops/{id}.restoreUntil lets the owner rewrite history docs.
import { t, localName, errorText } from './i18n.js';
import { fmtDate, fmtNum } from './format.js';
import { el, icon, iconButton, confirmAction, toast, busy } from './forms.js';
import {
  db, doc, collection, query, limit, orderBy, writeBatch, setDoc, updateDoc, deleteDoc, getDocFromServer, getDocsFromServer,
  serverTimestamp, deleteField, arrayRemove, Timestamp,
} from './firebase.js';
import { watchCollection } from './sync.js';
import { header } from './screens.js';
import { download } from './csv.js';
import { today } from './suppliers.js';

// Everything that belongs to the shop. The team (members, invites) is kept as it is today on restore.
const DATA = [
  'locations', 'categories', 'products', 'stock', 'movements', 'stockCounts', 'purchases', 'costs',
  'suppliers', 'supplierAccounts', 'supplierPayments', 'sales', 'returns', 'customers', 'customerAccounts',
  'customerPayments', 'dailyStats', 'expenses', 'cashDays', 'fxRates',
];
// "Clear transactions" keeps the catalogue, people and settings, and empties these.
const TRANSACTIONS = [
  'stock', 'movements', 'stockCounts', 'purchases', 'costs', 'supplierAccounts', 'supplierPayments', 'sales',
  'returns', 'customerAccounts', 'customerPayments', 'dailyStats', 'expenses', 'cashDays',
];
const WRITES_PER_BATCH = 400;
const CHUNK_CHARS = 250000; // Arabic is up to 3 bytes per character in UTF-8, so a chunk stays under 1 MB
const RESTORE_MINUTES = 30;

const shopRef = (shopId) => doc(db, 'shops', shopId);
const coll = (shopId, ...p) => collection(db, 'shops', shopId, ...p);

// Timestamps become { __ts: millis } in JSON and come back as Timestamps.
function encode(v) {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
function decode(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.__ts === 'number') return Timestamp.fromMillis(v.__ts);
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  return v;
}

export async function exportShop(shopId, progress = () => {}) {
  const shopSnap = await getDocFromServer(shopRef(shopId));
  const shop = shopSnap.data();
  const out = {
    app: 'dokan',
    version: 1,
    shopId,
    exportedAt: new Date().toISOString(),
    shop: encode({ nameAr: shop.nameAr, nameEn: shop.nameEn, currency: shop.currency, settings: shop.settings || {} }),
    collections: {},
    costHistory: [],
  };
  for (const name of DATA) {
    progress(t('readingX', { name }));
    const snap = await getDocsFromServer(coll(shopId, name));
    out.collections[name] = snap.docs.map((d) => ({ id: d.id, data: encode(d.data()) }));
  }
  for (const c of out.collections.costs) {
    const snap = await getDocsFromServer(coll(shopId, 'costs', c.id, 'history'));
    for (const d of snap.docs) out.costHistory.push({ parent: c.id, id: d.id, data: encode(d.data()) });
  }
  return out;
}

const counts = (data) => Object.fromEntries(Object.entries(data.collections).map(([k, v]) => [k, v.length]));

export async function saveCloudBackup(shopId, uid, label, progress = () => {}) {
  const data = await exportShop(shopId, progress);
  const text = JSON.stringify(data);
  const ref = doc(coll(shopId, 'backups'));
  const parts = Math.ceil(text.length / CHUNK_CHARS);
  for (let i = 0; i < parts; i += 1) {
    progress(t('savingPart', { i: fmtNum(i + 1), n: fmtNum(parts) }));
    await setDoc(doc(ref, 'chunks', String(i).padStart(4, '0')), { i, text: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
  }
  // The backup only counts once this last document exists.
  await setDoc(ref, { label, by: uid, createdAt: serverTimestamp(), parts, size: text.length, counts: counts(data), complete: true });
  return ref.id;
}

async function readCloudBackup(shopId, backupId) {
  const snap = await getDocsFromServer(query(coll(shopId, 'backups', backupId, 'chunks'), orderBy('i')));
  return JSON.parse(snap.docs.map((d) => d.data().text).join(''));
}

async function deleteCloudBackup(shopId, backupId) {
  await deleteAllIn(coll(shopId, 'backups', backupId, 'chunks'));
  await deleteDoc(doc(db, 'shops', shopId, 'backups', backupId));
}

async function deleteAllIn(ref, progress, name) {
  for (;;) {
    const snap = await getDocsFromServer(query(ref, limit(WRITES_PER_BATCH)));
    if (snap.empty) return;
    progress?.(t('deletingX', { name }));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

async function clearCollections(shopId, names, progress) {
  if (names.includes('costs')) {
    const costs = await getDocsFromServer(coll(shopId, 'costs'));
    for (const c of costs.docs) await deleteAllIn(coll(shopId, 'costs', c.id, 'history'));
  }
  for (const name of names) await deleteAllIn(coll(shopId, name), progress, name);
}

// Opens the restore window, runs fn, and always closes it again.
async function withRestoreWindow(shopId, fn) {
  await updateDoc(shopRef(shopId), { restoreUntil: Timestamp.fromMillis(Date.now() + RESTORE_MINUTES * 60000) });
  try {
    return await fn();
  } finally {
    await updateDoc(shopRef(shopId), { restoreUntil: deleteField() }).catch(() => {});
  }
}

export function validBackup(data) {
  return data && data.app === 'dokan' && data.collections && typeof data.collections === 'object';
}

export async function restoreShop(shopId, data, uid, progress = () => {}) {
  if (!validBackup(data)) throw Object.assign(new Error('Not a Dokan backup'), { code: 'bad-backup' });
  progress(t('backingUpFirst'));
  await saveCloudBackup(shopId, uid, t('autoBeforeRestore'), progress);
  await withRestoreWindow(shopId, async () => {
    await clearCollections(shopId, DATA, progress);
    const writes = [];
    for (const name of DATA) {
      for (const d of data.collections[name] || []) writes.push([doc(db, 'shops', shopId, name, d.id), d.data]);
    }
    for (const h of data.costHistory || []) writes.push([doc(db, 'shops', shopId, 'costs', h.parent, 'history', h.id), h.data]);
    for (let i = 0; i < writes.length; i += WRITES_PER_BATCH) {
      progress(t('writingN', { i: fmtNum(Math.min(i + WRITES_PER_BATCH, writes.length)), n: fmtNum(writes.length) }));
      const batch = writeBatch(db);
      for (const [ref, d] of writes.slice(i, i + WRITES_PER_BATCH)) batch.set(ref, decode(d));
      await batch.commit();
    }
    const s = decode(data.shop || {});
    await updateDoc(shopRef(shopId), { nameAr: s.nameAr || '', nameEn: s.nameEn || '', settings: s.settings || {}, updatedAt: serverTimestamp() });
  });
}

export async function clearTransactions(shopId, uid, progress = () => {}) {
  progress(t('backingUpFirst'));
  await saveCloudBackup(shopId, uid, t('autoBeforeClear'), progress);
  await withRestoreWindow(shopId, () => clearCollections(shopId, TRANSACTIONS, progress));
}

// Deletes the whole shop. The caller downloads a backup file first.
export async function deleteShop(shopId, uid, progress = () => {}) {
  await withRestoreWindow(shopId, async () => {
    await clearCollections(shopId, DATA, progress);
    const backups = await getDocsFromServer(coll(shopId, 'backups'));
    for (const b of backups.docs) await deleteCloudBackup(shopId, b.id);
    const invites = await getDocsFromServer(coll(shopId, 'invites'));
    for (const i of invites.docs) {
      await deleteDoc(doc(db, 'inviteCodes', i.id)).catch(() => {});
      await deleteDoc(i.ref);
    }
    const members = await getDocsFromServer(coll(shopId, 'members'));
    for (const m of members.docs) if (m.id !== uid) await deleteDoc(m.ref);
  });
  await deleteDoc(shopRef(shopId));
  // The owner's own membership goes last: the rules allow it once the shop is gone.
  await deleteDoc(doc(db, 'shops', shopId, 'members', uid));
  await updateDoc(doc(db, 'users', uid), { shopIds: arrayRemove(shopId), lastShopId: deleteField() });
}

// ---------- Screen ----------

// One status line kept across redraws, so progress stays visible while live updates arrive.
let status = null;

export function renderBackup(root, ctx, shopId) {
  const shop = ctx.shops.get(shopId);
  const back = `#/shop/${shopId}/settings`;
  const backups = ctx.live(`backups:${shopId}`, (set) => watchCollection(['shops', shopId, 'backups'], set));
  status ||= el('p', { class: 'note', role: 'status', hidden: true });
  const progress = (text) => { status.hidden = false; status.textContent = text; };
  const done = (text) => { status.textContent = text; setTimeout(() => { status.hidden = true; }, 4000); };
  const fileName = () => `dokan-${(shop?.nameEn || shop?.nameAr || 'shop').replace(/[^\p{L}\p{N}]+/gu, '-')}-${today()}.json`;

  // Every action needs internet: it reads or writes the whole shop on the server.
  const action = (label, cls, run) => {
    const b = el('button', { type: 'button', class: `btn ${cls}` }, label);
    b.addEventListener('click', () => busy(b, async () => {
      if (!navigator.onLine) return toast(t('needOnline'), 'error');
      try {
        await run();
      } catch (err) {
        status.hidden = true;
        toast(err.code === 'bad-backup' ? t('badBackup') : errorText(err), 'error');
      }
    }));
    return b;
  };

  const downloadBtn = action(t('downloadBackup'), 'primary', async () => {
    const data = await exportShop(shopId, progress);
    download(fileName(), JSON.stringify(data), 'application/json');
    done(t('backupDownloaded'));
  });
  const cloudBtn = action(t('saveCloudBackup'), 'ghost', async () => {
    await saveCloudBackup(shopId, ctx.user.uid, t('manualBackup'), progress);
    done(t('backupSaved'));
  });

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast(t('badBackup'), 'error'); }
    if (!validBackup(data)) return toast(t('badBackup'), 'error');
    await confirmRestore(data, file.name);
  });
  const restoreFileBtn = action(t('restoreFromFile'), 'ghost', async () => fileInput.click());

  async function confirmRestore(data, from) {
    if (!navigator.onLine) return toast(t('needOnline'), 'error');
    const word = t('restoreWord');
    const yes = await confirmAction({
      title: t('restoreTitle'),
      message: t('restoreMsg', { from, date: data.exportedAt ? fmtDate(new Date(data.exportedAt)) : '—', word }) + (data.shopId !== shopId ? ` ${t('otherShopWarning')}` : ''),
      confirmLabel: t('restoreTitle'),
      danger: true,
      typeWord: word,
    });
    if (!yes) return;
    try {
      await restoreShop(shopId, data, ctx.user.uid, progress);
      done(t('restoreDone'));
    } catch (err) {
      status.hidden = true;
      toast(err.code === 'bad-backup' ? t('badBackup') : errorText(err), 'error');
    }
  }

  const clearBtn = action(t('clearTransactions'), 'ghost danger-text', async () => {
    const word = t('deleteWord');
    const yes = await confirmAction({ title: t('clearTransactions'), message: t('clearMsg', { word }), confirmLabel: t('clearTransactions'), danger: true, typeWord: word });
    if (!yes) return;
    await clearTransactions(shopId, ctx.user.uid, progress);
    done(t('clearDone'));
  });

  const deleteBtn = action(t('deleteShop'), 'danger', async () => {
    const word = localName(shop);
    const yes = await confirmAction({ title: t('deleteShop'), message: t('deleteShopMsg', { name: word }), confirmLabel: t('deleteShop'), danger: true, typeWord: word });
    if (!yes) return;
    // Bulk deletion: keep a copy on this device first.
    const data = await exportShop(shopId, progress);
    download(fileName(), JSON.stringify(data), 'application/json');
    await deleteShop(shopId, ctx.user.uid, progress);
    toast(t('shopDeleted'));
    ctx.go('#/shops');
  });

  const list = [...(backups || [])].filter((b) => b.complete).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

  root.replaceChildren(
    header(t('backupTitle'), { back }),
    el('main', { class: 'page' },
      el('p', { class: 'muted' }, t('backupIntro')),
      status,
      el('section', { class: 'card form' },
        el('h2', { class: 'section-title' }, t('makeBackup')),
        downloadBtn,
        cloudBtn,
      ),
      el('section', { class: 'card form' },
        el('h2', { class: 'section-title' }, t('cloudBackups')),
        !backups ? el('p', { class: 'muted' }, t('loading'))
          : !list.length ? el('p', { class: 'muted' }, t('noBackups'))
            : el('div', { class: 'list' }, list.map((b) => el('div', { class: 'row count-row' },
              el('span', { class: 'row-main' },
                el('strong', {}, `${b.createdAt ? fmtDate(b.createdAt) : ''} · ${b.label || ''}`),
                el('span', { class: 'muted small' }, t('backupSize', { kb: fmtNum(Math.round((b.size || 0) / 1024)), sales: fmtNum(b.counts?.sales || 0), products: fmtNum(b.counts?.products || 0) })),
              ),
              el('span', { class: 'row-actions' },
                el('button', { type: 'button', class: 'btn ghost', onclick: async () => {
                  if (!navigator.onLine) return toast(t('needOnline'), 'error');
                  try {
                    progress(t('loading'));
                    const data = await readCloudBackup(shopId, b.id);
                    status.hidden = true;
                    await confirmRestore(data, `${fmtDate(b.createdAt)} · ${b.label || ''}`);
                  } catch (err) {
                    status.hidden = true;
                    toast(errorText(err), 'error');
                  }
                } }, t('restoreTitle')),
                iconButton('trash', t('delete'), async () => {
                  const yes = await confirmAction({ title: t('deleteBackup'), message: t('deleteBackupMsg'), confirmLabel: t('delete'), danger: true });
                  if (yes) deleteCloudBackup(shopId, b.id).catch((err) => toast(errorText(err), 'error'));
                }, 'danger'),
              ),
            ))),
      ),
      el('section', { class: 'card form' },
        el('h2', { class: 'section-title' }, t('restoreTitle')),
        el('p', { class: 'muted small' }, t('restoreIntro')),
        restoreFileBtn,
        fileInput,
      ),
      el('section', { class: 'card form danger-zone' },
        el('h2', { class: 'section-title' }, t('dangerZone')),
        el('p', { class: 'muted small' }, t('clearIntro')),
        clearBtn,
        el('p', { class: 'muted small' }, t('deleteShopIntro')),
        deleteBtn,
      ),
    ),
  );
}
