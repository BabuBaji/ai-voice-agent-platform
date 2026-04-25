import { Router, Request, Response, NextFunction } from 'express';

/**
 * Public read-only docs API. Powers /docs on the admin dashboard.
 *
 * No auth on purpose — documentation is public content. Writes will go
 * through a future admin CMS; for now content is seeded from
 * `db/seedDocs.ts` on service boot.
 */

export function docRouter(): Router {
  const router = Router();

  /**
   * GET /docs/nav
   *
   * Returns the full sidebar structure:
   *   [{ slug, title, items: [{ slug, title, link_to, is_new, icon }] }]
   */
  router.get('/nav', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const secs = await pool.query(
        `SELECT id, slug, title, sort_order
           FROM doc_sections
          ORDER BY sort_order ASC, id ASC`,
      );
      const arts = await pool.query(
        `SELECT section_id, slug, title, link_to, is_new, icon, sort_order
           FROM doc_articles
          ORDER BY sort_order ASC, id ASC`,
      );
      const bySection = new Map<number, any[]>();
      for (const a of arts.rows) {
        const list = bySection.get(a.section_id) || [];
        list.push({
          slug: a.slug,
          title: a.title,
          link_to: a.link_to,
          is_new: a.is_new,
          icon: a.icon,
        });
        bySection.set(a.section_id, list);
      }
      const data = secs.rows.map((s: any) => ({
        slug: s.slug,
        title: s.title,
        items: bySection.get(s.id) || [],
      }));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /docs/featured
   *
   * Returns the card grid shown on /docs home. Each item carries enough
   * metadata for the frontend to render the card: icon name, color key,
   * title, excerpt, optional link_to shortcut, new badge.
   */
  router.get('/featured', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const r = await pool.query(
        `SELECT slug, title, excerpt, icon, color, link_to, is_new, sort_order
           FROM doc_articles
          WHERE is_featured = true
          ORDER BY sort_order ASC, id ASC`,
      );
      res.json({ data: r.rows });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /docs/articles/:slug
   *
   * Full article body plus its section for breadcrumb rendering.
   */
  router.get('/articles/:slug', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const r = await pool.query(
        `SELECT a.slug, a.title, a.excerpt, a.body_md, a.icon, a.color,
                a.link_to, a.is_new, a.updated_at,
                s.slug AS section_slug, s.title AS section_title
           FROM doc_articles a
           LEFT JOIN doc_sections s ON s.id = a.section_id
          WHERE a.slug = $1
          LIMIT 1`,
        [req.params.slug],
      );
      if (r.rows.length === 0) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }
      res.json({ data: r.rows[0] });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /docs/search?q=...
   *
   * Full-text search over title + excerpt + body. Ranked by ts_rank.
   * Falls back to ILIKE if the query is too short for a tsquery.
   */
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pool = (req as any).pool;
      const q = String(req.query.q || '').trim();
      if (q.length < 2) {
        res.json({ data: [] });
        return;
      }
      const tsq = q.split(/\s+/).filter(Boolean).map((w) => w + ':*').join(' & ');
      const r = await pool.query(
        `SELECT slug, title, excerpt, icon, color,
                ts_rank(
                  to_tsvector('english', title || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body_md,'')),
                  to_tsquery('english', $1)
                ) AS rank
           FROM doc_articles
          WHERE to_tsvector('english', title || ' ' || coalesce(excerpt,'') || ' ' || coalesce(body_md,''))
                @@ to_tsquery('english', $1)
             OR title ILIKE $2
          ORDER BY rank DESC NULLS LAST, title ASC
          LIMIT 20`,
        [tsq, `%${q}%`],
      );
      res.json({ data: r.rows });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
