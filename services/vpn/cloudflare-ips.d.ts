declare module 'cloudflare-ips' {
    export default function cloudflareIPs(
        success: (ips: string[]) => void,
        error: (err: any) => void): void;
}