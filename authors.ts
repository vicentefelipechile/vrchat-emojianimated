// =========================================================================================================
// AUTHORS ROUTES
// =========================================================================================================
// CRUD for avatar_authors + public author profile + resource linking.
// Includes history snapshot (meta_edit) when linking resources to authors.
// =========================================================================================================

// =========================================================================================================
// Imports
// =========================================================================================================

import { Hono } from 'hono';
import { getAuthUser } from '../auth';
import { AvatarAuthorSchema } from '../validators';
import { AvatarAuthor } from '../types';

// =========================================================================================================
// Helpers
// =========================================================================================================

/** Convert a display name to a URL-friendly slug (lowercase, spaces → hyphens, strip non-alphanum). */
function toSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 80);
}

// =========================================================================================================
// Endpoints
// =========================================================================================================

const authors = new Hono<{ Bindings: Env }>();

// =========================================================================================================
// GET /api/authors
// Paginated list of avatar authors.
// =========================================================================================================

authors.get('/', async (c) => {
	const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
	const limit = Math.min(60, Math.max(1, parseInt(c.req.query('limit') || '24', 10)));
	const offset = (page - 1) * limit;

	try {
		const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM avatar_authors').first<{ total: number }>();
		const total = countResult?.total ?? 0;

		const rows = await c.env.DB.prepare(
			`SELECT aa.*, COUNT(am.resource_uuid) as resource_count
			FROM avatar_authors aa
			LEFT JOIN avatar_meta am ON aa.uuid = am.author_uuid
			GROUP BY aa.uuid
			ORDER BY aa.name ASC
			LIMIT ? OFFSET ?`,
		)
			.bind(limit, offset)
			.all<AvatarAuthor & { resource_count: number }>();

		return c.json({
			authors: rows.results,
			pagination: { page, limit, total, hasNextPage: offset + limit < total, hasPrevPage: page > 1 },
		});
	} catch (e) {
		console.error('Authors list error:', e);
		return c.json({ error: 'Failed to fetch authors' }, 500);
	}
});

// =========================================================================================================
// GET /api/authors/search?q=
// Autocomplete by name — returns max 10 results with uuid, name, slug.
// =========================================================================================================

authors.get('/search', async (c) => {
	const q = c.req.query('q') || '';
	if (!q.trim()) return c.json([]);

	try {
		const rows = await c.env.DB.prepare(`SELECT uuid, name, slug FROM avatar_authors WHERE name LIKE ? LIMIT 10`)
			.bind(`%${q}%`)
			.all<{ uuid: string; name: string; slug: string }>();

		return c.json(rows.results);
	} catch (e) {
		console.error('Authors search error:', e);
		return c.json({ error: 'Search failed' }, 500);
	}
});

// =========================================================================================================
// GET /api/authors/:slug
// Public author profile + paginated list of their avatars.
// =========================================================================================================

authors.get('/:slug', async (c) => {
	const slug = c.req.param('slug');
	const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
	const limit = 24;
	const offset = (page - 1) * limit;

	try {
		const author = await c.env.DB.prepare('SELECT * FROM avatar_authors WHERE slug = ?').bind(slug).first<AvatarAuthor>();

		if (!author) return c.json({ error: 'Author not found' }, 404);

		const countResult = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM avatar_meta WHERE author_uuid = ?`)
			.bind(author.uuid)
			.first<{ total: number }>();
		const total = countResult?.total ?? 0;

		const avatars = await c.env.DB.prepare(
			`SELECT r.uuid, r.title, r.download_count, r.created_at, m.r2_key as thumbnail_key,
				am.gender, am.avatar_type, am.platform, am.is_nsfw
			FROM resources r
			INNER JOIN avatar_meta am ON r.uuid = am.resource_uuid
			LEFT JOIN media m ON r.thumbnail_uuid = m.uuid
			WHERE am.author_uuid = ? AND r.is_active = 1
			ORDER BY r.created_at DESC
			LIMIT ? OFFSET ?`,
		)
			.bind(author.uuid, limit, offset)
			.all<Record<string, unknown>>();

		return c.json({
			author,
			avatars: avatars.results,
			pagination: { page, limit, total, hasNextPage: offset + limit < total, hasPrevPage: page > 1 },
		});
	} catch (e) {
		console.error('Author profile error:', e);
		return c.json({ error: 'Failed to fetch author' }, 500);
	}
});

// =========================================================================================================
// POST /api/authors
// Create a new author record [admin only].
// =========================================================================================================

authors.post('/', async (c) => {
	const user = await getAuthUser(c);
	if (!user) return c.json({ error: 'Unauthorized' }, 401);
	if (!user.is_admin) return c.json({ error: 'Forbidden' }, 403);

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON' }, 400);
	}

	const parsed = AvatarAuthorSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: 'Validation error', details: parsed.error.issues }, 400);

	const d = parsed.data;
	const uuid = crypto.randomUUID();
	const slug = toSlug(d.name);
	const now = Math.floor(Date.now() / 1000);

	try {
		await c.env.DB.prepare(
			`INSERT INTO avatar_authors (uuid, name, slug, description, avatar_url, website_url, twitter_url, booth_url, gumroad_url, patreon_url, discord_url, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				uuid,
				d.name,
				slug,
				d.description ?? null,
				d.avatar_url ?? null,
				d.website_url ?? null,
				d.twitter_url ?? null,
				d.booth_url ?? null,
				d.gumroad_url ?? null,
				d.patreon_url ?? null,
				d.discord_url ?? null,
				now,
				now,
			)
			.run();

		return c.json({ uuid, slug }, 201);
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes('UNIQUE')) {
			return c.json({ error: 'Author name or slug already exists' }, 409);
		}
		console.error('Author create error:', e);
		return c.json({ error: 'Failed to create author' }, 500);
	}
});

// =========================================================================================================
// PUT /api/authors/:slug
// Edit an author record [admin only].
// =========================================================================================================

authors.put('/:slug', async (c) => {
	const user = await getAuthUser(c);
	if (!user) return c.json({ error: 'Unauthorized' }, 401);
	if (!user.is_admin) return c.json({ error: 'Forbidden' }, 403);

	const slug = c.req.param('slug');

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON' }, 400);
	}

	const parsed = AvatarAuthorSchema.partial().safeParse(body);
	if (!parsed.success) return c.json({ error: 'Validation error', details: parsed.error.issues }, 400);

	const author = await c.env.DB.prepare('SELECT uuid FROM avatar_authors WHERE slug = ?').bind(slug).first<{ uuid: string }>();
	if (!author) return c.json({ error: 'Author not found' }, 404);

	const d = parsed.data;
	const now = Math.floor(Date.now() / 1000);

	const fields = [
		'name',
		'description',
		'avatar_url',
		'website_url',
		'twitter_url',
		'booth_url',
		'gumroad_url',
		'patreon_url',
		'discord_url',
	] as const;
	const setClauses: string[] = ['updated_at = ?'];
	const setBindings: unknown[] = [now];
	for (const f of fields) {
		if (d[f] !== undefined) {
			setClauses.push(`${f} = ?`);
			setBindings.push(d[f] ?? null);
		}
	}

	try {
		await c.env.DB.prepare(`UPDATE avatar_authors SET ${setClauses.join(', ')} WHERE uuid = ?`)
			.bind(...setBindings, author.uuid)
			.run();

		return c.json({ success: true });
	} catch (e) {
		console.error('Author update error:', e);
		return c.json({ error: 'Failed to update author' }, 500);
	}
});

// =========================================================================================================
// DELETE /api/authors/:slug
// Delete an author — only if no avatars are linked to them [admin only].
// =========================================================================================================

authors.delete('/:slug', async (c) => {
	const user = await getAuthUser(c);
	if (!user) return c.json({ error: 'Unauthorized' }, 401);
	if (!user.is_admin) return c.json({ error: 'Forbidden' }, 403);

	const slug = c.req.param('slug');

	try {
		const author = await c.env.DB.prepare('SELECT uuid FROM avatar_authors WHERE slug = ?').bind(slug).first<{ uuid: string }>();
		if (!author) return c.json({ error: 'Author not found' }, 404);

		const linked = await c.env.DB.prepare('SELECT COUNT(*) as count FROM avatar_meta WHERE author_uuid = ?')
			.bind(author.uuid)
			.first<{ count: number }>();
		if (linked && linked.count > 0) {
			return c.json({ error: 'Cannot delete author with linked avatars. Unlink them first.' }, 409);
		}

		await c.env.DB.prepare('DELETE FROM avatar_authors WHERE uuid = ?').bind(author.uuid).run();

		return c.json({ success: true });
	} catch (e) {
		console.error('Author delete error:', e);
		return c.json({ error: 'Failed to delete author' }, 500);
	}
});

// =========================================================================================================
// POST /api/authors/:slug/link-resource
// Link an avatar resource to this author. Records a meta_edit history snapshot [admin only].
// Body: { resource_uuid: string }
// =========================================================================================================

authors.post('/:slug/link-resource', async (c) => {
	const user = await getAuthUser(c);
	if (!user) return c.json({ error: 'Unauthorized' }, 401);
	if (!user.is_admin) return c.json({ error: 'Forbidden' }, 403);

	const slug = c.req.param('slug');

	let body: { resource_uuid?: unknown };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: 'Invalid JSON' }, 400);
	}

	const resourceUuid = body.resource_uuid;
	if (typeof resourceUuid !== 'string' || !/^[0-9a-f-]{36}$/i.test(resourceUuid)) {
		return c.json({ error: 'Invalid resource_uuid' }, 400);
	}

	try {
		const author = await c.env.DB.prepare('SELECT uuid FROM avatar_authors WHERE slug = ?').bind(slug).first<{ uuid: string }>();
		if (!author) return c.json({ error: 'Author not found' }, 404);

		const existing = await c.env.DB.prepare('SELECT author_uuid, author_name_raw FROM avatar_meta WHERE resource_uuid = ?')
			.bind(resourceUuid)
			.first<{ author_uuid: string | null; author_name_raw: string | null }>();
		if (!existing) return c.json({ error: 'Avatar metadata not found for this resource' }, 404);

		// Snapshot the previous author fields for history tracking
		const historyUuid = crypto.randomUUID();
		const now = Math.floor(Date.now() / 1000);

		const previousData = JSON.stringify({
			meta_type: 'avatar_meta',
			fields: { author_uuid: existing.author_uuid, author_name_raw: existing.author_name_raw },
		});

		const insertHistory = c.env.DB.prepare(
			`INSERT INTO resource_history (uuid, resource_uuid, actor_uuid, change_type, previous_data, created_at)
			VALUES (?, ?, ?, 'meta_edit', ?, ?)`,
		).bind(historyUuid, resourceUuid, user.uuid, previousData, now);

		const updateMeta = c.env.DB.prepare(`UPDATE avatar_meta SET author_uuid = ? WHERE resource_uuid = ?`).bind(author.uuid, resourceUuid);

		await c.env.DB.batch([insertHistory, updateMeta]);

		return c.json({ success: true });
	} catch (e) {
		console.error('Author link-resource error:', e);
		return c.json({ error: 'Failed to link resource' }, 500);
	}
});

// =========================================================================================================
// Export
// =========================================================================================================

export default authors;
