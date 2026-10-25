/*
 * ShareOS app SDK – served by the apps web server, works offline.
 *   <link rel="stylesheet" href="/_shareos/theme.css">
 *   <script src="/_shareos/app.js"></script>
 *
 * ShareOS.app                 id of this app (first part of the path)
 * ShareOS.theme               { theme: 'dark'|'light', accent } – applied to <html>
 * ShareOS.onTheme(fn)         called when the user changes the look
 * ShareOS.file                the file the app was opened with, or null:
 *   .name, .mode ('view'|'edit')   (after await ShareOS.file.info())
 *   await .text() / .blob()        content
 *   await .save(textOrBlob)        write back (mode 'edit' only)
 *   .url                           address of the content (byte ranges work,
 *                                  e.g. <audio>/<video src> for seeking)
 * ShareOS.menu(el, spec)      classic menu bar (File | Edit | View …):
 *   spec = [{ label: 'Datei', items: [{ label: 'Speichern', kbd: 'Ctrl+S',
 *            action: fn, disabled: bool, checked: bool }, '-', …] }, …]
 * ShareOS.openApp(id, {width, height})
 *                             open another app of the box in its own window
 *                             (the same window ShareOS uses for it), with the
 *                             look, language and account of this one
 * ShareOS.on(type, fn) / ShareOS.emit(type, data)
 *                             messages between the apps (BroadcastChannel
 *                             'shareos'; every app hears them – no secrets)
 * ShareOS.lang                language of the ShareOS interface ('de', 'en', 'pt' …;
 *                             '' when opened without ShareOS) – for apps with
 *                             their own translations (0.2.0-beta.6+)
 * ShareOS.user                the account the app was opened by ('guest' when
 *                             opened without ShareOS)
 * ShareOS.embedded            true when shown inside the ShareOS interface
 * ShareOS.fs                  folders of the user, for apps with the permission
 *                             "files" (null otherwise); all calls return promises:
 *   .roots()                       [{name, home, usb, ro, private, personal, share}] –
 *                                  users: personal folder ("home") and their
 *                                  shares, ro = read only; accounts without
 *                                  "Dateien": first the app's own folder "app"
 *                                  (home and private: true) on the apps drive,
 *                                  then (0.2.0-beta.11+) the personal folder
 *                                  ("home", personal: true) and the shares
 *                                  (ShareOS 0.2.0-beta.9+; before: fs was null)
 *   .list(root, path, hidden)      {entries: [{name, type, size, mtime}], free, size}
 *   .mkdir(root, path, name)   .rename(root, path, name, to)
 *   .copy(root, path, names, destRoot, dest)   .move(…same…)
 *   .remove(root, path, names)
 *   .open(root, path, name, {write, create})   a file like ShareOS.file
 *   .pick({ title, ext: ['.mp3', …], multiple, save, name, folder })
 *                                  file dialog of the box: resolves to
 *                                  [{ root, path, name }] (save: the chosen
 *                                  folder and file name; folder: [{ root,
 *                                  path }] of the chosen folder) or null
 * ShareOS.torrent             the account's own Transmission daemon, for apps
 *                             with the permissions "files" and "torrent"
 *                             (ShareOS 0.2.0-beta.4+, null otherwise):
 *   .rpc(method, args)             Transmission RPC, resolves to its "arguments";
 *                                  folders as "<root>/<path>" (ShareOS.fs roots)
 * ShareOS.media               media jobs of the account on the box (ffmpeg system
 *                             app), for apps with the permissions "files" and
 *                             "media" (ShareOS 0.2.0-beta.5+, null otherwise):
 *   .probe(root, path, name)       {format, duration, size, streams: [{type, codec, …}]}
 *   .start({ input: {root, path, name}, output: {root, path, name},
 *            action: 'remux'|'audio', format, bitrate, stream, start, duration })
 *                                  {id, output}; runs in the background
 *   .jobs()   .cancel(id)   .remove(id)
 * ShareOS.vpn                 the box as an OpenVPN client, for apps with the
 *                             permissions "files" and "vpn" – admin accounts
 *                             only (ShareOS 0.2.0-beta.6+, null otherwise):
 *   .list()                        {profiles: [{name, remote, autostart, full,
 *                                  needs_auth, auth, removed}], status}
 *   .status()                      {installed, running, profile, state
 *                                  (CONNECTED …), ip, remote, since, bytes_in/out}
 *   .importProfile(name, text, {user, pass, full})   {removed: [options]}
 *   .set(name, {autostart, full, user, pass})   .remove(name)
 *   .connect(name)   .disconnect()   .log()  {log}
 *   .server.status()   .server.set({enabled, port, proto, net, host, lan})
 *   .server.addDevice(name) {profile}   .server.profile(name)   .server.removeDevice(name)
 *   .server.log()                  devices connecting to the box (own CA)
 * ShareOS.tailscale           remote access with Tailscale (system app
 *                             "tailscaled"), for apps with the permissions
 *                             "files" and "tailscale" – admin accounts only
 *                             (ShareOS 0.2.0-beta.7+, null otherwise):
 *   .status()                      {installed, running, state (NeedsLogin,
 *                                  Running, Stopped …), auth_url, self {name,
 *                                  dns, ips, key_expiry}, tailnet {name, suffix},
 *                                  peers [{name, dns, os, ips, online, last_seen,
 *                                  direct, rx, tx}], version}
 *   .up({authKey})                 connect; without a key the answer has
 *                                  auth_url (sign-in link, e.g. as QR code)
 *   .login()   .down()   .logout()   .log() {log}
 *   .ping(ip)                      {ms, via, direct}
 * ShareOS.autobrr             the box's autobrr (system app "autobrr"), for
 *                             apps with the permissions "files" and "autobrr" –
 *                             admin accounts only (ShareOS 0.2.0-beta.9+, null
 *                             otherwise):
 *   .status()                      {installed, running, ready, enabled, ui, port,
 *                                  user, account, drop, drive, host}
 *   .start()   .log() {log}   .accounts() [{name, fullname}]
 *   .set({enabled, ui, account})   ui: autobrr's own web interface on
 *                                  http://<box>:7474 (user "admin"); account:
 *                                  whose Transmission gets the torrents –
 *                                  autobrr's action "Watch dir" with the
 *                                  folder status().drop
 *   .password(pw)                  password of "admin" for that interface
 *   .api(method, path, body)       autobrr's REST API, e.g. api('GET',
 *                                  '/api/filters'); resolves to the JSON answer
 *                                  (not /api/keys or /api/auth)
 * ShareOS.sysinfo             the box's values, for apps with the permissions
 *                             "files" and "sysinfo" – admin accounts only
 *                             (ShareOS 0.2.0-beta.11+, null otherwise):
 *   .info()                        {model, board, version, hostname, kernel,
 *                                  uptime, load, cpu {total, idle} (jiffies –
 *                                  CPU use from two samples), cores, memory
 *                                  {memtotal, memavailable …}, temperature (m°C),
 *                                  fan_pwm (0–255), network {speed, rx_bytes,
 *                                  tx_bytes}, volumes [{name, mount, fs, usb,
 *                                  size, used, avail}], disks [{name, model,
 *                                  size, removable, standby}]}
 *   .processes()                   {cpu, hz, uptime, processes [{pid, ppid, name,
 *                                  cmd, kernel, user, state, threads, nice,
 *                                  ticks, start, rss}]}
 *   .kill(pid, signal)             TERM (default), KILL or HUP; not init,
 *                                  kernel threads or what ShareOS needs
 * ShareOS.netcheck            checks from the box, for apps with the
 *                             permissions "files" and "netcheck" – admin
 *                             accounts only (ShareOS 0.2.0-beta.11+):
 *   .check([{kind: 'ping', host, count}, {kind: 'tcp', host, port},
 *           {kind: 'http', url}])  up to 32 side by side; resolves to one
 *                                  result per check {ok, ms, error, …}
 *                                  (ping: sent, received, loss, min, max, ip;
 *                                  tcp: ip; http: status, cert_ok)
 *   .ping(host, count)   .tcp(host, port)   .http(url)   one check
 * ShareOS.docker              Docker hosts of the homelab (Docker Engine API,
 *                             http://host:2375 or https://host:2376), for apps
 *                             with the permissions "files" and "docker" –
 *                             admin accounts only (ShareOS 0.2.0-beta.11+):
 *   .hosts()                       [{name, label, url, insecure}]
 *   .setHost({name, label, url, insecure})   .removeHost(name)
 *   .version(host)   .info(host)   .images(host)   Docker's answer
 *   .containers(host, all)         like /containers/json (all: also stopped)
 *   .inspect(host, id)   .stats(host, id)   .logs(host, id, tail) (text)
 *   .action(host, id, 'start'|'stop'|'restart'|'pause'|'unpause')
 * ShareOS.notify              messages through the box's notification service
 *                             (web interface, e-mail, push), for apps with the
 *                             permissions "files" and "notify" – admin
 *                             accounts only (ShareOS 0.2.0-beta.12+, null
 *                             otherwise); scheduled tasks use the command
 *                             shareos-app-notify instead:
 *   .send(level, key, title, text)  level info|warn|error; the same key is one
 *                                  message (counted, sent again after 24 h at
 *                                  most); key 1–32 characters A-Z a-z 0-9 . _ -,
 *                                  title ≤ 100 (the app's name is put in
 *                                  front), text ≤ 1000; at most 20 an hour
 *   .clear(key)                    the cause is gone
 * ShareOS.tuya                Tuya smart-home devices in the local network
 *                             (protocol 3.3/3.4, no cloud), for apps with the
 *                             permissions "files" and "tuya" – admin accounts
 *                             only (ShareOS 0.2.0-beta.11+):
 *   .discover(seconds)             [{ip, id, product, version}] – devices that
 *                                  announce themselves (UDP 6666/6667, 1–20 s)
 *   .status({ip, id, key, version})          data points {"1": true, "19": 1234 …}
 *   .set({ip, id, key, version}, {"1": false})   switch; resolves to the
 *                                  changed data points
 * ShareOS.status              a chip in the header of the ShareOS interface,
 *                             for apps with the permissions "files" and
 *                             "status" (ShareOS 0.2.0-beta.6+, null otherwise):
 *   .set({ text, state: 'ok'|'warn'|'err'|'info', ttl })   text max. 24
 *                                  characters; it goes after ttl seconds
 *                                  (10–600, default 300) unless set again
 *   .clear()
 *
 * Storage per account: the apps share one web origin, so ShareOS keeps the
 * browser storage of the accounts apart – localStorage and IndexedDB of an
 * app see only the data of the account that opened it (key and database
 * names get the prefix "u:<account>:" behind the scenes; root keeps the
 * plain names). Load this script before the app's own scripts. In one
 * browser this separates, it does not protect: what must stay private goes
 * to the user's folders on the box (ShareOS.fs), checked by the box.
 *
 * URL parameters set by ShareOS: theme, accent, file (ticket), name, origin,
 * fs (grant for ShareOS.fs), user (account), lang.
 */
(function () {
	'use strict';
	var q = new URLSearchParams(location.search);
	var root = document.documentElement;
	var appId = location.pathname.split('/')[1] || '';
	var adminOrigin = q.get('origin') || '';
	var embedded = window.parent !== window;
	var themeFns = [];
	var de = /^de/i.test(q.get('lang') || document.documentElement.lang || navigator.language || '');

	/* browser storage per account (see above) */
	var NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/i;
	var user = q.get('user');
	try {
		if (user && NAME_RE.test(user)) sessionStorage.setItem('sos-user', user);
		else user = sessionStorage.getItem('sos-user');
	} catch (e) { }
	if (!user || !NAME_RE.test(user)) user = 'guest';
	var prefix = user === 'root' ? '' : 'u:' + user + ':';
	var nativeLS = null;
	try { nativeLS = window.localStorage; } catch (e) { }
	function mine(k) { return prefix ? k.indexOf(prefix) === 0 : k.indexOf('u:') !== 0; }
	function scoped(ls) {
		function keys() {
			var out = [];
			for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (k !== null && mine(k)) out.push(k.slice(prefix.length)); }
			return out;
		}
		// methods on the prototype: the proxy target itself has no own keys
		var proto = {
			getItem: function (k) { return ls.getItem(prefix + k); },
			setItem: function (k, v) { ls.setItem(prefix + k, String(v)); },
			removeItem: function (k) { ls.removeItem(prefix + k); },
			clear: function () { keys().forEach(function (k) { ls.removeItem(prefix + k); }); },
			key: function (i) { var l = keys(); return i < l.length ? l[i] : null; }
		};
		Object.defineProperty(proto, 'length', { get: function () { return keys().length; } });
		var st = Object.create(proto);
		return new Proxy(st, {
			get: function (t, p) { if (p in t || typeof p === 'symbol') return t[p]; var v = ls.getItem(prefix + p); return v === null ? undefined : v; },
			set: function (t, p, v) { if (p in t) return false; ls.setItem(prefix + p, String(v)); return true; },
			deleteProperty: function (t, p) { ls.removeItem(prefix + p); return true; },
			has: function (t, p) { return p in t || ls.getItem(prefix + p) !== null; },
			ownKeys: function () { return keys(); },
			getOwnPropertyDescriptor: function (t, p) {
				var v = typeof p === 'string' ? ls.getItem(prefix + p) : null;
				return v === null ? undefined : { value: v, enumerable: true, configurable: true, writable: true };
			}
		});
	}
	if (nativeLS && window.Proxy) {
		var mineLS = scoped(nativeLS);
		try { Object.defineProperty(window, 'localStorage', { configurable: true, enumerable: true, get: function () { return mineLS; } }); } catch (e) { }
	}
	if (window.IDBFactory && IDBFactory.prototype.open) {
		var F = IDBFactory.prototype, idbOpen = F.open, idbDel = F.deleteDatabase, idbList = F.databases;
		if (prefix) {
			F.open = function (name, v) { return v === undefined ? idbOpen.call(this, prefix + name) : idbOpen.call(this, prefix + name, v); };
			F.deleteDatabase = function (name) { return idbDel.call(this, prefix + name); };
		}
		if (idbList) F.databases = function () {
			return idbList.call(this).then(function (l) {
				return l.filter(function (d) { return mine(d.name); }).map(function (d) { return { name: d.name.slice(prefix.length), version: d.version }; });
			});
		};
	}

	// the look is the same for everybody in this browser: plain keys
	function store(k, v) { try { if (v === undefined) return nativeLS.getItem(k); nativeLS.setItem(k, v); } catch (e) { return null; } }

	function applyTheme(theme, accent) {
		if (theme !== 'light' && theme !== 'dark')
			theme = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
		if (['blue', 'green', 'red', 'white'].indexOf(accent) < 0) accent = 'blue';
		root.setAttribute('data-theme', theme);
		root.setAttribute('data-accent', accent);
		api.theme = { theme: theme, accent: accent };
		themeFns.forEach(function (fn) { try { fn(api.theme); } catch (e) { } });
	}

	/* messages between apps */
	var chan = 'BroadcastChannel' in window ? new BroadcastChannel('shareos') : null;
	var handlers = {};
	if (chan) chan.onmessage = function (ev) {
		var m = ev.data || {};
		(handlers[m.type] || []).forEach(function (fn) { try { fn(m.data, m.from); } catch (e) { } });
	};

	/* messages from the ShareOS interface (look changed) */
	window.addEventListener('message', function (ev) {
		if (!adminOrigin || ev.origin !== adminOrigin) return;
		var m = ev.data || {};
		if (m.sos === 'theme') {
			store('sos-theme', m.theme); store('sos-accent', m.accent);
			applyTheme(m.theme, m.accent);
		}
	});
	function toAdmin(msg) {
		if (!adminOrigin) return;
		var target = embedded ? window.parent : window.opener;
		try { if (target) target.postMessage(msg, adminOrigin); } catch (e) { }
	}

	/* the opened file */
	function check(r) {
		if (r.ok) return r;
		return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
	}
	function makeFile(ticket, name, mode) {
		var fileUrl = '/_shareos/cgi/file?t=' + ticket;
		var file = {
		name: name || '',
		url: fileUrl,
		mode: mode || null,
		info: function () {
			return fetch(fileUrl + '&info=1', { cache: 'no-store' }).then(check).then(function (r) { return r.json(); }).then(function (j) {
				file.name = decodeURIComponent(j.name); file.mode = j.mode; file.size = j.size;
				return j;
			});
		},
		text: function () { return fetch(fileUrl, { cache: 'no-store' }).then(check).then(function (r) { return r.text(); }); },
		blob: function () { return fetch(fileUrl, { cache: 'no-store' }).then(check).then(function (r) { return r.blob(); }); },
		save: function (data) {
			return fetch(fileUrl, { method: 'PUT', body: data }).then(check).then(function (r) { return r.json(); }).then(function (j) {
				toAdmin({ sos: 'file-saved', app: appId, name: file.name });
				return j;
			});
		}
		};
		return file;
	}
	var ticket = q.get('file');
	var file = ticket && /^[0-9a-f]{32}$/.test(ticket) ? makeFile(ticket, q.get('name')) : null;

	/* the user's folders (permission "files"); the grant survives a reload */
	var grant = q.get('fs');
	try {
		if (grant && /^[0-9a-f]{32}$/.test(grant)) sessionStorage.setItem('sos-fs-' + appId, grant);
		else grant = sessionStorage.getItem('sos-fs-' + appId);
	} catch (e) { }
	function fsCall(op, args) {
		args = args || {}; args.op = op;
		return fetch('/_shareos/cgi/fs?g=' + grant, { method: 'POST', body: JSON.stringify(args), cache: 'no-store' })
			.then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); })
			.then(function (j) { if (j.error) throw new Error(j.error); return j; });
	}
	var fs = grant && /^[0-9a-f]{32}$/.test(grant) ? {
		roots: function () { return fsCall('roots').then(function (j) { return j.roots; }); },
		list: function (root, path, hidden) { return fsCall('list', { root: root, path: path || '', hidden: !!hidden }); },
		mkdir: function (root, path, name) { return fsCall('mkdir', { root: root, path: path || '', name: name }); },
		rename: function (root, path, name, to) { return fsCall('rename', { root: root, path: path || '', name: name, to: to }); },
		copy: function (root, path, names, destRoot, dest) { return fsCall('move', { root: root, path: path || '', names: names, dest_root: destRoot || root, dest: dest || '', copy: true }); },
		move: function (root, path, names, destRoot, dest) { return fsCall('move', { root: root, path: path || '', names: names, dest_root: destRoot || root, dest: dest || '' }); },
		remove: function (root, path, names) { return fsCall('delete', { root: root, path: path || '', names: names }); },
		open: function (root, path, name, o) {
			o = o || {};
			return fsCall('open', { root: root, path: path || '', name: name, write: !!o.write, create: !!o.create }).then(function (j) {
				var f = makeFile(j.ticket, j.name, j.mode); f.size = j.size; f.exists = j.exists; return f;
			});
		}
	} : null;

	/* file dialog of the box (ShareOS.fs.pick) */
	var T = de ? { open: 'Öffnen', save: 'Speichern', cancel: 'Abbrechen', name: 'Dateiname', empty: 'Keine passenden Dateien',
			up: 'Übergeordneter Ordner', title: 'Datei von der Box', titleSave: 'Auf der Box speichern', exists: 'überschreiben?', all: 'Alle markieren', folder: 'Ordner wählen', titleFolder: 'Ordner auf der Box' }
		: { open: 'Open', save: 'Save', cancel: 'Cancel', name: 'File name', empty: 'No matching files',
			up: 'Parent folder', title: 'File from the box', titleSave: 'Save to the box', exists: 'overwrite?', all: 'Select all', folder: 'Choose folder', titleFolder: 'Folder on the box' };
	var PICK_CSS = '.sos-pick{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);font:13px var(--sos-font,system-ui,sans-serif)}'
		+ '.sos-pick>div{width:min(640px,94vw);max-height:84vh;display:flex;flex-direction:column;gap:10px;padding:16px 18px;border:1px solid var(--sos-line,#15253b);border-radius:12px;background:var(--sos-panel,#0b111a);color:var(--sos-text,#c6dff5);box-shadow:0 16px 48px rgba(0,0,0,.45)}'
		+ '.sos-pick h2{margin:0;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--sos-accent,#3da5ff)}'
		+ '.sos-pick .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sos-pick .path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sos-muted,#6f90ad)}'
		+ '.sos-pick ul{list-style:none;margin:0;padding:0;overflow:auto;min-height:160px;flex:1;border:1px solid var(--sos-line,#15253b);border-radius:8px;background:var(--sos-bg,#06090d)}'
		+ '.sos-pick li{display:flex;gap:10px;align-items:center;padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--sos-line,#15253b)}.sos-pick li:hover{background:var(--sos-bar,#0e1726)}'
		+ '.sos-pick li.sel{background:var(--sos-dim,#1d4f80);color:#fff}.sos-pick li .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sos-pick li .s{color:var(--sos-muted,#6f90ad);font-size:12px}'
		+ '.sos-pick .empty{padding:20px;text-align:center;color:var(--sos-muted,#6f90ad);cursor:default}'
		+ '.sos-pick select,.sos-pick input{min-height:32px;padding:0 10px;border:1px solid var(--sos-line,#15253b);border-radius:8px;background:var(--sos-bg,#06090d);color:var(--sos-text,#c6dff5);font:inherit}.sos-pick input{flex:1}'
		+ '.sos-pick button{min-height:32px;padding:0 12px;border:1px solid var(--sos-line,#15253b);border-radius:8px;background:var(--sos-panel,#0b111a);color:var(--sos-text,#c6dff5);font:600 12px inherit;cursor:pointer}'
		+ '.sos-pick button.primary{background:var(--sos-accent,#3da5ff);border-color:var(--sos-accent,#3da5ff);color:var(--sos-bg,#06090d)}.sos-pick button:disabled{opacity:.5;cursor:default}'
		+ '.sos-pick .err{color:var(--sos-err,#ff5f5f)}';
	function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
	function fmtSize(b) { var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0; while (b >= 1000 && i < 4) { b /= 1000; i++; } return (i ? b.toFixed(1) : b) + ' ' + u[i]; }
	function pick(o) {
		o = o || {};
		var exts = (o.ext || []).map(function (x) { return String(x).toLowerCase(); });
		if (!document.getElementById('sos-pick-css')) { var st = el('style'); st.id = 'sos-pick-css'; st.textContent = PICK_CSS; document.head.appendChild(st); }
		return new Promise(function (resolve) {
			var wrap = el('div', 'sos-pick'), box = el('div');
			wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
			var h = el('h2', null, o.title || (o.folder ? T.titleFolder : o.save ? T.titleSave : T.title));
			var top = el('div', 'row'), rootSel = el('select'), upB = el('button', null, '↑'), pathEl = el('span', 'path');
			upB.type = 'button'; upB.title = T.up; rootSel.setAttribute('aria-label', 'Volume');
			top.appendChild(rootSel); top.appendChild(upB); top.appendChild(pathEl);
			var list = el('ul'), msg = el('div', 'err');
			var bottom = el('div', 'row'), nameIn = el('input');
			nameIn.placeholder = T.name; nameIn.value = o.name || '';
			var cancelB = el('button', null, T.cancel), okB = el('button', 'primary', o.folder ? T.folder : o.save ? T.save : T.open);
			cancelB.type = okB.type = 'button';
			if (o.save && !o.folder) bottom.appendChild(nameIn); else bottom.appendChild(el('span', 'path'));
			bottom.appendChild(cancelB); bottom.appendChild(okB);
			[h, top, list, msg, bottom].forEach(function (x) { box.appendChild(x); });
			wrap.appendChild(box); document.body.appendChild(wrap);
			var cur = { root: '', path: '' }, entries = [], sel = {};
			function done(v) { document.removeEventListener('keydown', onKey, true); wrap.remove(); resolve(v); }
			function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); done(null); } }
			document.addEventListener('keydown', onKey, true);
			function chosen() { return Object.keys(sel).map(function (n) { return { root: cur.root, path: cur.path, name: n }; }); }
			function update() {
				okB.disabled = o.folder ? !cur.root : o.save ? !nameIn.value.trim() || /[\/]/.test(nameIn.value) : !Object.keys(sel).length;
				[].forEach.call(list.children, function (li) { li.classList.toggle('sel', !!sel[li.dataset.name] && li.dataset.type === 'file'); });
			}
			function load() {
				msg.textContent = ''; sel = {};
				pathEl.textContent = '/' + cur.path; upB.disabled = !cur.path;
				fs.list(cur.root, cur.path).then(function (r) {
					entries = (r.entries || []).filter(function (e) {
						if (e.type === 'dir' || e.type === 'dirlink') return true;
						if (e.type !== 'file' || o.folder) return false;
						if (!exts.length) return true;
						var n = e.name.toLowerCase();
						return exts.some(function (x) { return n.slice(-x.length) === x; });
					});
					list.innerHTML = '';
					if (!entries.length) list.appendChild(el('li', 'empty', T.empty));
					entries.forEach(function (e) {
						var dir = e.type !== 'file', li = el('li');
						li.dataset.name = e.name; li.dataset.type = dir ? 'dir' : 'file';
						li.appendChild(el('span', null, dir ? '📁' : '📄'));
						li.appendChild(el('span', 'n', e.name));
						li.appendChild(el('span', 's', dir ? '' : fmtSize(e.size || 0)));
						li.addEventListener('click', function (ev) {
							if (dir) { cur.path = (cur.path ? cur.path + '/' : '') + e.name; load(); return; }
							if (o.save) { nameIn.value = e.name; update(); return; }
							if (!(o.multiple && (ev.ctrlKey || ev.metaKey || ev.shiftKey))) sel = {};
							if (sel[e.name]) delete sel[e.name]; else sel[e.name] = true;
							update();
						});
						li.addEventListener('dblclick', function () { if (!dir && !o.save) { sel = {}; sel[e.name] = true; done(chosen()); } });
						list.appendChild(li);
					});
					update();
				}).catch(function (err) { msg.textContent = err.message; });
			}
			upB.addEventListener('click', function () { cur.path = cur.path.split('/').slice(0, -1).join('/'); load(); });
			rootSel.addEventListener('change', function () { cur.root = rootSel.value; cur.path = ''; load(); });
			nameIn.addEventListener('input', update);
			nameIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && !okB.disabled) okB.click(); });
			cancelB.addEventListener('click', function () { done(null); });
			wrap.addEventListener('click', function (ev) { if (ev.target === wrap) done(null); });
			okB.addEventListener('click', function () {
				if (o.folder) { done([{ root: cur.root, path: cur.path }]); return; }
				if (!o.save) { done(chosen()); return; }
				var n = nameIn.value.trim();
				var hit = entries.some(function (e) { return e.name === n && e.type === 'file'; });
				if (hit && !confirm('„' + n + '“ ' + T.exists)) return;
				done([{ root: cur.root, path: cur.path, name: n, exists: hit }]);
			});
			if (o.multiple && !o.save) {
				var allB = el('button', null, T.all); allB.type = 'button';
				allB.addEventListener('click', function () { sel = {}; entries.forEach(function (e) { if (e.type === 'file') sel[e.name] = true; }); update(); });
				bottom.insertBefore(allB, cancelB);
			}
			fs.roots().then(function (roots) {
				// saving needs a folder that can be written
				if (o.save) roots = roots.filter(function (r) { return !r.ro; });
				roots.forEach(function (r) {
					var t = r.private ? (de ? 'App-Daten' : 'App data') : r.home || r.personal ? (de ? 'Mein Ordner' : 'My folder')
						: r.name + (r.ro ? (de ? ' (nur lesen)' : ' (read only)') : '');
					var op = el('option', null, t); op.value = r.name; rootSel.appendChild(op);
				});
				if (!roots.length) { msg.textContent = de ? 'Kein Ordner auf der Box erreichbar.' : 'No folder on the box available.'; return; }
				cur.root = roots[0].name; load();
			}).catch(function (err) { msg.textContent = err.message; });
			update();
		});
	}
	if (fs) fs.pick = pick;

	/* media jobs of the account (permissions "files" + "media") */
	function mediaCall(op, args) {
		var body = { op: op };
		for (var k in (args || {})) if (k !== 'op') body[k] = args[k];
		return fetch('/_shareos/cgi/media?g=' + grant, { method: 'POST', body: JSON.stringify(body), cache: 'no-store' })
			.then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); })
			.then(function (j) { if (j.error) throw new Error(j.error); return j; });
	}
	/* other CGIs of the platform: same calling convention as media */
	function cgiCall(cgi, op, args) {
		var body = { op: op };
		for (var k in (args || {})) if (k !== 'op') body[k] = args[k];
		return fetch('/_shareos/cgi/' + cgi + '?g=' + grant, { method: 'POST', body: JSON.stringify(body), cache: 'no-store' })
			.then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); })
			.then(function (j) { if (j.error) throw new Error(j.error); return j; });
	}
	/* the box as a VPN client (permissions "files" + "vpn", admins) */
	var vpn = fs ? {
		list: function () { return cgiCall('vpn', 'list'); },
		status: function () { return cgiCall('vpn', 'status'); },
		log: function () { return cgiCall('vpn', 'log'); },
		importProfile: function (name, text, o) { o = o || {}; return cgiCall('vpn', 'import', { name: name, text: text, user: o.user, pass: o.pass, full: o.full !== false }); },
		set: function (name, o) { var a = { name: name }; for (var k in (o || {})) a[k] = o[k]; return cgiCall('vpn', 'set', a); },
		remove: function (name) { return cgiCall('vpn', 'remove', { name: name }); },
		connect: function (name) { return cgiCall('vpn', 'connect', { name: name }); },
		disconnect: function () { return cgiCall('vpn', 'disconnect'); },
		server: {
			status: function () { return cgiCall('vpn', 'server_status'); },
			log: function () { return cgiCall('vpn', 'server_log'); },
			set: function (o) { return cgiCall('vpn', 'server_set', o || {}); },
			addDevice: function (name) { return cgiCall('vpn', 'device_add', { name: name }); },
			profile: function (name) { return cgiCall('vpn', 'device_profile', { name: name }); },
			removeDevice: function (name) { return cgiCall('vpn', 'device_remove', { name: name }); }
		}
	} : null;
	/* the box's autobrr (permissions "files" + "autobrr", admins) */
	var autobrr = fs ? {
		status: function () { return cgiCall('autobrr', 'status'); },
		log: function () { return cgiCall('autobrr', 'log'); },
		start: function () { return cgiCall('autobrr', 'start'); },
		accounts: function () { return cgiCall('autobrr', 'accounts').then(function (j) { return j.accounts; }); },
		set: function (o) { var a = {}; o = o || {}; ['enabled', 'ui', 'account'].forEach(function (k) { if (o[k] != null) a[k] = o[k]; }); return cgiCall('autobrr', 'set', a); },
		password: function (pw) { return cgiCall('autobrr', 'password', { password: pw }); },
		api: function (method, path, body) {
			return cgiCall('autobrr', 'api', { method: method || 'GET', path: path, body: body }).then(function (j) {
				if (j.status >= 400) throw new Error((j.data && (j.data.message || j.data.error)) || j.text || ('HTTP ' + j.status));
				return j.data != null ? j.data : j.text;
			});
		}
	} : null;
	/* the box's values (permissions "files" + "sysinfo", admins) */
	var sysinfo = fs ? {
		info: function () { return cgiCall('sysinfo', 'info'); },
		processes: function () { return cgiCall('sysinfo', 'processes'); },
		kill: function (pid, signal) { return cgiCall('sysinfo', 'kill', { pid: pid, signal: signal || 'TERM' }); }
	} : null;
	/* checks from the box (permissions "files" + "netcheck", admins) */
	var netcheck = fs ? {
		check: function (list) { return cgiCall('netcheck', 'check', { checks: list }).then(function (j) { return j.results; }); },
		ping: function (host, count) { return netcheck.check([{ kind: 'ping', host: host, count: count || 1 }]).then(function (r) { return r[0]; }); },
		tcp: function (host, port) { return netcheck.check([{ kind: 'tcp', host: host, port: port }]).then(function (r) { return r[0]; }); },
		http: function (url) { return netcheck.check([{ kind: 'http', url: url }]).then(function (r) { return r[0]; }); }
	} : null;
	/* Docker hosts of the homelab (permissions "files" + "docker", admins) */
	function dockerCall(op, args) {
		return cgiCall('docker', op, args).then(function (j) { return j.text != null ? j.text : j.data; });
	}
	var docker = fs ? {
		hosts: function () { return cgiCall('docker', 'hosts').then(function (j) { return j.hosts; }); },
		setHost: function (o) { o = o || {}; return cgiCall('docker', 'host_set', { name: o.name, label: o.label, url: o.url, insecure: !!o.insecure }).then(function (j) { return j.hosts; }); },
		removeHost: function (name) { return cgiCall('docker', 'host_del', { name: name }).then(function (j) { return j.hosts; }); },
		version: function (host) { return dockerCall('version', { host: host }); },
		info: function (host) { return dockerCall('info', { host: host }); },
		images: function (host) { return dockerCall('images', { host: host }); },
		containers: function (host, all) { return dockerCall('containers', { host: host, all: all !== false }); },
		inspect: function (host, id) { return dockerCall('inspect', { host: host, id: id }); },
		stats: function (host, id) { return dockerCall('stats', { host: host, id: id }); },
		logs: function (host, id, tail) { return dockerCall('logs', { host: host, id: id, tail: tail || 200 }); },
		action: function (host, id, action) { return dockerCall('action', { host: host, id: id, action: action }); }
	} : null;
	/* messages (permissions "files" + "notify", admins) */
	var notify = fs ? {
		send: function (level, key, title, text) { return cgiCall('notify', 'send', { level: level || 'info', key: key, title: title, text: text || '' }); },
		clear: function (key) { return cgiCall('notify', 'clear', { key: key }); }
	} : null;
	/* Tuya devices (permissions "files" + "tuya", admins) */
	function tuyaDev(d) { d = d || {}; return { ip: d.ip, id: d.id, key: d.key, version: d.version || '3.3' }; }
	var tuya = fs ? {
		discover: function (seconds) { return cgiCall('tuya', 'discover', { seconds: seconds || 6 }).then(function (j) { return j.devices; }); },
		status: function (d) { return cgiCall('tuya', 'status', tuyaDev(d)).then(function (j) { return j.dps; }); },
		set: function (d, dps) { var a = tuyaDev(d); a.dps = dps; return cgiCall('tuya', 'set', a).then(function (j) { return j.dps; }); }
	} : null;
	/* remote access with Tailscale (permissions "files" + "tailscale", admins) */
	var tailscale = fs ? {
		status: function () { return cgiCall('tailscale', 'status'); },
		log: function () { return cgiCall('tailscale', 'log'); },
		up: function (o) { return cgiCall('tailscale', 'up', { authkey: (o && o.authKey) || '' }); },
		login: function () { return cgiCall('tailscale', 'login'); },
		down: function () { return cgiCall('tailscale', 'down'); },
		logout: function () { return cgiCall('tailscale', 'logout'); },
		ping: function (ip) { return cgiCall('tailscale', 'ping', { ip: ip }); }
	} : null;
	/* a chip in the header of the ShareOS interface (permissions "files" + "status") */
	var status = fs ? {
		set: function (o) { o = o || {}; return cgiCall('status', 'set', { text: o.text, state: o.state || 'info', ttl: o.ttl || 300 }); },
		clear: function () { return cgiCall('status', 'clear'); }
	} : null;
	var media = fs ? {
		probe: function (root, path, name) { return mediaCall('probe', { root: root, path: path || '', name: name }); },
		start: function (o) { return mediaCall('start', o || {}); },
		jobs: function () { return mediaCall('jobs'); },
		cancel: function (id) { return mediaCall('cancel', { id: id }); },
		remove: function (id) { return mediaCall('remove', { id: id }); }
	} : null;

	/* the account's own Transmission daemon (permissions "files" + "torrent") */
	var torrent = fs ? {
		rpc: function (method, args) {
			return fetch('/_shareos/cgi/transmission?g=' + grant, { method: 'POST', cache: 'no-store',
				body: JSON.stringify({ method: method, arguments: args || {} }) })
				.then(function (r) { return r.json().catch(function () { return { result: 'HTTP ' + r.status }; }); })
				.then(function (j) { if (j.result !== 'success') throw new Error(j.result || 'failed'); return j.arguments || {}; });
		}
	} : null;

	/* classic menu bar */
	function keyOf(ev) {
		var k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
		return (ev.ctrlKey || ev.metaKey ? 'Ctrl+' : '') + (ev.altKey ? 'Alt+' : '') + (ev.shiftKey ? 'Shift+' : '') + k;
	}
	function menu(el, spec) {
		var shortcuts = {};
		el.classList.add('sos-menubar');
		el.setAttribute('role', 'menubar');
		el.innerHTML = '';
		var openOne = null;
		function close() { if (openOne) { openOne.classList.remove('open'); openOne = null; } }
		spec.forEach(function (m) {
			var li = document.createElement('div');
			li.className = 'sos-menuitem';
			var b = document.createElement('button');
			b.type = 'button'; b.textContent = m.label; b.setAttribute('aria-haspopup', 'true');
			var ul = document.createElement('div');
			ul.className = 'sos-menu'; ul.setAttribute('role', 'menu');
			(m.items || []).forEach(function (it) {
				if (it === '-') { ul.appendChild(document.createElement('hr')); return; }
				var ib = document.createElement('button');
				ib.type = 'button'; ib.setAttribute('role', 'menuitem');
				var span = document.createElement('span'); span.textContent = it.label;
				if (it.checked) span.className = 'sos-check';
				ib.appendChild(span);
				if (it.kbd) { var k = document.createElement('kbd'); k.textContent = it.kbd; ib.appendChild(k); shortcuts[it.kbd] = it; }
				ib.disabled = !!it.disabled;
				ib.addEventListener('click', function () { close(); if (it.action) it.action(); });
				ul.appendChild(ib);
			});
			b.addEventListener('click', function () {
				var was = openOne === li; close();
				if (!was) { li.classList.add('open'); openOne = li; var first = ul.querySelector('button:not(:disabled)'); if (first) first.focus(); }
			});
			b.addEventListener('mouseenter', function () { if (openOne && openOne !== li) { close(); li.classList.add('open'); openOne = li; } });
			li.appendChild(b); li.appendChild(ul); el.appendChild(li);
		});
		document.addEventListener('click', function (ev) { if (!el.contains(ev.target)) close(); });
		document.addEventListener('keydown', function (ev) {
			if (ev.key === 'Escape') { close(); return; }
			var it = shortcuts[keyOf(ev)];
			if (it && !it.disabled && it.action) { ev.preventDefault(); close(); it.action(); }
		});
		return { close: close };
	}

	// another app in its own window; returns the window (null: pop-up blocked)
	function openApp(id, size) {
		if (!/^[a-z][a-z0-9-]{1,31}$/.test(id || '')) return null;
		size = size || {};
		var p = new URLSearchParams({ theme: (api.theme || {}).theme || '', accent: (api.theme || {}).accent || '', user: user, lang: de ? 'de' : (q.get('lang') || '') });
		if (adminOrigin) p.set('origin', adminOrigin);
		var w = Math.max(400, Math.min(+size.width || 1000, screen.availWidth || 4000));
		var h = Math.max(300, Math.min(+size.height || 700, screen.availHeight || 4000));
		return window.open('/' + id + '/index.html?' + p.toString(), 'sosapp-' + id, 'popup,width=' + w + ',height=' + h);
	}

	var api = {
		app: appId,
		openApp: openApp,
		user: user,
		lang: (q.get('lang') || '').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 8),
		embedded: embedded,
		theme: null,
		onTheme: function (fn) { themeFns.push(fn); if (api.theme) fn(api.theme); },
		file: file,
		fs: fs,
		torrent: torrent,
		media: media,
		vpn: vpn,
		tailscale: tailscale,
		autobrr: autobrr,
		sysinfo: sysinfo,
		netcheck: netcheck,
		docker: docker,
		tuya: tuya,
		notify: notify,
		status: status,
		menu: menu,
		on: function (type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
		emit: function (type, data) { if (chan) chan.postMessage({ type: type, data: data, from: appId }); },
		resize: function () { if (embedded) toAdmin({ sos: 'resize', app: appId, height: document.documentElement.scrollHeight }); }
	};
	window.ShareOS = api;

	if (q.get('theme')) { store('sos-theme', q.get('theme')); store('sos-accent', q.get('accent') || ''); }
	applyTheme(q.get('theme') || store('sos-theme'), q.get('accent') || store('sos-accent'));
	if (embedded) {
		root.setAttribute('data-embedded', '');
		if ('ResizeObserver' in window)
			addEventListener('DOMContentLoaded', function () { new ResizeObserver(api.resize).observe(document.documentElement); });
	}
})();
