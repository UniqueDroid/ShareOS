/* ========== methods (joined after the helpers of all parts, see build-parts.sh) ========== */

add_methods({
	'shareos.notify': {
		list: {
			call: function() { return notify_json([ 'list' ]); }
		},
		// id or "all"
		read: {
			args: { id: '' },
			call: function(req) {
				let id = req.args.id || 'all';
				if (id != 'all' && !match(id, /^[0-9a-f]{1,32}$/)) return { error: 'invalid id' };
				return notify_json([ 'read', id ]);
			}
		},
		delete: {
			args: { id: '' },
			call: function(req) {
				let id = req.args.id || 'all';
				if (id != 'all' && !match(id, /^[0-9a-f]{1,32}$/)) return { error: 'invalid id' };
				return notify_json([ 'delete', id ]);
			}
		},
		get: {
			call: function() { return notify_settings(); }
		},
		// smtp_pass / push_token: null = keep, '' = remove
		set: {
			args: { email: false, smtp_host: '', smtp_tls: '', smtp_port: '', smtp_user: '', smtp_pass: '', mail_from: '', mail_to: '', email_level: '',
				push: false, push_type: '', push_url: '', push_token: '', push_chat: '', push_level: '', temp_max: 55, disk_full: 90 },
			call: function(req) {
				let a = req.args, c = cursor();
				let mail = (x) => x == null || x == '' || match(x, /^[^@[:space:],;]+@[^@[:space:],;]+$/);
				if (a.smtp_host != null && a.smtp_host != '' && !match(a.smtp_host, /^[A-Za-z0-9.-]{1,253}$/)) return { error: 'invalid mail server' };
				if (a.smtp_tls != null && a.smtp_tls != '' && !(a.smtp_tls in { starttls: 1, ssl: 1, none: 1 })) return { error: 'invalid encryption' };
				if (a.smtp_port != null && a.smtp_port != '' && !(match('' + a.smtp_port, /^[0-9]+$/) && +a.smtp_port >= 1 && +a.smtp_port <= 65535)) return { error: 'invalid port' };
				if (!mail(a.mail_from)) return { error: 'invalid sender address' };
				for (let r in split(a.mail_to ?? '', /[ ,;]+/)) if (length(r) && !mail(r)) return { error: 'invalid recipient: ' + r };
				for (let k in [ 'email_level', 'push_level' ]) if (a[k] != null && a[k] != '' && !(a[k] in { info: 1, warn: 1, error: 1 })) return { error: 'invalid level' };
				if (a.push_type != null && a.push_type != '' && !(a.push_type in { ntfy: 1, gotify: 1, telegram: 1, webhook: 1 })) return { error: 'invalid push service' };
				if (a.push_chat != null && a.push_chat != '' && !match('' + a.push_chat, /^-?[0-9]{1,20}$|^@[A-Za-z0-9_]{5,32}$/)) return { error: 'invalid chat ID' };
				if (a.push_url != null && a.push_url != '' && !match(a.push_url, /^https?:\/\/[^[:space:]'"]{3,250}$/)) return { error: 'invalid push address' };
				if (a.temp_max != null && !(+a.temp_max >= 40 && +a.temp_max <= 70)) return { error: 'temperature limit: 40 … 70 °C' };
				if (a.disk_full != null && !(+a.disk_full >= 50 && +a.disk_full <= 99)) return { error: 'full limit: 50 … 99 %' };
				for (let k in [ 'smtp_user', 'smtp_pass', 'push_token' ]) if (a[k] != null && match(a[k], /[\n\r]/)) return { error: 'invalid characters' };
				if (c.get('shareos', 'notify') != 'notify') c.set('shareos', 'notify', 'notify');
				for (let k in [ 'smtp_host', 'smtp_tls', 'smtp_port', 'smtp_user', 'mail_from', 'mail_to', 'email_level', 'push_type', 'push_url', 'push_chat', 'push_level' ])
					if (a[k] != null) c.set('shareos', 'notify', k, '' + a[k]);
				for (let k in [ 'smtp_pass', 'push_token' ]) if (a[k] != null) c.set('shareos', 'notify', k, a[k]);
				if (a.email != null) c.set('shareos', 'notify', 'email', a.email ? '1' : '0');
				if (a.push != null) c.set('shareos', 'notify', 'push', a.push ? '1' : '0');
				if (a.temp_max != null) c.set('shareos', 'notify', 'temp_max', '' + int(a.temp_max));
				if (a.disk_full != null) c.set('shareos', 'notify', 'disk_full', '' + int(a.disk_full));
				c.commit('shareos');
				return notify_settings();
			}
		},
		test: {
			call: function() { return notify_json([ 'test' ]); }
		},
		telegram_chats: {
			call: function() { return notify_json([ 'telegram-chats' ]); }
		}
	},

	// chips in the header of the interface: services and apps of the account
	'shareos.status': {
		chips: {
			call: function(req) {
				let u = session_user(req);
				return u ? { chips: status_chips(u) } : { chips: [] };
			}
		}
	},

	'shareos.widget': {
		get: {
			call: function() {
				let c = cursor();
				return { enabled: c.get('shareos', 'widget', 'enabled') == '1', token: c.get('shareos', 'widget', 'token') ?? '' };
			}
		},

		set: {
			// enabled: on/off; renew: new token (the old address stops working)
			args: { enabled: false, renew: false },
			call: function(req) {
				let c = cursor();
				c.set('shareos', 'widget', 'widget');
				if (req.args.enabled != null) c.set('shareos', 'widget', 'enabled', req.args.enabled ? '1' : '0');
				if (req.args.renew || !c.get('shareos', 'widget', 'token')) c.set('shareos', 'widget', 'token', new_token());
				c.commit('shareos');
				return { enabled: c.get('shareos', 'widget', 'enabled') == '1', token: c.get('shareos', 'widget', 'token') };
			}
		},

		status: {
			// called by /www/cgi-bin/status with the token from the address;
			// no web login has it in its ACL
			args: { token: '' },
			call: function(req) {
				let c = cursor();
				if (c.get('shareos', 'widget', 'enabled') != '1') return { error: 'disabled' };
				if (!same_token(req.args.token, c.get('shareos', 'widget', 'token'))) return { error: 'denied' };
				return widget_status();
			}
		}
	}
});
