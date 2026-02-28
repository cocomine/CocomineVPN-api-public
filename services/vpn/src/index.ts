import 'dotenv/config';
import RedisClient from "./redis_service";
import {WebSocketExpress} from "websocket-express";
import express from 'express';
import log4js from "log4js";
import cors, {CorsOptions} from "cors";
import cookies from "cookie-parser";
import figlet from "figlet";
import cloudflareIPs from 'cloudflare-ips';

const app = new WebSocketExpress(); // create websocket express server
const logger = log4js.getLogger('root'); // create logger
const PORT = parseInt(process.env.PORT || '3000'); // default port 3000
const HOST = process.env.HOST || '0.0.0.0'; // default host
const NODE_ENV = process.env.NODE_ENV || 'production'; // default environment

//log to file
log4js.configure({
    appenders: {
        out: {type: 'stdout'},
        app: {
            type: 'dateFile',
            filename: 'logs/server',
            pattern: 'yyyy-MM-dd.log',
            alwaysIncludePattern: true,
            compress: true,
            numBackups: 30
        },
    },
    categories: {
        default: {appenders: ['out', 'app'], level: process.env.LOG_LEVEL || 'info'}
    },
});
logger.info('Server starting...');

// cors config
let CORS_ORIGIN;
if (NODE_ENV === "production") {
    CORS_ORIGIN = ['https://vpn.cocomine.cc', 'https://api.cocomine.cc']; // for production
} else {
    CORS_ORIGIN = true; // for test
}
const corsOptions: CorsOptions = {
    origin: CORS_ORIGIN,
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    exposedHeaders: ['cf-mitigated'],
};

// trust proxy
cloudflareIPs(
    ips => app.set('trust proxy', ['loopback', ...ips]),
    err => logger.error(err)
);

/*======== middleware =========*/
app.use(log4js.connectLogger(logger, {level: 'auto'})); // log all requests
app.useHTTP(cors(corsOptions)); // enable CORS for HTTP only
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({extended: true})); // for parsing application/x-www-form-urlencoded
app.use(cookies());
logger.info("Loaded middleware");
/*======== End of middleware =======*/

/*======= router ======*/
// path: /
app.all('/', async (req, res) => {
    res.status(400).json({code: 400, message: 'Please define the api you want to use.'});
});

// path: /ping
app.get('/ping', async (req, res) => {
    res.json({code: 200, message: 'pong'});
});

//path: /vpn/*
app.use("/vpn", require('./vpn'));
logger.info("Loaded /vpn");
/*======== End of the route =======*/

// start server
const server = app.createServer();
RedisClient.connect().then(async _ => {
    server.listen(PORT, HOST, async () => {
        await figlet.text('Cocomine API', {
            font: 'ANSI Shadow',
            horizontalLayout: 'full',
            verticalLayout: 'full',
        }, function (err, data) {
            if (err) {
                logger.error(err);
                return;
            }
            logger.info('\n' + data);
        });
        logger.info(`Server start on ${HOST}:${PORT}!`);
        logger.info(`Version: 1.19.0`);
        logger.debug(`Debug log enabled!`);
    });
});

// handle server error
server.on('error', err => {
    logger.error('Server error:', err);
});

// handle exit
function stop_server() {
    logger.info('Stopping server...');

    // close all ws client
    //const {closeAllWSClient} = require("./vpn/v2/ws/BroadcastsMessage");
    //closeAllWSClient();

    // close server
    server.close(async () => {
        logger.log('Server closed.');
        await RedisClient.quit();
        logger.log('Redis disconnect.');
        const {shutdownQueue} = require("./vpn/track/TrackDataQueue");
        await shutdownQueue();
        const {shutdownSqlPool} = require("./sql_service");
        await shutdownSqlPool();
        const {disconnect} = require("./grpc/auth/client");
        await disconnect();
        await figlet.text('See ya!', {
            font: 'ANSI Shadow',
            horizontalLayout: 'full',
            verticalLayout: 'full',
        }, function (err, data) {
            if (err) {
                logger.error(err);
                return;
            }
            logger.info('\n' + data);
        });
        process.exit(0);
    });
}

process.on('SIGINT', stop_server);
process.on('SIGTERM', stop_server);
process.on("beforeExit", stop_server);