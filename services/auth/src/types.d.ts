export interface JwtPayload {
    email: string;
    aud: string;
    name: string;
    sub?: string;
    exp?: number;
    iat?: number;
    iss?: string;
    jti?: string;
}

declare global {
    namespace Express {
        interface Request {
            payload: JwtPayload;
        }
    }
}

export {};
