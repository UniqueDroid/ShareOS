/* ShareOS service worker – makes the web interface installable as an app.
 * Nothing is cached: the NAS is always asked directly, so the app never
 * shows stale data, and /ubus calls are never touched.
 * "Teilen mit" (Web Share Target, manifest share_target): what Android shares
 * with the installed app arrives here as a POST to ./share-target; it is kept
 * in IndexedDB and the interface uploads it after the login (app.js
 * shareInbox) into <personal folder>/Geteilt. */
const SHARE_DB = 'shareos', SHARE_STORE = 'share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function shareDb() {
	return new Promise((resolve, reject) => {
		const r = indexedDB.open(SHARE_DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore(SHARE_STORE, { keyPath: 'id', autoIncrement: true });
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

async function keepShared(req) {
	try {
		const fd = await req.formData();
		const files = fd.getAll('files').filter((f) => f instanceof File && (f.size > 0 || f.name));
		const item = { time: Date.now(), files, title: String(fd.get('title') || ''), text: String(fd.get('text') || ''), url: String(fd.get('url') || '') };
		if (files.length || item.title || item.text || item.url) {
			const db = await shareDb();
			await new Promise((resolve, reject) => {
				const tx = db.transaction(SHARE_STORE, 'readwrite');
				tx.objectStore(SHARE_STORE).add(item);
				tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
			});
			db.close();
		}
	} catch (e) { /* the interface then simply shows nothing new */ }
	return Response.redirect(new URL('./#/shared', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (e) => {
	const u = new URL(e.request.url);
	if (e.request.method === 'POST' && u.origin === location.origin && u.pathname === new URL('./share-target', self.registration.scope).pathname)
		e.respondWith(keepShared(e.request));
});
