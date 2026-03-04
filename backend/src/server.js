import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { enqueueEvent, initDb, logAudit, query } from "./db.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { generateVisitorCode } from "./utils/code.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

function signUser(user) {
    return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, process.env.JWT_SECRET, {
        expiresIn: "8h",
    });
}

app.get("/health", async (_req, res) => {
    res.json({ ok: true, service: "site-ops-backend", time: new Date().toISOString() });
});

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const result = await query("SELECT * FROM users WHERE email = $1 AND active = TRUE", [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const token = signUser(user);
    await logAudit(user.id, "AUTH_LOGIN", "user", user.id, { email: user.email });

    res.json({
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
});

app.get("/me", requireAuth, async (req, res) => {
    res.json({ user: req.user });
});

// Guards (Admin full CRUD)
app.get("/guards", requireAuth, requireRole("admin", "supervisor"), async (_req, res) => {
    const result = await query("SELECT * FROM guards ORDER BY id DESC");
    res.json(result.rows);
});

app.post("/guards", requireAuth, requireRole("admin"), async (req, res) => {
    const { guard_code, full_name, phone, site_id, details } = req.body;
    if (!guard_code || !full_name || !site_id) {
        return res.status(400).json({ error: "guard_code, full_name, site_id required" });
    }
    const result = await query(
        `INSERT INTO guards (guard_code, full_name, phone, site_id, details)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [guard_code, full_name, phone || null, site_id, details || {}],
    );

    await logAudit(req.user.id, "GUARD_CREATE", "guard", result.rows[0].id, { guard_code, full_name });
    res.status(201).json(result.rows[0]);
});

app.put("/guards/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const { id } = req.params;
    const { full_name, phone, status, site_id, details, active } = req.body;
    const result = await query(
        `UPDATE guards
     SET full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         status = COALESCE($3, status),
         site_id = COALESCE($4, site_id),
         details = COALESCE($5, details),
         active = COALESCE($6, active),
         updated_at = NOW()
     WHERE id = $7 RETURNING *`,
        [full_name, phone, status, site_id, details, active, id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Guard not found" });

    await logAudit(req.user.id, "GUARD_UPDATE", "guard", id, req.body);
    res.json(result.rows[0]);
});

app.delete("/guards/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const { id } = req.params;
    const result = await query(`UPDATE guards SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`, [id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Guard not found" });
    await logAudit(req.user.id, "GUARD_DEACTIVATE", "guard", id, {});
    res.json({ success: true });
});

// Visitors (Admin CRUD)
app.get("/visitors", requireAuth, requireRole("admin", "supervisor"), async (_req, res) => {
    const result = await query("SELECT * FROM visitors ORDER BY id DESC");
    res.json(result.rows);
});

app.post("/visitors", requireAuth, requireRole("admin"), async (req, res) => {
    const { full_name, id_number, phone, email, company, notes } = req.body;
    if (!full_name) return res.status(400).json({ error: "full_name required" });
    const result = await query(
        `INSERT INTO visitors (full_name, id_number, phone, email, company, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [full_name, id_number || null, phone || null, email || null, company || null, notes || null],
    );
    await logAudit(req.user.id, "VISITOR_CREATE", "visitor", result.rows[0].id, { full_name });
    res.status(201).json(result.rows[0]);
});

app.put("/visitors/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const { id } = req.params;
    const { full_name, id_number, phone, email, company, notes, active } = req.body;
    const result = await query(
        `UPDATE visitors SET
      full_name = COALESCE($1, full_name),
      id_number = COALESCE($2, id_number),
      phone = COALESCE($3, phone),
      email = COALESCE($4, email),
      company = COALESCE($5, company),
      notes = COALESCE($6, notes),
      active = COALESCE($7, active),
      updated_at = NOW()
     WHERE id = $8 RETURNING *`,
        [full_name, id_number, phone, email, company, notes, active, id],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Visitor not found" });
    await logAudit(req.user.id, "VISITOR_UPDATE", "visitor", id, req.body);
    res.json(result.rows[0]);
});

app.delete("/visitors/:id", requireAuth, requireRole("admin"), async (req, res) => {
    const { id } = req.params;
    const result = await query(`UPDATE visitors SET active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING *`, [id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Visitor not found" });
    await logAudit(req.user.id, "VISITOR_DEACTIVATE", "visitor", id, {});
    res.json({ success: true });
});

// Visit requests + approvals
app.post("/visits", requireAuth, requireRole("admin", "supervisor"), async (req, res) => {
    const { visitor_id, host_name, host_contact, site_id, visitor_status, appointment_time } = req.body;
    if (!visitor_id || !site_id || !visitor_status) {
        return res.status(400).json({ error: "visitor_id, site_id, visitor_status required" });
    }

    let approvalStatus = "Pending";
    let hostResponse = "No_Response";
    let denialReason = null;

    if (visitor_status === "Unannounced") {
        approvalStatus = "Denied";
        hostResponse = "Denied";
        denialReason = "Entry requires prior appointment. Please contact your host.";
    }

    const result = await query(
        `INSERT INTO visits (
      visitor_id, host_name, host_contact, site_id, visitor_status, host_response, approval_status, denial_reason, appointment_time
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [visitor_id, host_name || null, host_contact || null, site_id, visitor_status, hostResponse, approvalStatus, denialReason, appointment_time || null],
    );

    await logAudit(req.user.id, "VISIT_CREATE", "visit", result.rows[0].id, { visitor_status, site_id });
    await enqueueEvent("VISIT_CREATED", { visit_id: result.rows[0].id });

    res.status(201).json({
        ...result.rows[0],
        message:
            visitor_status === "Unannounced"
                ? "Entry requires prior appointment. Please contact your host."
                : "Visit request submitted for approval.",
    });
});

app.get("/visits/pending", requireAuth, requireRole("admin", "supervisor"), async (_req, res) => {
    const result = await query(
        `SELECT v.*, vi.full_name AS visitor_name
     FROM visits v
     JOIN visitors vi ON vi.id = v.visitor_id
     WHERE v.approval_status = 'Pending'
     ORDER BY v.created_at ASC`,
    );
    res.json(result.rows);
});

app.post("/visits/:id/approve", requireAuth, requireRole("admin", "supervisor"), async (req, res) => {
    const { id } = req.params;
    const { override_mfa } = req.body;

    const existing = await query("SELECT * FROM visits WHERE id = $1", [id]);
    const visit = existing.rows[0];
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    if (visit.approval_status !== "Pending") return res.status(400).json({ error: "Visit already finalized" });

    if (visit.visitor_status === "Unannounced") {
        if (req.user.role !== "admin") return res.status(403).json({ error: "Only admin can override unannounced denial" });
        if (!override_mfa || override_mfa !== "OVERRIDE-ALLOW") {
            return res.status(400).json({ error: "Supervisor MFA required for exception override" });
        }
    }

    const updated = await query(
        `UPDATE visits
     SET approval_status='Approved', host_response='Approved', approved_by=$1, updated_at=NOW()
     WHERE id=$2 RETURNING *`,
        [req.user.id, id],
    );

    let code = null;
    while (!code) {
        try {
            const candidate = generateVisitorCode();
            await query(`INSERT INTO visitor_codes (visit_id, code, status) VALUES ($1, $2, 'issued')`, [id, candidate]);
            code = candidate;
        } catch {
            code = null;
        }
    }

    await logAudit(req.user.id, "VISIT_APPROVE", "visit", id, { code_issued: true });
    await enqueueEvent("VISIT_APPROVED", { visit_id: id, code });

    res.json({ ...updated.rows[0], code });
});

app.post("/visits/:id/deny", requireAuth, requireRole("admin", "supervisor"), async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const existing = await query("SELECT * FROM visits WHERE id = $1", [id]);
    const visit = existing.rows[0];
    if (!visit) return res.status(404).json({ error: "Visit not found" });
    if (visit.approval_status !== "Pending") return res.status(400).json({ error: "Visit already finalized" });

    const updated = await query(
        `UPDATE visits
     SET approval_status='Denied', host_response='Denied', denied_by=$1, denial_reason=$2, updated_at=NOW()
     WHERE id=$3 RETURNING *`,
        [req.user.id, reason || "Denied by protocol", id],
    );

    await logAudit(req.user.id, "VISIT_DENY", "visit", id, { reason: reason || null });
    await enqueueEvent("VISIT_DENIED", { visit_id: id });
    res.json(updated.rows[0]);
});

// Code lookup + check-in
app.get("/visitor-code/:code", requireAuth, requireRole("admin", "supervisor", "guard"), async (req, res) => {
    const { code } = req.params;
    const result = await query(
        `SELECT vc.code, vc.status AS code_status, vc.issued_at, vc.used_at, vc.used_by_guard,
            v.id AS visit_id, v.site_id, v.approval_status, v.host_name, v.host_contact,
            vi.id AS visitor_id, vi.full_name, vi.id_number, vi.phone, vi.email, vi.company
     FROM visitor_codes vc
     JOIN visits v ON v.id = vc.visit_id
     JOIN visitors vi ON vi.id = v.visitor_id
     WHERE vc.code = $1`,
        [code],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Code not found" });
    res.json(result.rows[0]);
});

app.post("/visitor-code/:code/checkin", requireAuth, requireRole("guard", "admin", "supervisor"), async (req, res) => {
    const { code } = req.params;
    const { guard_id } = req.body;
    if (!guard_id) return res.status(400).json({ error: "guard_id required" });

    const result = await query(
        `UPDATE visitor_codes
     SET status='used', used_at=NOW(), used_by_guard=$1
     WHERE code=$2 AND status='issued'
     RETURNING *`,
        [guard_id, code],
    );

    if (!result.rows[0]) return res.status(400).json({ error: "Code invalid, already used, or expired" });
    await logAudit(req.user.id, "VISITOR_CHECKIN", "visitor_code", code, { guard_id });
    await enqueueEvent("VISITOR_CHECKIN", { code, guard_id });

    res.json({ success: true, code: result.rows[0].code, used_at: result.rows[0].used_at });
});

// Guard duty events
app.post("/guard/clock-in", requireAuth, requireRole("guard", "admin", "supervisor"), async (req, res) => {
    const { guard_id, site_id, gps_coordinates } = req.body;
    if (!guard_id || !site_id || !gps_coordinates) {
        return res.status(400).json({ error: "guard_id, site_id, gps_coordinates required" });
    }

    await query(
        `INSERT INTO guard_events (guard_id, event_type, site_id, gps_coordinates, metadata)
     VALUES ($1, 'clock_in', $2, $3, $4)`,
        [guard_id, site_id, gps_coordinates, { supervisor_notified: true }],
    );
    await logAudit(req.user.id, "GUARD_CLOCK_IN", "guard_event", guard_id, { site_id, gps_coordinates });
    await enqueueEvent("GUARD_SHIFT_START", { guard_id, site_id, gps_coordinates });
    res.status(201).json({ success: true, supervisor_notified: true });
});

app.post("/guard/clock-out", requireAuth, requireRole("guard", "admin", "supervisor"), async (req, res) => {
    const { guard_id, site_id, gps_coordinates, replacement_guard_id } = req.body;
    if (!guard_id || !site_id || !gps_coordinates) {
        return res.status(400).json({ error: "guard_id, site_id, gps_coordinates required" });
    }

    let replacementClockedIn = false;
    if (replacement_guard_id) {
        const replacement = await query(
            `SELECT 1 FROM guard_events WHERE guard_id = $1 AND site_id = $2 AND event_type = 'clock_in' ORDER BY created_at DESC LIMIT 1`,
            [replacement_guard_id, site_id],
        );
        replacementClockedIn = Boolean(replacement.rows[0]);
    }

    await query(
        `INSERT INTO guard_events (guard_id, event_type, site_id, gps_coordinates, metadata)
     VALUES ($1, 'clock_out', $2, $3, $4)`,
        [guard_id, site_id, gps_coordinates, { replacement_guard_id: replacement_guard_id || null, replacementClockedIn }],
    );

    if (!replacementClockedIn) {
        await enqueueEvent("SUPERVISOR_ALERT", {
            type: "NO_REPLACEMENT_GUARD",
            guard_id,
            site_id,
            replacement_guard_id: replacement_guard_id || null,
        });
    }

    await logAudit(req.user.id, "GUARD_CLOCK_OUT", "guard_event", guard_id, { site_id, replacementClockedIn });
    res.status(201).json({ success: true, replacementClockedIn });
});

app.post("/guard/checkpoint", requireAuth, requireRole("guard", "admin", "supervisor"), async (req, res) => {
    const { guard_id, site_id, checkpoint_id, gps_coordinates } = req.body;
    if (!guard_id || !site_id || !checkpoint_id || !gps_coordinates) {
        return res.status(400).json({ error: "guard_id, site_id, checkpoint_id, gps_coordinates required" });
    }

    await query(
        `INSERT INTO guard_events (guard_id, event_type, site_id, gps_coordinates, metadata)
     VALUES ($1, 'checkpoint_scan', $2, $3, $4)`,
        [guard_id, site_id, gps_coordinates, { checkpoint_id, route_step_complete: true }],
    );
    await logAudit(req.user.id, "CHECKPOINT_SCAN", "guard_event", checkpoint_id, { guard_id, site_id, gps_coordinates });
    res.status(201).json({ success: true, route_step_complete: true });
});

// Reporting
app.post("/reports", requireAuth, requireRole("guard", "admin", "supervisor"), async (req, res) => {
    const { guard_id, site_id, gps_coordinates, report_type, priority, summary, photo_url, audio_url } = req.body;

    if (!guard_id || !site_id || !gps_coordinates || !report_type) {
        return res.status(400).json({ error: "guard_id, site_id, gps_coordinates, report_type required" });
    }

    if (report_type === "SITREP" && !summary) {
        return res.status(400).json({ error: "SITREP requires text summary" });
    }

    if (report_type === "Incident" && priority === "High") {
        if (!photo_url || !audio_url) {
            return res.status(400).json({ error: "High priority incident requires photo + audio" });
        }
        await enqueueEvent("HIGH_PRIORITY_INCIDENT", { guard_id, site_id, gps_coordinates });
    }

    const result = await query(
        `INSERT INTO reports (guard_id, site_id, gps_coordinates, report_type, priority, summary, photo_url, audio_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
        [guard_id, site_id, gps_coordinates, report_type, priority || null, summary || null, photo_url || null, audio_url || null],
    );

    await logAudit(req.user.id, "REPORT_SUBMIT", "report", result.rows[0].id, {
        report_type,
        priority: priority || null,
        immutable: true,
    });

    res.status(201).json(result.rows[0]);
});

app.get("/reports", requireAuth, requireRole("admin", "supervisor"), async (_req, res) => {
    const result = await query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 200");
    res.json(result.rows);
});

// Panic protocol
app.post("/guard/panic", requireAuth, requireRole("guard", "admin", "supervisor"), async (req, res) => {
    const { guard_id, site_id, gps_coordinates } = req.body;
    if (!guard_id || !site_id || !gps_coordinates) {
        return res.status(400).json({ error: "guard_id, site_id, gps_coordinates required" });
    }

    const result = await query(
        `INSERT INTO panic_events (guard_id, site_id, gps_coordinates)
     VALUES ($1, $2, $3) RETURNING *`,
        [guard_id, site_id, gps_coordinates],
    );

    await query(`UPDATE guards SET status = 'Panic', updated_at = NOW() WHERE guard_code = $1`, [guard_id]);
    await enqueueEvent("PANIC_BROADCAST", { guard_id, site_id, gps_coordinates, ptt: true });
    await logAudit(req.user.id, "PANIC_TRIGGER", "panic_event", result.rows[0].id, { guard_id, site_id, gps_coordinates });

    res.status(201).json({
        success: true,
        emergency_channel_activated: true,
        supervisors_notified: true,
        incident_timestamp: result.rows[0].created_at,
    });
});

app.get("/audit-logs", requireAuth, requireRole("admin", "supervisor"), async (_req, res) => {
    const result = await query(
        `SELECT a.*, u.email AS actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC
     LIMIT 300`,
    );
    res.json(result.rows);
});

async function start() {
    const autoInit = String(process.env.AUTO_INIT_DB || "false").toLowerCase() === "true";
    if (autoInit) {
        await initDb();
        console.log("AUTO_INIT_DB enabled: schema initialization executed.");
    } else {
        console.log("AUTO_INIT_DB disabled: expecting Supabase schema to be applied via SQL migrations.");
    }
    const port = Number(process.env.PORT || 4000);
    app.listen(port, () => {
        console.log(`Site Ops backend running on http://localhost:${port}`);
    });
}

start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
