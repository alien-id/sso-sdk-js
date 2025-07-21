export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function base64UrlDecode(str: string): string {
    const padded = str + "=".repeat((4 - (str.length % 4)) % 4); // Pad with "="
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    try {
        return decodeURIComponent(
            atob(base64)
                .split("")
                .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
                .join("")
        );
    } catch {
        throw new Error("Invalid base64url input");
    }
}