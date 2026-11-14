/* ---------- per-view setup after render ------------------------------------- */

const VIEWS_AFTER = {
	apps() { appsAfter(); },
	system() {
		const sub = S.route.sub;
		if (sub === 'logs') {
			loadLog();
			$('#log-src')?.addEventListener('change', (e) => { S.logSrc = e.target.value; loadLog(); });
			// snapshots of the last starts (kept across a power cut)
			if (!S.bootlogs) rpc('shareos.system', 'bootlogs').then((r) => { S.bootlogs = r.logs || []; if (S.bootlogs.length && S.route.sub === 'logs') renderMain(); }).catch(() => { S.bootlogs = []; });
		}
		if (sub !== 'terminal') { if (S.term) S.term = null; S.sysapps = null; }
		if (sub === 'notifications') {
			if (!S.noteCfg) loadNoteCfg();
			if (!S.notes) loadNotes();
			$('#f-notify')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				const a = { email: f.email.checked, smtp_host: f.smtp_host.value.trim(), smtp_tls: f.smtp_tls.value, smtp_port: f.smtp_port.value.trim(),
					smtp_user: f.smtp_user.value.trim(), mail_from: f.mail_from.value.trim(), mail_to: f.mail_to.value.trim(), email_level: f.email_level.value,
					push: f.push.checked, push_type: f.push_type.value, push_url: f.push_url.value.trim(), push_chat: f.push_chat.value.trim(), push_level: f.push_level.value,
					temp_max: +f.temp_max.value, disk_full: +f.disk_full.value };
				if (f.smtp_pass.value) a.smtp_pass = f.smtp_pass.value;
				if (f.push_token.value) a.push_token = f.push_token.value;
				try { S.noteCfg = await rpc('shareos.notify', 'set', a); toast('Saved.'); renderMain(); }
				catch (err) { toast('Messages: ' + err.message, true); }
			});
			$('#f-notify select[name=push_type]')?.addEventListener('change', (e) => {
				const tg = e.target.value === 'telegram';
				document.querySelectorAll('#f-notify [data-push]').forEach((el) => { el.hidden = (el.dataset.push === 'tg') !== tg; });
			});
		}
		if (sub === 'time') {
			if (!S.time) loadTime();
			clearInterval(S.clockTimer);
			S.clockTimer = setInterval(() => {
				if (!$('#clock-now') || !S.time) { clearInterval(S.clockTimer); return; }
				const t = { ...S.time, now: Math.floor(Date.now() / 1000) + S.timeOffset };
				$('#clock-now').textContent = boxTime(t); $('#clock-date').textContent = boxDate(t);
			}, 1000);
			$('#f-time')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, servers = f.servers.value.split(/\s+/).map((x) => x.trim()).filter(Boolean);
				try { setTime(await rpc('shareos.time', 'set', { timezone: f.tz.value, ntp: f.ntp.checked, servers })); toast('Saved.'); renderMain(); }
				catch (err) { toast('Time: ' + err.message, true); }
			});
			$('#f-clock')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const sec = fromLocalInput(e.target.dt.value, S.time.timezone);
				if (sec == null) { toast('Invalid time.', true); return; }
				try { setTime(await rpc('shareos.time', 'set_clock', { time: sec })); toast('Time set.'); renderMain(); }
				catch (err) { toast('Time: ' + err.message, true); }
			});
		}
		if (sub === 'network') {
			if (!S.net) loadNet();
			$('#net-proto')?.addEventListener('change', (e) => { $('#net-static').hidden = e.target.value !== 'static'; });
			$('#f-net')?.addEventListener('submit', netSubmit);
		}
		if (sub === 'power') {
			if (!S.hw) loadHw();
			if (!S.pwr) rpc('shareos.system', 'power_schedule').then((r) => { S.pwr = r; if (S.route.sub === 'power') renderMain(); }).catch((e) => toast('Schedule: ' + e.message, true));
			$('#f-power')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, days = {};
				for (const [d] of PWR_DAYS) days[d] = { on: f['on_' + d]?.value || '', off: f['off_' + d].value || '' };
				try {
					S.pwr = await rpc('shareos.system', 'power_schedule_set', { enabled: f.enabled.checked, days });
					S.pwrEdit = false;
					if (S.pwr.arm_error) toast(`Schedule saved, but the wake-up alarm could not be set: ${S.pwr.arm_error}`, true);
					else toast(!S.pwr.enabled ? 'Schedule saved (switched off).' : S.pwr.next_on ? `Schedule saved – the box switches on on ${fmtPwr(S.pwr.next_on)}.` : 'Schedule saved – no switch-on planned.');
					renderMain();
				}
				catch (err) { toast('Schedule: ' + err.message, true); }
			});
			document.querySelectorAll('#f-fan input[name=preset]').forEach((r) => r.addEventListener('change', () => { $('#fan-custom').hidden = r.value !== 'custom'; }));
			$('#f-fan')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, preset = $('input[name=preset]:checked', f).value;
				try {
					const r = await rpc('shareos.hw', 'set_fan', { preset, off_temp: +f.off_temp.value, full_temp: +f.full_temp.value, half_temp: +f.half_temp.value });
					S.hw.fan = r.fan; toast('Fan saved.');
				} catch (err) { toast('Fan: ' + err.message, true); }
			});
			for (const k of ['status', 'power', 'disks'])
				$('#led-' + k)?.addEventListener('change', async (e) => {
					try { const r = await rpc('shareos.hw', 'set_led', { [k]: e.target.value }); S.hw.led = r.led; toast('LED saved.'); }
					catch (err) { toast('LED: ' + err.message, true); }
				});
		}
		if (sub === 'network') {
			if (!S.web) loadWeb();
			$('#ddns-prov')?.addEventListener('change', (e) => { S.ddnsProv = e.target.value; renderMain(); });
			$('#f-ddns')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				const v = { enabled: f.enabled.checked, provider: f.provider.value, host: f.host.value.trim(), token: f.token.value, user: f.user.value.trim(), url: f.url.value.trim(), ipv4: f.ipv4.checked, ipv6: f.ipv6.checked };
				if (v.enabled && (!v.provider || !v.host)) { toast('Please enter provider and name.', true); return; }
				try {
					const r = await rpc('shareos.web', 'ddns_set', v);
					S.ddnsProv = null;
					toast(r.pending ? 'Saved – the address is being reported.' : 'Saved.');
					await loadNetExtra(); renderMain();
					if (r.pending) setTimeout(async () => { await loadNetExtra(); if (S.route.sub === 'network') renderMain(); }, 6000);
				} catch (err) { toast('DynDNS: ' + err.message, true); }
			});
			$('#f-ca-issue')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, hosts = f.hosts.value.split(/[\s,;]+/).filter(Boolean);
				if (!f.name.value.trim() || !hosts.length) { toast('Please enter name and host names.', true); return; }
				try { await rpc('shareos.web', 'ca_issue', { name: f.name.value.trim(), hosts }); toast('Certificate issued.'); await loadNetExtra(); renderMain(); }
				catch (err) { toast('Certificate: ' + err.message, true); }
			});
			$('#f-acme')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				try { await rpc('shareos.web', 'acme_issue', { email: f.email.value.trim(), staging: f.staging.checked }); await loadNetExtra(); renderMain(); }
				catch (err) { toast('Let\'s Encrypt: ' + err.message, true); }
			});
			$('#opt-https')?.addEventListener('change', (e) => webSet({ https: e.target.checked }));
			$('#opt-redirect')?.addEventListener('change', (e) => webSet({ redirect: e.target.checked }));
			$('#f-webhost')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const h = e.target.host.value.trim();
				try {
					await rpc('shareos.web', 'set', { host: h });
					S.web.host = h; if (S.apps) S.apps.installed = null;
					toast('Name saved.'); renderMain();
				} catch (err) { toast('Name: ' + err.message, true); }
			});
			document.querySelectorAll('#f-cert input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
				const f = inp.files[0];
				if (f) $(`#f-cert textarea[name=${inp.dataset.target}]`).value = await f.text();
			}));
			$('#f-cert')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, btn = $('button[type=submit]', f);
				btn.disabled = true;
				try {
					const r = await rpc('shareos.web', 'install', { cert: f.cert.value.trim() + '\n', key: f.key.value.trim() + '\n' });
					S.web.cert = r.cert;
					f.reset();
					toast('Certificate installed.');
					afterWebRestart();
				} catch (err) { toast('Certificate: ' + err.message, true); btn.disabled = false; }
			});
		}

		if (sub === 'firmware') {
			$('#f-bin')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, file = f.file.files[0], box = $('#bin-info'), btn = $('button[type=submit]', f);
				if (!file) return;
				btn.disabled = true;
				if (/\.tar$/i.test(file.name)) {
					try {
						const sha = f.sha.files[0] ? (await f.sha.files[0].text()).slice(0, 400) : '';
						const t = await rpc('shareos.update', 'local_ticket');
						await fbSend(t.url, file, () => {});
						await rpc('shareos.update', 'local', { sha256: sha });
						f.reset();
						toast('Uploaded – the bundle is being checked.');
						S.updPending = { state: 'verifying', until: Date.now() + 15000 };
						S.upd = { ...S.upd, state: 'verifying', release: { tag: 'local', version: '' } };
						renderMain();
						refreshUpdateStatus();
					} catch (err) { toast('Firmware file: ' + err.message, true); }
					btn.disabled = false;
					return;
				}
				try {
					const t = await rpc('shareos.update', 'bin_ticket');
					await fbSend(t.url, file, () => {});
					const i = await rpc('shareos.update', 'bin_info');
					const kind = { shareos: 'ShareOS', altf: 'Alt-F', other: 'other firmware' }[i.kind] || i.kind;
					box.innerHTML = html`<dl class="kv" style="margin-top:10px"><dt>Type</dt><dd><b>${kind}</b></dd><dt>Kernel</dt><dd>${i.kernel}</dd>
						<dt>Size</dt><dd>${fmtBytes(+i.kernel_size)} + ${fmtBytes(+i.initramfs_size)}</dd></dl>
						${i.kind === 'altf' || i.kind === 'other' ? html`<p class="note" style="color:var(--amber)">Afterwards ${kind} starts. Alt-F's extra packages are missing then – flash the same file once more in Alt-F's firmware page. Back to ShareOS: flash the ShareOS .bin in Alt-F, system and settings are still there.</p>` : ''}
						<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="bin-write">Install</button></div>`.s;
					$('#bin-write').addEventListener('click', async () => {
						if (!await confirmDlg(`Install ${kind}?`, 'Kernel and boot system are replaced and checked. Do not switch the box off while writing.', 'Install', true)) return;
						cover('Writing firmware', 'Kernel and boot system – please wait, do not switch off');
						try {
							await rpc('shareos.update', 'bin_write', { confirm: true });
							uncover();
							if (await confirmDlg('Written', `${kind} is in flash. Restart now?`, 'Reboot')) {
								try { await rpc('shareos.system', 'reboot'); } catch (err) { }
								stopPolling();
								if (i.kind === 'shareos') waitForBox('Rebooting', `${kind} is starting`);
								else cover('Rebooting', `${kind} is starting – its interface will be at ${location.hostname} shortly (port 80).`);
							}
						} catch (err) { uncover(); toast('Install: ' + err.message, true); }
					});
				} catch (err) { box.innerHTML = ''; toast('Firmware file: ' + err.message, true); }
				btn.disabled = false;
			});
		}
		if (sub === 'general') {
			if (!S.widget) loadWidget();
			$('#app-install')?.addEventListener('click', async () => {
				const ev = S.installEvt; if (!ev) return;
				ev.prompt();
				try { await ev.userChoice; } catch (e) { }
				S.installEvt = null; renderMain();
			});
			$('#opt-widget')?.addEventListener('change', (e) => widgetSet({ enabled: e.target.checked }));
			$('#widget-renew')?.addEventListener('click', async () => {
				if (await confirmDlg('Create a new key?', 'The old address stops working – widgets need the new one.', 'Create', true)) widgetSet({ renew: true });
			});
			$('#widget-copy')?.addEventListener('click', () => copyText($('#widget-url').value));
			$('#f-host').addEventListener('submit', async (e) => {
				e.preventDefault();
				try {
					const r = await rpc('shareos.system', 'set_hostname', { hostname: e.target.hostname.value.trim() });
					toast(r.cert_renewed ? 'Hostname saved. The HTTPS certificate was reissued for the new name – the browser will ask once more.' : 'Hostname saved.');
					tick();
				}
				catch (err) { toast('Hostname: ' + err.message, true); }
			});
			if (!S.backupOffer) rpc('shareos.backup', 'offer').then((o) => {
				S.backupOffer = o;
				const k = $('#backup-keys');
				if (k) { k.innerHTML = backupKeys().s; for (const c of k.querySelectorAll('input')) c.disabled = !$('#f-backup').pw.value; }
			}).catch(() => {});
			$('#f-backup').pw.addEventListener('input', (e) => { for (const c of e.target.form.querySelectorAll('#backup-keys input')) c.disabled = !e.target.value; });
			$('#f-backup').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, btn = $('button[type=submit]', f);
				btn.disabled = true;
				try {
					const r = await rpc('shareos.backup', 'export', { password: f.pw.value, certificate: !!f.cert?.checked && !!f.pw.value, ca: !!f.ca?.checked && !!f.pw.value });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(new Blob([r.content], { type: 'application/json' }));
					a.download = r.filename;
					document.body.append(a); a.click(); a.remove();
					setTimeout(() => URL.revokeObjectURL(a.href), 5000);
					f.reset();
					toast(r.encrypted ? 'Encrypted backup downloaded.' : 'Backup downloaded.');
				} catch (err) { toast('Backup: ' + err.message, true); }
				btn.disabled = false;
			});
			$('#f-restore').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target, file = f.file.files[0];
				if (!file) return;
				const content = await file.text();
				const box = $('#restore-preview');
				try {
					const p = await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: false });
					box.innerHTML = html`<dl class="kv" style="margin-top:12px">
						<dt>Device</dt><dd>${p.host || '–'}</dd>
						<dt>Created</dt><dd>${p.created ? new Date(p.created * 1000).toLocaleString(LOC) : '–'}</dd>
						<dt>ShareOS</dt><dd>${p.version || '–'}</dd>
						<dt>User accounts</dt><dd>${p.users.join(', ') || '–'}</dd>
						<dt>Groups</dt><dd>${(p.groups || []).join(', ') || '–'}</dd>
						<dt>Shares</dt><dd>${p.shares.join(', ') || '–'}</dd>
						<dt>Services</dt><dd>${(p.services || []).map((x) => REC_SERVICES[x] || x).join(', ') || '–'}</dd>
						<dt>Apps</dt><dd>${(p.apps || []).map((a) => a.name || a.id).join(', ') || '–'}</dd>
						<dt>Certificate</dt><dd>${p.certificate ? 'yes' : 'no'}</dd>
						<dt>Own CA</dt><dd>${p.ca ? 'yes' : 'no'}${p.ca && p.ca_certs?.length ? html` <span class="mut">(${p.ca_certs.length} issued certificates)</span>` : ''}</dd></dl>
						<p class="note" style="color:var(--amber)">Root password, network, device name, time zone, drives and the settings of the web interface are taken over right away. Then the box restarts and asks in recovery mode what else should come back. Data on the drives stays untouched.</p>
						<div class="acts" style="margin-top:10px"><button class="btn danger" type="button" id="restore-apply">Restore</button></div>`.s;
					$('#restore-apply').addEventListener('click', async () => {
						if (!await confirmDlg('Restore settings?', 'Root password, network, name, time zone and drives come from the backup right away, then the box restarts. You choose the rest afterwards in recovery mode.', 'Restore and restart', true)) return;
						try {
							await rpc('shareos.backup', 'restore', { content, password: f.pw.value, apply: true });
							try { await rpc('shareos.system', 'reboot'); } catch (err) { }
							stopPolling();
							waitForBox('Rebooting', 'Then it continues in recovery mode');
						} catch (err) { toast('Restore: ' + err.message, true); }
					});
				} catch (err) {
					box.innerHTML = '';
					toast(err.message === 'password required' ? 'The backup is encrypted – please enter the password.' : 'Backup: ' + err.message, true);
				}
			});
			$('#f-pass').addEventListener('submit', async (e) => {
				e.preventDefault();
				const f = e.target;
				if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
				try { await rpc('shareos.system', 'set_password', { password: f.p1.value }); f.reset(); toast('Password changed.'); }
				catch (err) { toast('Password: ' + err.message, true); }
			});
		}
		if (sub === 'appearance') {
			$('#opt-theme').addEventListener('change', (e) => { S.theme = e.target.value; applyTheme(); renderHeader(); renderMain(); saveLook({ theme: S.theme }); });
			$('#opt-lang').addEventListener('change', async (e) => {
				try {
					await rpc('shareos.ui', 'set', { lang: e.target.value });
					try { localStorage.setItem('shareos.lang', e.target.value); } catch (err) { }
					location.reload();
				} catch (err) { toast('Language: ' + err.message, true); }
			});
			$('#opt-logo').addEventListener('change', async (e) => {
				const on = e.target.checked;
				try {
					await rpc('shareos.ui', 'set', { logo: on });
					S.logo = on; store.set('logo', on ? '1' : '0'); renderHeader(); renderMain();
				} catch (err) { e.target.checked = !on; toast('Logo: ' + err.message, true); }
			});
			$('#opt-scan').addEventListener('change', (e) => { S.scan = e.target.checked; store.set('scan', S.scan ? '1' : '0'); applyTheme(); });
			document.querySelectorAll('.chip-show').forEach((c) => c.addEventListener('change', () => {
				const h = new Set(chipHidden());
				if (c.checked) h.delete(c.dataset.id); else h.add(c.dataset.id);
				store.set('chips.hidden', JSON.stringify([...h]));
				renderHeader();
			}));
			document.querySelectorAll('.opt-area').forEach((cb) => cb.addEventListener('change', async (e) => {
				const k = e.target.dataset.area, on = e.target.checked;
				try {
					const r = await rpc('shareos.ui', 'set', { areas: { [k]: on } });
					S.areas = r.areas; renderTabs(); if (S.desk && typeof deskAreas === 'function') deskAreas(); toast(on ? 'Area switched on.' : 'Area switched off.');
				} catch (err) { e.target.checked = !on; toast('Area: ' + err.message, true); }
			}));
		}
		if (sub === 'firmware') {
			$('#channel')?.addEventListener('change', async (e) => {
				try {
					await rpc('shareos.update', 'set_channel', { channel: e.target.value });
					checkUpdates();
				} catch (err) { toast('Channel: ' + err.message, true); }
			});
		}
	},
	storage() {
		if (S.route.sub === 'snapshots') { snapAfter(); return; }
		if (!S.stActive) loadStorage();
		$('#smart-sched')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'smart_schedule', { mode: e.target.value }); S.storage.smart_schedule = e.target.value; toast('Schedule saved.'); }
			catch (err) { toast('Self-test: ' + err.message, true); }
		});
		$('#f-usbcopy')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { S.storage.usb_copy = await rpc('shareos.storage', 'usb_copy_config', { enabled: f.enabled.checked, volume: f.volume.value, path: f.path.value.trim() }); toast('USB button saved.'); renderMain(); }
			catch (err) { toast('USB button: ' + err.message, true); }
		});
		$('#spindown')?.addEventListener('change', async (e) => {
			try { await rpc('shareos.storage', 'spindown', { minutes: +e.target.value }); toast('Spindown saved.'); }
			catch (err) { toast('Standby: ' + err.message, true); }
		});
	},
	cloud() {
		if (S.cloud?.scope !== 'admin') { loadCloud('admin'); return; }
		cloudAfter('admin');
	},
	dnsfilter() {
		if (!S.df) { loadDnsfilter(); return; }
		$('#f-df')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, args = { enabled: f.enabled.checked, web_port: +f.web_port.value, https_port: +f.https_port.value };
			if (f.protection) args.protection = f.protection.checked;
			if (f.upstream) args.upstream = f.upstream.value.split('\n').map((x) => x.trim()).filter(Boolean);
			const b = $('button[type=submit]', f); b.disabled = true;
			try {
				const r = await rpc('shareos.dnsfilter', 'set', args);
				// switched on: show "starting …" at once, the status follows every 3 s
				if (args.enabled && !S.df.running) { S.dfStarting = true; S.df = { ...S.df, enabled: true, start_error: null }; renderMain(); }
				toast(r.ok && args.enabled && !S.df.running ? 'DNS filter is starting …' : 'Saved.'); loadDnsfilter();
			} catch (err) { b.disabled = false; toast('DNS filter: ' + err.message, true); }
		});
		$('#f-dfadd')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.dnsfilter', 'filter_add', { name: f.name.value.trim(), url: f.url.value.trim() }); toast('List added.'); loadDnsfilter(); }
			catch (err) { toast('List: ' + err.message, true); }
		});
		$('#f-dfrw')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.dnsfilter', 'rewrite_add', { domain: f.domain.value.trim(), answer: f.answer.value.trim() }); f.reset(); toast('Entry added.'); loadDnsfilter(); }
			catch (err) { toast('Entry: ' + err.message, true); }
		});
		document.querySelectorAll('.df-en').forEach((c) => c.addEventListener('change', async () => {
			try { await rpc('shareos.dnsfilter', 'filter_enable', { url: c.dataset.url, enabled: c.checked }); loadDnsfilter(); }
			catch (err) { toast('List: ' + err.message, true); }
		}));
	},
	paperless() {
		if (!S.pl || !S.acc || !S.shares) { loadPaperless(); return; }
		const kind = $('#f-inbox select[name=kind]');
		const syncKind = () => { if (!kind) return; $('#ib-owner').hidden = kind.value !== 'user'; $('#ib-share').hidden = kind.value !== 'share'; };
		kind?.addEventListener('change', syncKind); syncKind();
		$('#f-pl')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target;
			try { await rpc('shareos.paperless', 'set_global', { url: f.url.value.trim(), interval: +f.interval.value, after: f.after.value, enabled: f.enabled.checked }); toast('Saved.'); loadPaperless(); }
			catch (err) { toast('Paperless: ' + err.message, true); }
		});
		$('#f-inbox')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, ed = S.plEdit, x = ed.data, kindv = f.kind.value;
			const owner = ed.mode === 'new' ? (kindv === 'user' ? f.owner.value : '') : x.owner;
			const share = ed.mode === 'new' ? (kindv === 'share' ? f.share.value : '') : x.share;
			const name = ed.mode === 'new' ? (owner ? 'u_' + owner : share.replace(/-/g, '_')) : x.name;
			const args = { name, owner, share, token: f.token.value.trim(), enabled: f.enabled.checked };
			if (ed.tags) args.tags = [...document.querySelectorAll('#f-inbox .ib-tag:checked')].map((c) => +c.value);
			try { await rpc('shareos.paperless', 'inbox_set', args); S.plEdit = null; toast(`Inbox “${name}” saved.`); loadPaperless(); }
			catch (err) { toast('Inbox: ' + err.message, true); }
		});
	},
	shares() {
		if (S.route.sub === 'files') return;
		// Paperless loads shares and accounts too, but not the volumes
		if (!S.shares || !S.acc || !S.vols) { loadShareData(); return; }
		$('#opt-smb')?.addEventListener('change', (e) => shareGlobal({ smb: e.target.checked }));
		$('#opt-nfs')?.addEventListener('change', (e) => shareGlobal({ nfs: e.target.checked }));
		$('#opt-wg')?.addEventListener('change', (e) => shareGlobal({ workgroup: e.target.value.trim() }));
		$('#opt-smbcompat')?.addEventListener('change', (e) => shareGlobal({ smb_compat: e.target.checked }));
		$('#f-user select[name=role]')?.addEventListener('change', (e) => { $('#u-web-row').hidden = e.target.value !== 'user'; });
		// a vault: SMB only, no guests, no NFS
		const vaultSync = () => {
			const f = $('#f-share'); if (!f) return;
			const v = f.vault.checked;
			for (const n of ['guest', 'nfs', 'nfs_rw']) { if (v) f[n].checked = false; f[n].disabled = v; }
			if (v) f.smb.checked = true;
			f.smb.disabled = v; f.vault_ttl.disabled = !v;
		};
		$('#f-share input[name=vault]')?.addEventListener('change', vaultSync);
		vaultSync();
		$('#f-share')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, rw = [], ro = [];
			document.querySelectorAll('#f-share select.acl').forEach((s2) => { if (s2.value === 'rw') rw.push(s2.dataset.tag); if (s2.value === 'ro') ro.push(s2.dataset.tag); });
			const args = { name: f.name.value.trim().toLowerCase(), volume: f.volume.value, path: f.path.value.trim() || f.name.value.trim().toLowerCase(), comment: f.comment.value.trim(),
				smb: f.smb.checked, guest: f.guest.checked, nfs: f.nfs.checked, nfs_rw: f.nfs_rw.checked,
				nfs_hosts: f.nfs_hosts.value.split(/[\s,;]+/).filter(Boolean), rw, ro, vault: f.vault.checked, vault_ttl: +f.vault_ttl.value };
			if (args.vault) { args.guest = false; args.nfs = false; }
			if (args.nfs && !args.nfs_hosts.length) { toast('Enter at least one client (IP or network) for NFS.', true); return; }
			try { S.shares = await rpc('shareos.shares', 'set', args); S.shEdit = null; toast(`Share “${args.name}” saved.`); renderMain(); }
			catch (err) { toast('Share: ' + err.message, true); }
		});
		$('#f-user')?.addEventListener('submit', async (e) => {
			e.preventDefault();
			const f = e.target, isNew = S.uEdit.mode === 'new';
			const args = { name: f.name.value.trim().toLowerCase(), fullname: f.fullname.value.trim(), role: f.role.value, home: f.home.value,
				quota: Math.max(0, Math.round(+f.quota.value || 0)) * 1000, web: f.web.checked, cloud: f.cloud.checked, files: f.files.checked,
				groups: [...document.querySelectorAll('#f-user .u-group:checked')].map((x) => x.value) };
			if (isNew) {
				if (f.p1.value !== f.p2.value) { toast('The passwords do not match.', true); return; }
				args.password = f.p1.value;
			}
			try { S.acc = await rpc('shareos.accounts', isNew ? 'add' : 'set', args); S.uEdit = null; toast(isNew ? `User “${args.name}” created.` : `User “${args.name}” saved.`); renderMain(); }
			catch (err) { toast('User: ' + err.message, true); }
		});
	},
	services() {
		if (S.route.sub === 'dlna') { dlnaAfter(); return; }
		if (S.route.sub === 'printer') { printerAfter(); return; }
		if (S.route.sub === 'ups') { upsAfter(); return; }
		if (S.route.sub === 'torrent') { tremoteAfter(); return; }
		loadServicesFresh();
		document.querySelectorAll('.as-toggle').forEach((c) => c.addEventListener('change', async () => {
			c.disabled = true;
			try {
				const r = await rpc('shareos.service', 'autostart', { name: c.dataset.name, enabled: c.checked });
				const s = S.services.find((x) => x.name === r.name);
				if (s) s.autostart = r.autostart;
				toast(`${r.name}: ${r.autostart ? 'starts at power-on' : 'no longer starts at power-on'}`);
			} catch (err) { c.checked = !c.checked; toast(err.message, true); }
			c.disabled = false;
		}));
	},
	overview() {
		loadServicesFresh();
		// the FAV APPS bar needs the installed apps (asked once)
		if (tabOn('apps') && !S.apps?.installed && !S.apps?.tried) { S.apps = { ...S.apps, tried: true }; loadApps(['installed']); }
	}
};



