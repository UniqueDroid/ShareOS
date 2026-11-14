/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.me': {
		// "Share with" of the installed app (Web Share Target): an upload
		// ticket for one shared file into the folder for shared files in the
		// personal folder ("Shared", named in the language of the box; one made
		// earlier in another language is used as it is); a name that is taken
		// gets " (2)", " (3)" … – nothing is replaced
		share_ticket: {
			args: { name: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u) return { error: 'not allowed' };
				if (!name_ok(a.name) || substr(a.name, 0, 1) == '.') return { error: 'invalid name' };
				let c = cursor(), mounts = readfile('/proc/mounts') ?? '', h = null;
				if (acc_role(u) == 'admin') h = admin_home(c, u, mounts);
				else {
					let r = filter(user_roots(c, u, mounts), (x) => x.home)[0];
					h = r?.path;
				}
				if (!h) return { error: 'no personal folder' };
				let folder = filter(folder_all_names('shared'), (x) => stat(h + '/' + x)?.type == 'directory')[0] ?? folder_name('shared');
				let d = h + '/' + folder;
				if (lstat(d) && stat(d)?.type != 'directory') return { error: 'not a folder: ' + folder };
				if (!lstat(d)) {
					let r = files_sh(u, 'mkdir -- ' + shq(d), false);
					if (r.rc != 0) return { error: files_err(r) };
				}
				let dot = rindex(a.name, '.'), n = a.name;
				let base = dot > 0 && length(a.name) - dot <= 11 ? substr(a.name, 0, dot) : a.name, ext = substr(a.name, length(base));
				for (let i = 2; lstat(d + '/' + n); i++) {
					if (i > 999) return { error: 'already exists' };
					n = base + ' (' + i + ')' + ext;
				}
				system('mkdir -p ' + FILES_TICKETS + ' && chmod 700 ' + FILES_TICKETS);
				system('find ' + FILES_TICKETS + ' -type f -mmin +5 -delete 2>/dev/null');
				let t = new_token();
				writefile(FILES_TICKETS + '/' + t, sprintf('put\n%s\n%s\n%d\n%s\n', acc_role(u) == 'admin' ? 'root' : u, d + '/' + n, time() + 120, pct_enc(n)));
				return { url: '/cgi-bin/files?t=' + t, name: n, folder };
			}
		},

		// vault shares of this account: unlock (password again) and lock
		vault_unlock: {
			args: { share: '', minutes: 0, password: '' },
			call: function(req) {
				let u = session_user(req), a = req.args;
				if (!u) return { error: 'not allowed' };
				let r = vault_unlock(u, a.share, a.minutes || null, a.password);
				return r.error ? r : { ...r, ...me_info(u) };
			}
		},
		vault_lock: {
			args: { share: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'not allowed' };
				let c = cursor();
				if (!valid_name(req.args.share) || !vault_access(c, req.args.share, u)) return { error: 'not a vault' };
				let r = vault_lock(req.args.share, u);
				return r.error ? r : { ok: true, ...me_info(u) };
			}
		},

		// link this web session to the account that logged in
		bind: {
			args: { username: '', password: '' },
			call: function(req) {
				let u = req.args.username, sid = req.args.ubus_rpc_session;
				if (type(sid) != 'string' || !match(sid, /^[0-9a-f]{32}$/)) return { error: 'no session' };
				if (!(u == 'root' || acc_name_ok(u)) || !password_ok(u, req.args.password)) return { error: 'login failed' };
				system('mkdir -p ' + SESS_DIR + ' && chmod 700 ' + SESS_DIR);
				// drop links of sessions older than a week
				system('find ' + SESS_DIR + ' -type f -mtime +7 -delete 2>/dev/null');
				writefile(SESS_DIR + '/' + sid, u + '\n');
				return me_info(u);
			}
		},

		get: {
			call: function(req) {
				let u = session_user(req);
				return u ? me_info(u) : { error: 'session not bound' };
			}
		},


		paperless: {
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let u = session_user(req), c = cursor();
				if (!u || u == 'root') return { error: 'session not bound' };
				let g = paperless_global(c), name = 'u_' + u;
				return { url: g.url, available: g.url != '' && g.enabled && !!c.get('accounts', u, 'home'),
					inbox: c.get('paperless', name) == 'inbox' ? inbox_info(c, name) : null,
					folder: c.get('accounts', u, 'home') ? '\\\\' + read_trim('/proc/sys/kernel/hostname') + '\\' + u + '\\Paperless' : null };
			}
		},

		paperless_set: {
			args: { token: '', tags: [], enabled: true, test: false },
			call: function(req) {
				if (!module_on('paperless')) return { error: 'Paperless is not installed (system app paperless)' };
				let u = session_user(req), c = cursor();
				if (!u || u == 'root') return { error: 'session not bound' };
				if (!c.get('accounts', u, 'home')) return { error: 'you have no personal folder' };
				if (!c.get('paperless', 'global', 'url')) return { error: 'Paperless is not set up on this box' };
				let a = req.args, name = 'u_' + u;
				if (a.token && !token_ok(a.token)) return { error: 'invalid token' };
				if (a.test) {
					let tok = a.token || c.get('paperless', name, 'token');
					if (!tok) return { error: 'token needed' };
					let r = sh_in(sprintf('%s test %s', PAPERLESS, shq(c.get('paperless', 'global', 'url'))), tok + '\n');
					let m = match(r.out, /ok documents=([0-9?]+)/);
					return m ? { ok: true, documents: m[1] } : tool_result(r);
				}
				if (!a.token && c.get('paperless', name) != 'inbox') return { error: 'token needed' };
				inbox_save(c, name, { owner: u, share: '', token: a.token, tags: a.tags, enabled: a.enabled });
				return { ok: true, inbox: inbox_info(c, name) };
			}
		},

		cloud: {
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { allowed: false };
				let c = cursor(), st = cloud_status();
				let shares = [];
				c.foreach('shares', 'share', (x) => { if (cloud_local_ok(c, u, 'share:' + x['.name'], 'upload')) push(shares, x['.name']); });
				return { allowed: true, installed: st.installed, remotes: cloud_remotes(u), jobs: cloud_jobs(c, u), shares };
			}
		},

		cloud_remote_add: {
			args: { name: '', type: '', params: {}, raw: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				let r = cloud_remote_add(u, req.args);
				return r.error ? r : { ok: true, remotes: cloud_remotes(u) };
			}
		},

		cloud_auth_start: {
			args: { type: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				return cloud_auth_start(u, req.args.type);
			}
		},

		cloud_auth_finish: {
			args: { url: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				return cloud_auth_finish(u, req.args.url);
			}
		},

		cloud_remote_del: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req);
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (!match(req.args.name ?? '', /^[a-z][a-z0-9_]{0,31}$/)) return { error: 'invalid name' };
				let r = tool_result(sh(CLOUD + ' remote-del ' + shq(u) + ' ' + shq(req.args.name)));
				return r.error ? r : { ok: true, remotes: cloud_remotes(u) };
			}
		},

		cloud_job_set: {
			args: { name: '', remote: '', remote_path: '', local: '', mode: '', schedule: '', bwlimit: '', enabled: true },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				let r = cloud_job_save(c, u, req.args);
				return r.error ? r : { ok: true, jobs: cloud_jobs(cursor(), u) };
			}
		},

		cloud_job_del: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (c.get('cloud', req.args.name) != 'job' || c.get('cloud', req.args.name, 'owner') != u) return { error: 'unknown job' };
				c.delete('cloud', req.args.name); c.commit('cloud');
				sh(CRON + ' sync');
				return { ok: true, jobs: cloud_jobs(cursor(), u) };
			}
		},

		cloud_job_run: {
			args: { name: '' },
			call: function(req) { if (!module_on('cloud')) return CLOUD_OFF;
				let u = session_user(req), c = cursor();
				if (!u || !me_cloud_allowed(u)) return { error: 'not allowed' };
				if (c.get('cloud', req.args.name) != 'job' || c.get('cloud', req.args.name, 'owner') != u) return { error: 'unknown job' };
				return cloud_job_start(req.args.name);
			}
		},

		ui_set: {
			// own look; null/'' = back to the look for everyone
			args: { theme: '', accent: '' },
			call: function(req) {
				let u = session_user(req), a = req.args, c = cursor();
				if (!u || u == 'root' || c.get('accounts', u) != 'user') return { error: 'session not bound' };
				if (a.theme && !(a.theme in { dark: 1, light: 1, system: 1 })) return { error: 'invalid theme' };
				if (a.accent && !(a.accent in ACCENTS)) return { error: 'invalid accent' };
				for (let k in [ 'theme', 'accent' ]) {
					if (!(k in a)) continue;
					if (a[k]) c.set('accounts', u, k, a[k]); else c.delete('accounts', u, k);
				}
				c.commit('accounts');
				return { theme: c.get('accounts', u, 'theme') ?? null, accent: c.get('accounts', u, 'accent') ?? null };
			}
		},

		fav_set: {
			// favourite apps (ids, in order), whether the bar is shown and with names or icons only;
			// a missing key stays as it is
			args: { apps: [], bar: true, text: true },
			call: function(req) {
				let u = session_user(req), a = req.args, c = cursor();
				if (!u) return { error: 'session not bound' };
				let cfg = u == 'root' ? [ 'shareos', 'ui' ] : [ 'accounts', u ];
				if (u != 'root' && c.get('accounts', u) != 'user') return { error: 'session not bound' };
				if ('apps' in a) {
					if (type(a.apps) != 'array' || length(a.apps) > 64) return { error: 'invalid apps' };
					let ids = [];
					for (let id in a.apps) {
						if (type(id) != 'string' || !match(id, /^[a-z][a-z0-9-]{1,31}$/)) return { error: 'invalid app id' };
						if (index(ids, id) < 0) push(ids, id);
					}
					if (length(ids)) c.set(cfg[0], cfg[1], 'fav', ids); else c.delete(cfg[0], cfg[1], 'fav');
				}
				for (let k in [ 'bar', 'text' ]) {
					if (!(k in a)) continue;
					if (type(a[k]) != 'bool') return { error: 'invalid ' + k };
					if (a[k]) c.delete(cfg[0], cfg[1], 'fav_' + k); else c.set(cfg[0], cfg[1], 'fav_' + k, '0');
				}
				c.commit(cfg[0]);
				return fav_of(cursor(), u);
			}
		},

		// desktop view (module "desktop"): layout of the account – window
		// places, open windows, wallpaper; a small JSON object per account
		desk_get: {
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!module_on('desktop')) return { error: 'not installed' };
				let d = null;
				try { d = json(readfile(DESK_DIR + '/' + u + '.json') ?? 'null'); } catch (e) { }
				return { desk: type(d) == 'object' ? d : {} };
			}
		},

		desk_set: {
			args: { desk: {} },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!module_on('desktop')) return { error: 'not installed' };
				if (type(req.args.desk) != 'object') return { error: 'invalid desk' };
				let s = sprintf('%J', req.args.desk);
				if (length(s) > DESK_MAX) return { error: 'too large' };
				system('mkdir -p ' + DESK_DIR + ' && chmod 700 ' + DESK_DIR);
				let f = DESK_DIR + '/' + u + '.json';
				if (!writefile(f + '.new', s) || !rename(f + '.new', f)) return { error: 'cannot save' };
				return { ok: true };
			}
		},

		passwd: {
			args: { old: '', password: '' },
			call: function(req) {
				let u = session_user(req);
				if (!u) return { error: 'session not bound' };
				if (!password_ok(u, req.args.old)) return { error: 'the current password is wrong' };
				return tool_result(sh_pass(sprintf('%s passwd %s', USERS, shq(u)), req.args.password));
			}
		}
	}
});
