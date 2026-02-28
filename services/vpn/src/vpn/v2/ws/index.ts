import {getLogger} from "log4js";
import xss from "xss";
import RedisClient from "../../../redis_service";
import {Request, Response, Router as HttpRouter} from "express";
import {generateSecureTokenBase64, verifyToken} from "../../../auth_service";
import {pushWSClient} from "./BroadcastsMessage";
import {audVerify} from "../../audVerify";
import {Router as WSRouter} from "websocket-express";

const router = new WSRouter();
const httpRouter = HttpRouter();
const logger = getLogger('/vpn/v2/ws');

/*======= router ======*/
// Handles the WebSocket connection for Web clients.
// Path: /vpn/v2/ws
router.ws('/', async (req, res) => {
    const ticket = xss(req.query.ticket?.toString() || '');

    //ticket format validation
    if (!/^[a-zA-Z0-9\-_]{16,}$/.test(ticket)) {
        res.reject(400, 'Invalid ticket format.');
        logger.warn('\u001b[34m[v2]\u001b[0m', ticket + ' - Invalid ticket format.');
        return;
    }

    const data = await RedisClient.get('ws_ticket:' + ticket)

    // If the ticket is invalid, reject the connection.
    if (data === null) {
        res.reject(400, 'Invalid ticket.');

        logger.warn('\u001b[34m[v2]\u001b[0m', ticket + ' - Invalid ticket.');
        return;
    }

    // If the ticket is valid, authorize the connection.
    const ws = await res.accept();
    const [ticket_ip, email] = data.split(":");

    try {
        ws.send(JSON.stringify({url: '/ping', data: null}));
        await ws.nextMessage({timeout: 5000})
    } catch (error) {
        ws.close();
        logger.warn('\u001b[34m[v2]\u001b[0m', email + '[' + ticket_ip + ']' + ' - Ping timeout. Connection closed.');
        return;
    }
    pushWSClient(ws); // Add the WebSocket client to the list of connected clients.

    logger.info('\u001b[34m[v2]\u001b[0m', email + '[' + ticket_ip + ']' + ' - Authorized.');
    await RedisClient.del('ws_ticket:' + ticket);
});

//This function generates a ticket, sends it to the client, and saves it to Redis.
//Path: /vpn/v2/ws/ticket
httpRouter.use('/ticket', verifyToken)
httpRouter.get('/ticket', audVerify, async (req: Request, res: Response) => {
    // Generate a random string to be used as a ticket.
    // The result is a string of approximately 26 alphanumeric characters.
    const ticket = generateSecureTokenBase64();

    // Send the ticket to the client.
    res.json({code: 200, message: 'Ticket generated.', data: {ticket: ticket}});

    // Save the ticket to Redis, associating it with the user's email.
    // The ticket expires after 60 seconds.
    // @deprecated This code will be removed in the future.
    await RedisClient.set('ws_ticket:' + ticket, req.ip + ":" + req.payload.email, {EX: 60});
});
logger.info('Loaded /vpn/v2/ws/ticket');

router.useHTTP(httpRouter);

module.exports = router;