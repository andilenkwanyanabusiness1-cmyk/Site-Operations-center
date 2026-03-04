import crypto from "crypto";

export function generateVisitorCode() {
    const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
    const checksum = raw
        .split("")
        .reduce((sum, c) => sum + c.charCodeAt(0), 0)
        .toString()
        .slice(-2)
        .padStart(2, "0");
    return `VIS-${raw}-${checksum}`;
}
