import {RequestHandler} from "express";

const AUD = ["9dba25e7a71d1f1317abb0974f2037c0f747f00273c9fcdb56e8e03956171a0f", 'cocominevpn://login']; // CF Application AUD

/**
 * Middleware to check if the request's payload contains a valid audience (AUD).
 * If the AUD is valid, the request is passed to the next middleware or route handler.
 * If the AUD is not valid, a 403 Forbidden response is sent.
 */
const audVerify: RequestHandler = async (req, res, next) => {
    if (AUD.some((item) => req.payload.aud?.includes(item))) {
        return next();
    }

    res.status(403).json({code: 403, message: 'You dont have permission to access this resource'});
};

export {audVerify};