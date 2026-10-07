for (const u of ['https://api.mod.io/v1/games?_limit=5', 'https://mod.io/g']) {
	try {
		const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/html' } });
		const t = await r.text();
		console.log(u, r.status, t.slice(0, 400).replace(/\s+/g, ' '));
	} catch (e) { console.log(u, 'ERR', e.message); }
}
