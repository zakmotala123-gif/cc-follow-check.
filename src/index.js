// Cloudflare Worker: follow-check verifier for Card Chronicles follow codes.
//
// It holds a throwaway Roblox bot account cookie (never in the game) and answers
// a single question for the game: "does player X follow developer Y?"
//
// The game calls:  GET https://<your-worker>.workers.dev/follows?user=<playerId>&dev=<devId>
//   with header:   x-secret: <SHARED_SECRET>
// and gets back:   {"follows": true}  or  {"follows": false}
//
// Two secrets are set in the Cloudflare dashboard (Settings > Variables and Secrets),
// NOT in this file:
//   ROBLOX_COOKIE  = the bot account's .ROBLOSECURITY cookie value
//   SHARED_SECRET  = a long random password that the game also stores server-side

export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// Only allow the follows endpoint.
		if (url.pathname !== "/follows") {
			return json({ error: "not_found" }, 404);
		}

		// Reject anything that doesn't present the shared secret.
		const provided = request.headers.get("x-secret");
		if (!env.SHARED_SECRET || provided !== env.SHARED_SECRET) {
			return json({ error: "unauthorized" }, 401);
		}

		const user = parseInt(url.searchParams.get("user"), 10);
		const dev = parseInt(url.searchParams.get("dev"), 10);
		if (!user || !dev) {
			return json({ error: "missing_user_or_dev" }, 400);
		}

		if (!env.ROBLOX_COOKIE) {
			return json({ error: "server_not_configured" }, 500);
		}

		try {
			const follows = await userFollowsDev(user, dev, env.ROBLOX_COOKIE);
			return json({ follows });
		} catch (e) {
			return json({ error: "lookup_failed", detail: String(e) }, 502);
		}
	},
};

function json(obj, status = 200) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { "content-type": "application/json" },
	});
}

// Scans the player's followings list (authenticated) and looks for the dev's id.
// Paginated, capped so a huge following list can't run forever.
async function userFollowsDev(user, dev, cookie) {
	let cursor = "";
	for (let page = 0; page < 25; page++) {
		const u =
			`https://friends.roblox.com/v1/users/${user}/followings` +
			`?limit=100&sortOrder=Asc` +
			(cursor ? `&cursor=${cursor}` : "");

		const res = await fetch(u, {
			headers: {
				"Cookie": `.ROBLOSECURITY=${cookie}`,
				"accept": "application/json",
			},
		});

		if (res.status !== 200) {
			throw new Error(`roblox_status_${res.status}`);
		}

		const data = await res.json();
		if (data && Array.isArray(data.data)) {
			for (const f of data.data) {
				if (f.id === dev) return true;
			}
		}

		if (!data || !data.nextPageCursor) return false;
		cursor = encodeURIComponent(data.nextPageCursor);
	}
	return false;
}
