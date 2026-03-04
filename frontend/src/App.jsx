import { useEffect, useState } from "react";
import { api } from "./api";

const roleTabs = {
    admin: ["Overview", "Guards", "Visitors", "Approvals", "Code Lookup", "Reports", "Audit"],
    supervisor: ["Overview", "Approvals", "Code Lookup", "Reports", "Audit"],
    guard: ["Overview", "Code Lookup", "Guard Ops", "Reports", "Panic"],
};

export default function App() {
    const [token, setToken] = useState(localStorage.getItem("token") || "");
    const [user, setUser] = useState(() => {
        const raw = localStorage.getItem("user");
        return raw ? JSON.parse(raw) : null;
    });
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [activeTab, setActiveTab] = useState("Overview");

    const [guards, setGuards] = useState([]);
    const [visitors, setVisitors] = useState([]);
    const [pendingVisits, setPendingVisits] = useState([]);
    const [reports, setReports] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [codeResult, setCodeResult] = useState(null);

    const [loginForm, setLoginForm] = useState({ email: "admin@siteops.local", password: "Admin@123" });
    const [guardForm, setGuardForm] = useState({ guard_code: "", full_name: "", phone: "", site_id: "" });
    const [visitorForm, setVisitorForm] = useState({ full_name: "", id_number: "", phone: "", email: "", company: "" });
    const [visitForm, setVisitForm] = useState({ visitor_id: "", host_name: "", host_contact: "", site_id: "HQ-1", visitor_status: "Pre-Registered" });
    const [codeInput, setCodeInput] = useState("");
    const [reportForm, setReportForm] = useState({
        guard_id: "GRD-001",
        site_id: "HQ-1",
        gps_coordinates: "-26.2041,28.0473",
        report_type: "SITREP",
        priority: "Low",
        summary: "",
        photo_url: "",
        audio_url: "",
    });

    async function loadData() {
        if (!token || !user) return;
        try {
            if (["admin", "supervisor"].includes(user.role)) {
                const [g, v, p, r, a] = await Promise.all([
                    api("/guards", { token }),
                    api("/visitors", { token }),
                    api("/visits/pending", { token }),
                    api("/reports", { token }),
                    api("/audit-logs", { token }),
                ]);
                setGuards(g);
                setVisitors(v);
                setPendingVisits(p);
                setReports(r);
                setAuditLogs(a);
            }
        } catch (e) {
            setError(e.message);
        }
    }

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, user?.role]);

    async function login(e) {
        e.preventDefault();
        setError("");
        try {
            const data = await api("/auth/login", { method: "POST", body: loginForm });
            setToken(data.token);
            setUser(data.user);
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            setMessage(`Logged in as ${data.user.role}`);
        } catch (err) {
            setError(err.message);
        }
    }

    function logout() {
        setToken("");
        setUser(null);
        localStorage.removeItem("token");
        localStorage.removeItem("user");
    }

    async function createGuard(e) {
        e.preventDefault();
        try {
            await api("/guards", { method: "POST", token, body: guardForm });
            setGuardForm({ guard_code: "", full_name: "", phone: "", site_id: "" });
            setMessage("Guard created.");
            await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function deactivateGuard(id) {
        try {
            await api(`/guards/${id}`, { method: "DELETE", token });
            setMessage("Guard deactivated.");
            await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function createVisitor(e) {
        e.preventDefault();
        try {
            await api("/visitors", { method: "POST", token, body: visitorForm });
            setVisitorForm({ full_name: "", id_number: "", phone: "", email: "", company: "" });
            setMessage("Visitor created.");
            await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function createVisitRequest(e) {
        e.preventDefault();
        try {
            await api("/visits", { method: "POST", token, body: { ...visitForm, visitor_id: Number(visitForm.visitor_id) } });
            setMessage("Visit request submitted.");
            await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function approveVisit(id) {
        try {
            const result = await api(`/visits/${id}/approve`, { method: "POST", token, body: {} });
            setMessage(`Approved. One-time code: ${result.code}`);
            await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function denyVisit(id) {
        try {
            await api(`/visits/${id}/deny`, { method: "POST", token, body: { reason: "Denied by administrator" } });
            setMessage("Visit denied.");
            await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function lookupCode(e) {
        e.preventDefault();
        try {
            const data = await api(`/visitor-code/${encodeURIComponent(codeInput)}`, { token });
            setCodeResult(data);
            setMessage("Code lookup successful.");
        } catch (err) {
            setError(err.message);
            setCodeResult(null);
        }
    }

    async function checkinCode() {
        try {
            await api(`/visitor-code/${encodeURIComponent(codeInput)}/checkin`, {
                method: "POST",
                token,
                body: { guard_id: user?.role === "guard" ? "GRD-001" : "DESK-ADMIN" },
            });
            setMessage("Visitor checked in. Code is now used.");
            await lookupCode({ preventDefault() { } });
        } catch (err) {
            setError(err.message);
        }
    }

    async function submitReport(e) {
        e.preventDefault();
        try {
            const payload = { ...reportForm };
            if (payload.report_type !== "Incident") payload.priority = null;
            await api("/reports", { method: "POST", token, body: payload });
            setMessage("Report submitted (immutable).");
            if (["admin", "supervisor"].includes(user.role)) await loadData();
        } catch (err) {
            setError(err.message);
        }
    }

    async function panicNow() {
        try {
            await api("/guard/panic", {
                method: "POST",
                token,
                body: {
                    guard_id: "GRD-001",
                    site_id: "HQ-1",
                    gps_coordinates: "-26.2041,28.0473",
                },
            });
            setMessage("Panic protocol activated. Supervisors notified.");
        } catch (err) {
            setError(err.message);
        }
    }

    if (!token || !user) {
        return (
            <div className="container">
                <h1>Site Operations Portal</h1>
                <p>Strict protocol access system.</p>
                <form className="card" onSubmit={login}>
                    <h3>Login</h3>
                    <input placeholder="Email" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} />
                    <input placeholder="Password" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} />
                    <button type="submit">Login</button>
                    <small>Use seeded accounts from README.</small>
                </form>
                {error && <div className="error">{error}</div>}
            </div>
        );
    }

    const tabs = roleTabs[user.role] || ["Overview"];

    return (
        <div className="container">
            <header className="topbar">
                <div>
                    <h2>Site Operations Assistant</h2>
                    <p>
                        Signed in as <b>{user.name}</b> ({user.role})
                    </p>
                </div>
                <button onClick={logout}>Logout</button>
            </header>

            <nav className="tabs">
                {tabs.map((tab) => (
                    <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
                        {tab}
                    </button>
                ))}
            </nav>

            {message && <div className="success">{message}</div>}
            {error && <div className="error">{error}</div>}

            {activeTab === "Overview" && (
                <section className="card">
                    <h3>Protocol Overview</h3>
                    <ul>
                        <li>Unannounced visitors are denied by default.</li>
                        <li>Only approved visits issue one-time visitor code.</li>
                        <li>Reports are immutable after submission.</li>
                        <li>Panic triggers immediate supervisor broadcast workflow.</li>
                    </ul>
                </section>
            )}

            {activeTab === "Guards" && user.role === "admin" && (
                <section className="grid2">
                    <form className="card" onSubmit={createGuard}>
                        <h3>Add Guard</h3>
                        <input placeholder="Guard Code" value={guardForm.guard_code} onChange={(e) => setGuardForm({ ...guardForm, guard_code: e.target.value })} />
                        <input placeholder="Full Name" value={guardForm.full_name} onChange={(e) => setGuardForm({ ...guardForm, full_name: e.target.value })} />
                        <input placeholder="Phone" value={guardForm.phone} onChange={(e) => setGuardForm({ ...guardForm, phone: e.target.value })} />
                        <input placeholder="Site ID" value={guardForm.site_id} onChange={(e) => setGuardForm({ ...guardForm, site_id: e.target.value })} />
                        <button type="submit">Create Guard</button>
                    </form>
                    <div className="card">
                        <h3>Guard Directory</h3>
                        {guards.map((g) => (
                            <div key={g.id} className="row">
                                <span>
                                    {g.guard_code} - {g.full_name} ({g.status}) {g.active ? "" : "[inactive]"}
                                </span>
                                {g.active && <button onClick={() => deactivateGuard(g.id)}>Deactivate</button>}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {activeTab === "Visitors" && user.role === "admin" && (
                <section className="grid2">
                    <form className="card" onSubmit={createVisitor}>
                        <h3>Create Visitor</h3>
                        <input placeholder="Full Name" value={visitorForm.full_name} onChange={(e) => setVisitorForm({ ...visitorForm, full_name: e.target.value })} />
                        <input placeholder="ID Number" value={visitorForm.id_number} onChange={(e) => setVisitorForm({ ...visitorForm, id_number: e.target.value })} />
                        <input placeholder="Phone" value={visitorForm.phone} onChange={(e) => setVisitorForm({ ...visitorForm, phone: e.target.value })} />
                        <input placeholder="Email" value={visitorForm.email} onChange={(e) => setVisitorForm({ ...visitorForm, email: e.target.value })} />
                        <input placeholder="Company" value={visitorForm.company} onChange={(e) => setVisitorForm({ ...visitorForm, company: e.target.value })} />
                        <button type="submit">Save Visitor</button>
                    </form>
                    <div className="card">
                        <h3>Visitor Requests</h3>
                        <form onSubmit={createVisitRequest}>
                            <select value={visitForm.visitor_id} onChange={(e) => setVisitForm({ ...visitForm, visitor_id: e.target.value })}>
                                <option value="">Select Visitor</option>
                                {visitors.map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.full_name} (#{v.id})
                                    </option>
                                ))}
                            </select>
                            <input placeholder="Host Name" value={visitForm.host_name} onChange={(e) => setVisitForm({ ...visitForm, host_name: e.target.value })} />
                            <input placeholder="Host Contact" value={visitForm.host_contact} onChange={(e) => setVisitForm({ ...visitForm, host_contact: e.target.value })} />
                            <input placeholder="Site ID" value={visitForm.site_id} onChange={(e) => setVisitForm({ ...visitForm, site_id: e.target.value })} />
                            <select value={visitForm.visitor_status} onChange={(e) => setVisitForm({ ...visitForm, visitor_status: e.target.value })}>
                                <option>Pre-Registered</option>
                                <option>Unannounced</option>
                            </select>
                            <button type="submit">Submit Request</button>
                        </form>
                    </div>
                </section>
            )}

            {activeTab === "Approvals" && ["admin", "supervisor"].includes(user.role) && (
                <section className="card">
                    <h3>Pending Approval Queue</h3>
                    {pendingVisits.length === 0 && <p>No pending requests.</p>}
                    {pendingVisits.map((v) => (
                        <div key={v.id} className="row">
                            <span>
                                #{v.id} {v.visitor_name} - {v.visitor_status} - Site {v.site_id}
                            </span>
                            <div>
                                <button onClick={() => approveVisit(v.id)}>Approve</button>
                                <button onClick={() => denyVisit(v.id)}>Deny</button>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {activeTab === "Code Lookup" && (
                <section className="card">
                    <h3>Visitor Code Lookup</h3>
                    <form onSubmit={lookupCode}>
                        <input placeholder="Enter one-time code" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
                        <button type="submit">Search</button>
                    </form>
                    {codeResult && (
                        <div className="details">
                            <p>
                                <b>Visitor:</b> {codeResult.full_name} ({codeResult.company || "N/A"})
                            </p>
                            <p>
                                <b>Visit:</b> #{codeResult.visit_id} @ {codeResult.site_id}
                            </p>
                            <p>
                                <b>Host:</b> {codeResult.host_name || "N/A"} / {codeResult.host_contact || "N/A"}
                            </p>
                            <p>
                                <b>Code Status:</b> {codeResult.code_status}
                            </p>
                            {codeResult.code_status === "issued" && <button onClick={checkinCode}>Check-In Visitor (consume code)</button>}
                        </div>
                    )}
                </section>
            )}

            {activeTab === "Guard Ops" && user.role === "guard" && (
                <section className="card">
                    <h3>Guard Operations</h3>
                    <p>Use code lookup for check-ins and submit reports below.</p>
                </section>
            )}

            {activeTab === "Reports" && (
                <section className="grid2">
                    <form className="card" onSubmit={submitReport}>
                        <h3>Submit Report</h3>
                        <input placeholder="Guard ID" value={reportForm.guard_id} onChange={(e) => setReportForm({ ...reportForm, guard_id: e.target.value })} />
                        <input placeholder="Site ID" value={reportForm.site_id} onChange={(e) => setReportForm({ ...reportForm, site_id: e.target.value })} />
                        <input placeholder="GPS Coordinates" value={reportForm.gps_coordinates} onChange={(e) => setReportForm({ ...reportForm, gps_coordinates: e.target.value })} />
                        <select value={reportForm.report_type} onChange={(e) => setReportForm({ ...reportForm, report_type: e.target.value })}>
                            <option>SITREP</option>
                            <option>Incident</option>
                            <option>Patrol</option>
                        </select>
                        <select value={reportForm.priority} onChange={(e) => setReportForm({ ...reportForm, priority: e.target.value })}>
                            <option>Low</option>
                            <option>Medium</option>
                            <option>High</option>
                        </select>
                        <textarea placeholder="Summary (required for SITREP)" value={reportForm.summary} onChange={(e) => setReportForm({ ...reportForm, summary: e.target.value })} />
                        <input placeholder="Photo URL (required for high Incident)" value={reportForm.photo_url} onChange={(e) => setReportForm({ ...reportForm, photo_url: e.target.value })} />
                        <input placeholder="Audio URL (required for high Incident)" value={reportForm.audio_url} onChange={(e) => setReportForm({ ...reportForm, audio_url: e.target.value })} />
                        <button type="submit">Submit Final Report</button>
                    </form>
                    {["admin", "supervisor"].includes(user.role) && (
                        <div className="card">
                            <h3>Recent Reports</h3>
                            {reports.map((r) => (
                                <div key={r.id} className="row">
                                    <span>
                                        #{r.id} {r.report_type} {r.priority ? `(${r.priority})` : ""} - {r.guard_id}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {activeTab === "Panic" && user.role === "guard" && (
                <section className="card">
                    <h3>Emergency</h3>
                    <p>Activates panic protocol immediately.</p>
                    <button className="danger" onClick={panicNow}>
                        Trigger Panic
                    </button>
                </section>
            )}

            {activeTab === "Audit" && ["admin", "supervisor"].includes(user.role) && (
                <section className="card">
                    <h3>Audit Trail</h3>
                    {auditLogs.map((a) => (
                        <div key={a.id} className="row">
                            <span>
                                {a.created_at} - {a.action} - {a.entity_type}:{a.entity_id} ({a.actor_email || "system"})
                            </span>
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}
