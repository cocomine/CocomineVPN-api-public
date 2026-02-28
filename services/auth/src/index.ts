import 'dotenv/config';
import express, {Application} from 'express';
import log4js from 'log4js';
import cors, {CorsOptions} from 'cors';
import cookies from 'cookie-parser';
import figlet from 'figlet';
import RedisClient from './redis_service';
import {startGrpcServer, stopGrpcServer} from './grpc/server';
import * as http from "node:http";

const app: Application = express();
const logger = log4js.getLogger('auth-service');
const PORT = parseInt(process.env.PORT || '3001');
const GRPC_PORT = parseInt(process.env.GRPC_PORT || '50051');
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV ?? 'production';

// log to file
log4js.configure({
    appenders: {
        out: {type: 'stdout'},
        app: {
            type: 'dateFile',
            filename: 'logs/auth-server',
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
logger.info('Auth Service starting...');

// cors config
let CORS_ORIGIN;
if (NODE_ENV === 'production') {
    CORS_ORIGIN = ['https://vpn.cocomine.cc', 'https://api.cocomine.cc'];
} else {
    CORS_ORIGIN = true;
}
const corsOptions: CorsOptions = {
    origin: CORS_ORIGIN,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    exposedHeaders: ['cf-mitigated'],
};

/*======== middleware =========*/
app.use(log4js.connectLogger(logger, {level: 'auto'}));
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(cookies());
logger.info('Loaded middleware');
/*======== End of middleware =======*/

/*======= router ======*/
// path: /ping
app.get('/ping', (req, res) => {
    res.json({code: 200, message: 'pong'});
});

// path: /auth/*
app.use('/auth', require('./routes'));
logger.info('Loaded /auth');
/*======== End of the route =======*/

// start server
let server: http.Server;
RedisClient.connect().then(async () => {

    // Start HTTP server
    server = app.listen(PORT, HOST, async () => {
        await figlet.text('Auth Service', {
            font: 'ANSI Shadow',
            horizontalLayout: 'full',
            verticalLayout: 'full',
        }, function (err, data) {
            if (err) {
                logger.error('Something went wrong with figlet...');
                return;
            }
            logger.info('\n' + data);
        });

        logger.info(`Auth Service (HTTP) running at http://${HOST}:${PORT}`);
    });

    // Start gRPC server
    startGrpcServer(GRPC_PORT).catch(err => {
        logger.error(err);
        process.exit(1);
    });
}).catch((err: any) => {
    logger.error('Failed to connect to Redis:', err);
    process.exit(1);
});

// handle exit
function stop_server() {
    logger.info('Stopping server...');
    // close server
    server.close(async () => {
        logger.log('Server closed.');
        await RedisClient.quit();
        logger.log('Redis disconnect.');
        await stopGrpcServer();
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
