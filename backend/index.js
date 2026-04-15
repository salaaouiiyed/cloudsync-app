const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const winston = require('winston');
const client = require('prom-client');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
require('dotenv').config();

// ─── LOGGING ──────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

// ─── METRICS ──────────────────────────────────────────────────────────────────
client.collectDefaultMetrics({ timeout: 5000 });
const httpDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.1, 5, 15, 50, 100, 500],
});

const app = express();
app.use(express.json());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── METRICS MIDDLEWARE ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    httpDuration.labels(req.method, req.route?.path || req.path, res.statusCode).observe(Date.now() - start);
  });
  next();
});

// ─── JWT / KEYCLOAK ───────────────────────────────────────────────────────────
const KEYCLOAK_URL        = process.env.KEYCLOAK_URL        || 'http://keycloak:8080';
const KEYCLOAK_PUBLIC_URL = process.env.KEYCLOAK_PUBLIC_URL || 'http://localhost:8080';
const KEYCLOAK_REALM      = process.env.KEYCLOAK_REALM      || 'cloudsync-realm';
const JWKS_URI            = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`;

const jwks = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  cacheMaxAge: 600_000,
  rateLimit: true,
});

function getSigningKey(header, callback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

// ─── MIDDLEWARE: authenticate ──────────────────────────────────────────────────
const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Bearer token' });
  }
  const token = auth.slice(7);
  jwt.verify(token, getSigningKey, {
    algorithms: ['RS256'],
    issuer: `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`,
  }, (err, decoded) => {
    if (err) {
      logger.warn('Token verification failed', { error: err.message });
      return res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
};

// ─── MIDDLEWARE: requireRole ───────────────────────────────────────────────────
const requireRole = (role) => (req, res, next) => {
  const roles = req.user?.realm_access?.roles || [];
  if (!roles.includes(role)) {
    return res.status(403).json({ error: `Forbidden: requires role '${role}'` });
  }
  next();
};

// ─── MIDDLEWARE: resolveTenantId ───────────────────────────────────────────────
//
// BUG FIX: The original code used `azp` (client_id = "cloudsync-app") as tenantId.
// This means ALL users share the SAME tenantId → zero isolation.
//
// Correct resolution order:
//   1. `tenant_id` custom claim (set per-user in Keycloak attributes)  ← most explicit
//   2. `sub` (unique user UUID from Keycloak)                          ← always unique fallback
//
// super_admin can override tenantId via ?tenantId= query param to inspect any tenant.
//
function resolveTenantId(user) {
  // Custom claim injected by Keycloak protocol mapper
  if (user.tenant_id) return user.tenant_id;
  // Fallback: sub is always unique per user
  if (user.sub) return user.sub;
  return null;
}

// Standard tenant middleware (uses caller's own tenant)
const tenantMiddleware = (req, res, next) => {
  const tenantId = resolveTenantId(req.user);
  if (!tenantId) {
    return res.status(400).json({ error: 'Bad Request: could not determine tenant from token' });
  }
  req.tenantId = tenantId;
  req.isSuperAdmin = (req.user?.realm_access?.roles || []).includes('super_admin');
  next();
};

// Flexible middleware: super_admin can pass ?tenantId= to query any tenant
const flexibleTenantMiddleware = (req, res, next) => {
  const roles = req.user?.realm_access?.roles || [];
  const isSuperAdmin = roles.includes('super_admin');

  if (isSuperAdmin && req.query.tenantId) {
    req.tenantId = req.query.tenantId;
  } else {
    const tenantId = resolveTenantId(req.user);
    if (!tenantId) {
      return res.status(400).json({ error: 'Bad Request: could not determine tenant from token' });
    }
    req.tenantId = tenantId;
  }
  req.isSuperAdmin = isSuperAdmin;
  next();
};

// ─── MONGODB ──────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cloudsync';

// BUG FIX: retry connection — mongo container may not be fully ready despite healthcheck
async function connectWithRetry(retries = 10, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await mongoose.connect(MONGODB_URI);
      logger.info('Connected to MongoDB');
      return;
    } catch (err) {
      logger.warn(`MongoDB connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}
connectWithRetry().catch(err => {
  logger.error('Could not connect to MongoDB', { error: err.message });
  process.exit(1);
});

// ─── SCHEMAS ──────────────────────────────────────────────────────────────────
const TenantSchema = new mongoose.Schema({
  tenantId:     { type: String, required: true, unique: true, index: true },
  name:         { type: String, required: true },
  plan:         { type: String, enum: ['Starter', 'Business', 'Enterprise'], default: 'Starter' },
  status:       { type: String, enum: ['Active', 'Suspended', 'Trial'], default: 'Trial' },
  industry:     { type: String, default: 'Technology' },
  maxProjects:  { type: Number, default: 10 },
  maxUsers:     { type: Number, default: 5 },
  logo:         { type: String, default: '' },
  primaryColor: { type: String, default: '#3b82f6' },
  contactEmail: { type: String, default: '' },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
});

const ProjectSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: String,
  status:      { type: String, enum: ['Active', 'On Hold', 'Completed'], default: 'Active' },
  priority:    { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  tenantId:    { type: String, required: true, index: true },
  assignee:    { type: String, default: '' },
  dueDate:     { type: Date },
  tags:        [{ type: String }],
  progress:    { type: Number, default: 0, min: 0, max: 100 },
  createdAt:   { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});

const MemberSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  email:    { type: String, required: true },
  role:     { type: String, enum: ['admin', 'member', 'viewer'], default: 'member' },
  status:   { type: String, enum: ['Active', 'Invited', 'Suspended'], default: 'Active' },
  joinedAt: { type: Date, default: Date.now },
});

const AuditLogSchema = new mongoose.Schema({
  tenantId:  { type: String, required: true, index: true },
  action:    { type: String, required: true },
  entity:    { type: String },
  entityId:  { type: String },
  actor:     { type: String },
  details:   { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
});

const Tenant   = mongoose.model('Tenant', TenantSchema);
const Project  = mongoose.model('Project', ProjectSchema);
const Member   = mongoose.model('Member', MemberSchema);
const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

// ─── TENANT CACHE ─────────────────────────────────────────────────────────────
// Simple in-process TTL cache to reduce redundant DB calls for ensureTenant.
// Entries expire after 5 minutes; invalidated on update/delete.
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
const tenantCache = new Map(); // tenantId → { tenant, expiresAt }

function cacheTenant(tenant) {
  tenantCache.set(tenant.tenantId, { tenant, expiresAt: Date.now() + TENANT_CACHE_TTL_MS });
}
function getCachedTenant(tenantId) {
  const entry = tenantCache.get(tenantId);
  if (!entry || Date.now() > entry.expiresAt) { tenantCache.delete(tenantId); return null; }
  return entry.tenant;
}
function invalidateTenantCache(tenantId) { tenantCache.delete(tenantId); }

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Validate tenant ID format: lowercase alphanumeric + hyphens, 3–64 chars.
const TENANT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
function validateTenantId(tenantId) {
  if (!tenantId || typeof tenantId !== 'string') return 'tenantId is required';
  if (!TENANT_ID_RE.test(tenantId)) return 'tenantId must be 3–64 lowercase alphanumeric characters or hyphens, and must not start/end with a hyphen';
  return null;
}

async function ensureTenant(tenantId, displayName) {
  // 1. Check cache first
  const cached = getCachedTenant(tenantId);
  if (cached) return cached;

  // 2. DB lookup
  let tenant = await Tenant.findOne({ tenantId });
  if (!tenant) {
    // Auto-creation: only allowed for sub-derived IDs (UUIDs) or valid tenant_id claims.
    // Build a human-readable name from the ID if no display name is provided.
    const name = displayName
      || (tenantId.charAt(0).toUpperCase() + tenantId.slice(1).replace(/-/g, ' ') + ' Workspace');
    try {
      tenant = await Tenant.create({ tenantId, name, status: 'Trial', plan: 'Starter' });
      logger.info('Auto-created tenant', { tenantId, name });
    } catch (e) {
      // Race condition: another request may have created it concurrently
      if (e.code === 11000) {
        tenant = await Tenant.findOne({ tenantId });
        if (!tenant) throw e; // genuine error
      } else {
        throw e;
      }
    }
  }

  cacheTenant(tenant);
  return tenant;
}

async function audit(tenantId, action, entity, entityId, actor, details = {}) {
  try {
    await AuditLog.create({ tenantId, action, entity, entityId, actor, details });
  } catch (e) {
    logger.warn('Audit log failed', { error: e.message });
  }
}

// ─── HEALTH & METRICS ─────────────────────────────────────────────────────────
app.get('/healthz', (_, res) => res.json({ status: 'ok' }));
app.get('/metrics', async (_, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// =============================================================================
// SUPER ADMIN — platform-wide tenant management
// =============================================================================

app.get('/api/admin/tenants', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const tenants = await Tenant.find().sort({ createdAt: -1 });
    const enriched = await Promise.all(tenants.map(async (t) => {
      const [projectCount, memberCount] = await Promise.all([
        Project.countDocuments({ tenantId: t.tenantId }),
        Member.countDocuments({ tenantId: t.tenantId }),
      ]);
      return { ...t.toObject(), projectCount, memberCount };
    }));
    res.json(enriched);
  } catch (err) {
    logger.error('GET /api/admin/tenants', { error: err.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/admin/tenants', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { tenantId, name } = req.body;
    // Validate tenantId format
    const idError = validateTenantId(tenantId);
    if (idError) return res.status(400).json({ error: idError });
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'name must be at least 2 characters' });
    }
    // Check for duplicate before attempting insert (gives a clear error message)
    const existing = await Tenant.findOne({ tenantId });
    if (existing) return res.status(409).json({ error: `Tenant '${tenantId}' already exists` });
    const tenant = await Tenant.create({ ...req.body, name: name.trim() });
    cacheTenant(tenant);
    await audit(tenant.tenantId, 'TENANT_CREATED', 'Tenant', tenant.tenantId, req.user?.preferred_username, req.body);
    res.status(201).json(tenant);
  } catch (err) {
    logger.error('POST /api/admin/tenants', { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/admin/tenants/:tenantId', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const tenant = await Tenant.findOneAndUpdate(
      { tenantId: req.params.tenantId },
      { ...req.body, updatedAt: new Date() },
      { new: true },
    );
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    invalidateTenantCache(req.params.tenantId);
    cacheTenant(tenant);
    await audit(req.params.tenantId, 'TENANT_UPDATED', 'Tenant', req.params.tenantId, req.user?.preferred_username, req.body);
    res.json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/tenants/:tenantId', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { tenantId } = req.params;
    // Safeguard: require the caller to confirm by echoing the tenantId in the body
    if (req.body?.confirm !== tenantId) {
      return res.status(400).json({
        error: 'Deletion requires confirmation. Send { "confirm": "<tenantId>" } in the request body.',
      });
    }
    const tenant = await Tenant.findOneAndDelete({ tenantId });
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    const [projectResult, memberResult, auditResult] = await Promise.all([
      Project.deleteMany({ tenantId }),
      Member.deleteMany({ tenantId }),
      AuditLog.deleteMany({ tenantId }),
    ]);
    invalidateTenantCache(tenantId);
    logger.info('Tenant deleted', {
      tenantId,
      deletedBy: req.user?.preferred_username,
      projectsDeleted: projectResult.deletedCount,
      membersDeleted: memberResult.deletedCount,
      auditLogsDeleted: auditResult.deletedCount,
    });
    res.json({
      message: 'Tenant and all associated data permanently deleted',
      deleted: {
        projects: projectResult.deletedCount,
        members: memberResult.deletedCount,
        auditLogs: auditResult.deletedCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/analytics', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const [tenantCount, projectCount, memberCount, planDistribution, topTenants, recentActivity] = await Promise.all([
      Tenant.countDocuments(),
      Project.countDocuments(),
      Member.countDocuments(),
      Tenant.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]),
      Project.aggregate([
        { $group: { _id: '$tenantId', projectCount: { $sum: 1 } } },
        { $sort: { projectCount: -1 } },
        { $limit: 5 },
      ]),
      AuditLog.find().sort({ timestamp: -1 }).limit(10),
    ]);
    res.json({
      totals: { tenants: tenantCount, projects: projectCount, members: memberCount },
      planDistribution,
      topTenants,
      recentActivity,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// =============================================================================
// TENANT PROFILE
// =============================================================================

app.get('/api/tenant/profile', authenticate, flexibleTenantMiddleware, async (req, res) => {
  try {
    const displayName = req.user?.preferred_username;
    const tenant = await ensureTenant(req.tenantId, displayName);
    const [projectCount, memberCount, activeProjects, completedProjects] = await Promise.all([
      Project.countDocuments({ tenantId: req.tenantId }),
      Member.countDocuments({ tenantId: req.tenantId }),
      Project.countDocuments({ tenantId: req.tenantId, status: 'Active' }),
      Project.countDocuments({ tenantId: req.tenantId, status: 'Completed' }),
    ]);
    res.json({ ...tenant.toObject(), projectCount, memberCount, activeProjects, completedProjects });
  } catch (err) {
    logger.error('GET /api/tenant/profile', { error: err.message });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.patch('/api/tenant/profile', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const allowed = ['name', 'industry', 'contactEmail', 'logo', 'primaryColor'];
    const update = { updatedAt: new Date() };
    allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
    const tenant = await Tenant.findOneAndUpdate(
      { tenantId: req.tenantId },
      update,
      { new: true, upsert: true },
    );
    invalidateTenantCache(req.tenantId);
    cacheTenant(tenant);
    await audit(req.tenantId, 'PROFILE_UPDATED', 'Tenant', req.tenantId, req.user?.preferred_username, update);
    res.json(tenant);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// =============================================================================
// MEMBERS
// =============================================================================

app.get('/api/members', authenticate, flexibleTenantMiddleware, async (req, res) => {
  try {
    const members = await Member.find({ tenantId: req.tenantId }).sort({ joinedAt: -1 });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/members', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const { username, email, role } = req.body;
    if (!username || !email) return res.status(400).json({ error: 'username and email required' });

    const tenant = await ensureTenant(req.tenantId);
    const memberCount = await Member.countDocuments({ tenantId: req.tenantId });
    if (memberCount >= tenant.maxUsers) {
      return res.status(403).json({ error: `Member limit reached (${tenant.maxUsers}). Upgrade your plan.` });
    }

    const existing = await Member.findOne({ tenantId: req.tenantId, email });
    if (existing) return res.status(409).json({ error: 'Member with this email already exists' });

    const member = await Member.create({
      tenantId: req.tenantId, username, email,
      role: role || 'member', status: 'Invited',
    });
    await audit(req.tenantId, 'MEMBER_INVITED', 'Member', member._id.toString(), req.user?.preferred_username, { email, role });
    res.status(201).json(member);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/members/:id', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const update = {};
    if (req.body.role)   update.role   = req.body.role;
    if (req.body.status) update.status = req.body.status;
    const member = await Member.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      update,
      { new: true },
    );
    if (!member) return res.status(404).json({ error: 'Member not found' });
    await audit(req.tenantId, 'MEMBER_UPDATED', 'Member', req.params.id, req.user?.preferred_username, req.body);
    res.json(member);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/members/:id', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const member = await Member.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    await audit(req.tenantId, 'MEMBER_REMOVED', 'Member', req.params.id, req.user?.preferred_username, {});
    res.json({ message: 'Member removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// PROJECTS
// =============================================================================

app.get('/api/projects', authenticate, flexibleTenantMiddleware, async (req, res) => {
  try {
    const projects = await Project.find({ tenantId: req.tenantId }).sort({ createdAt: -1 });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/api/projects', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const tenant = await ensureTenant(req.tenantId);
    const count = await Project.countDocuments({ tenantId: req.tenantId });
    if (count >= tenant.maxProjects) {
      return res.status(403).json({ error: `Project limit reached (${tenant.maxProjects}). Upgrade your plan.` });
    }
    const project = await Project.create({ ...req.body, tenantId: req.tenantId });
    await audit(req.tenantId, 'PROJECT_CREATED', 'Project', project._id.toString(), req.user?.preferred_username, req.body);
    res.status(201).json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/projects/:id', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { ...req.body, updatedAt: new Date() },
      { new: true },
    );
    if (!project) return res.status(404).json({ error: 'Project not found' });
    await audit(req.tenantId, 'PROJECT_UPDATED', 'Project', req.params.id, req.user?.preferred_username, req.body);
    res.json(project);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', authenticate, requireRole('admin'), tenantMiddleware, async (req, res) => {
  try {
    const result = await Project.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!result) return res.status(404).json({ error: 'Project not found' });
    await audit(req.tenantId, 'PROJECT_DELETED', 'Project', req.params.id, req.user?.preferred_username, {});
    res.json({ message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// AUDIT LOG
// =============================================================================

app.get('/api/audit-logs', authenticate, flexibleTenantMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const logs = await AuditLog.find({ tenantId: req.tenantId })
      .sort({ timestamp: -1 })
      .limit(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`CloudSync Pro Backend running on :${PORT}`);
  logger.info(`JWKS: ${JWKS_URI}`);
  logger.info(`Tenant resolution: tenant_id claim → sub fallback`);
});
