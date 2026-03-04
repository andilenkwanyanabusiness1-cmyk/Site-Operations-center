import jwt from "jsonwebtoken";

function getVerificationSecret() {
    return process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET;
}

export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    try {
        const payload = jwt.verify(token, getVerificationSecret());
        req.user = {
            ...payload,
            role: payload?.role || payload?.app_metadata?.role || "guard",
        };
        next();
    } catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}

export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: "Forbidden" });
        }
        next();
    };
}
