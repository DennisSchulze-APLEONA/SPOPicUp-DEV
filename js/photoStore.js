// Persists captured photos in IndexedDB so nothing is lost when the device is offline
// or the app is closed before the upload finishes.
const DB_NAME = 'spopicup';
const DB_VERSION = 1;
const STORE = 'photos';

let dbPromise;

function openDb() {
    dbPromise ??= new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => { dbPromise = undefined; reject(request.error); };
    });
    return dbPromise;
}

async function withStore(mode, action) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        Promise.resolve(action(store)).then(r => { result = r; }, reject);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function toMetadata(record) {
    const { blob, ...metadata } = record;
    metadata.size = blob?.size ?? 0;
    return metadata;
}

export async function add(metadata, bytes) {
    const blob = new Blob([bytes], { type: metadata.contentType });
    await withStore('readwrite', store => request(store.put({ ...metadata, blob })));
}

export async function getAll() {
    const records = await withStore('readonly', store => request(store.getAll()));
    return records.map(toMetadata).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

export async function getBytes(id) {
    const record = await withStore('readonly', store => request(store.get(id)));
    if (!record) {
        return null;
    }
    return new Uint8Array(await record.blob.arrayBuffer());
}

export async function update(id, status, error) {
    await withStore('readwrite', async store => {
        const record = await request(store.get(id));
        if (record) {
            record.status = status;
            record.error = error ?? null;
            await request(store.put(record));
        }
    });
}

export async function setUploaded(id, itemId, name, webUrl) {
    await withStore('readwrite', async store => {
        const record = await request(store.get(id));
        if (record) {
            record.uploadedItemId = itemId;
            record.uploadedName = name;
            record.uploadedWebUrl = webUrl ?? null;
            await request(store.put(record));
        }
    });
}

export async function remove(id) {
    await withStore('readwrite', store => request(store.delete(id)));
}

export async function createObjectUrl(id) {
    const record = await withStore('readonly', store => request(store.get(id)));
    return record ? URL.createObjectURL(record.blob) : null;
}

export function revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
}

export async function requestPersistence() {
    if (navigator.storage?.persist) {
        return await navigator.storage.persist();
    }
    return false;
}

export function isOnline() {
    return navigator.onLine;
}

export function onConnectivityChanged(dotNetRef) {
    const handler = () => dotNetRef.invokeMethodAsync('OnConnectivityChanged', navigator.onLine);
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    return {
        dispose: () => {
            window.removeEventListener('online', handler);
            window.removeEventListener('offline', handler);
        }
    };
}
