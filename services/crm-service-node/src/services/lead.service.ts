import { pool } from '../db/init';

export interface PaginationParams {
  page: number;
  limit: number;
  sort: string;
  order: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const ALLOWED_LEAD_SORT_COLS = ['created_at', 'updated_at', 'first_name', 'last_name', 'email', 'score', 'status'];
const ALLOWED_DEAL_SORT_COLS = ['created_at', 'updated_at', 'title', 'value', 'status'];
const ALLOWED_CONTACT_SORT_COLS = ['created_at', 'updated_at', 'first_name', 'last_name', 'email'];

function sanitizeSort(sort: string, allowed: string[]): string {
  return allowed.includes(sort) ? sort : 'created_at';
}

function sanitizeOrder(order: string): 'ASC' | 'DESC' {
  return order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
}

export async function getLeadsPaginated(
  tenantId: string,
  params: PaginationParams,
  filters: { status?: string; source?: string; search?: string }
): Promise<PaginatedResult<any>> {
  const { page, limit } = params;
  const sort = sanitizeSort(params.sort, ALLOWED_LEAD_SORT_COLS);
  const order = sanitizeOrder(params.order);
  const offset = (page - 1) * limit;

  const conditions: string[] = ['tenant_id = $1'];
  const values: any[] = [tenantId];
  let paramIdx = 2;

  if (filters.status) {
    conditions.push(`status = $${paramIdx++}`);
    values.push(filters.status);
  }
  if (filters.source) {
    conditions.push(`source = $${paramIdx++}`);
    values.push(filters.source);
  }
  if (filters.search) {
    conditions.push(
      `(first_name ILIKE $${paramIdx} OR last_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR company ILIKE $${paramIdx})`
    );
    values.push(`%${filters.search}%`);
    paramIdx++;
  }

  const where = conditions.join(' AND ');
  const countRes = await pool.query(`SELECT COUNT(*) FROM leads WHERE ${where}`, values);
  const total = parseInt(countRes.rows[0].count, 10);

  values.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT * FROM leads WHERE ${where} ORDER BY ${sort} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    values
  );

  return {
    data: dataRes.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getContactsPaginated(
  tenantId: string,
  params: PaginationParams,
  filters: { search?: string }
): Promise<PaginatedResult<any>> {
  const { page, limit } = params;
  const sort = sanitizeSort(params.sort, ALLOWED_CONTACT_SORT_COLS);
  const order = sanitizeOrder(params.order);
  const offset = (page - 1) * limit;

  const conditions: string[] = ['tenant_id = $1'];
  const values: any[] = [tenantId];
  let paramIdx = 2;

  if (filters.search) {
    conditions.push(
      `(first_name ILIKE $${paramIdx} OR last_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR company ILIKE $${paramIdx})`
    );
    values.push(`%${filters.search}%`);
    paramIdx++;
  }

  const where = conditions.join(' AND ');
  const countRes = await pool.query(`SELECT COUNT(*) FROM contacts WHERE ${where}`, values);
  const total = parseInt(countRes.rows[0].count, 10);

  values.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT * FROM contacts WHERE ${where} ORDER BY ${sort} ${order} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    values
  );

  return {
    data: dataRes.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDealsPaginated(
  tenantId: string,
  params: PaginationParams,
  filters: { status?: string; pipelineId?: string; stageId?: string; assignedTo?: string }
): Promise<PaginatedResult<any>> {
  const { page, limit } = params;
  const sort = sanitizeSort(params.sort, ALLOWED_DEAL_SORT_COLS);
  const order = sanitizeOrder(params.order);
  const offset = (page - 1) * limit;

  const conditions: string[] = ['d.tenant_id = $1'];
  const values: any[] = [tenantId];
  let paramIdx = 2;

  if (filters.status) {
    conditions.push(`d.status = $${paramIdx++}`);
    values.push(filters.status);
  }
  if (filters.pipelineId) {
    conditions.push(`d.pipeline_id = $${paramIdx++}`);
    values.push(filters.pipelineId);
  }
  if (filters.stageId) {
    conditions.push(`d.stage_id = $${paramIdx++}`);
    values.push(filters.stageId);
  }
  if (filters.assignedTo) {
    conditions.push(`d.assigned_to = $${paramIdx++}`);
    values.push(filters.assignedTo);
  }

  const where = conditions.join(' AND ');
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM deals d WHERE ${where}`,
    values
  );
  const total = parseInt(countRes.rows[0].count, 10);

  values.push(limit, offset);
  const dataRes = await pool.query(
    `SELECT d.*, ps.name as stage_name, p.name as pipeline_name
     FROM deals d
     LEFT JOIN pipeline_stages ps ON ps.id = d.stage_id
     LEFT JOIN pipelines p ON p.id = d.pipeline_id
     WHERE ${where}
     ORDER BY d.${sort} ${order}
     LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    values
  );

  return {
    data: dataRes.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
