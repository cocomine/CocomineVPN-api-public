import jwt from "jsonwebtoken";

// Define the JwtPayload interface to include name and email
export interface JwtPayload extends jwt.JwtPayload {
    name?: string,
    email: string,
}

// Extend Express Request interface to include payload property
declare global {
    namespace Express {
        export interface Request {
            payload: JwtPayload,
        }
    }
}