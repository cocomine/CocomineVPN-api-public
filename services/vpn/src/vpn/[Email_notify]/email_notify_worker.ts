import log4js, {getLogger} from "log4js";
import {parentPort} from "worker_threads";
import {EmailQueue, EmailQueueEvents, shutdownEmailQueue} from "./EmailQueue";

const logger = getLogger('/vpn/[Email_notify]/email_notify_worker');
log4js.configure({
    appenders: {
        out: {type: 'stdout'},
        app: {type: 'dateFile',
            filename: 'logs/server',
            pattern: 'yyyy-MM-dd.log',
            alwaysIncludePattern: true,
            compress: true,
            numBackups: 30},
    },
    categories: {
        default: {appenders: ['out', 'app'], level: process.env.LOG_LEVEL || 'info'}
    },
});
logger.info('Email notify worker loaded.');

parentPort?.on('message', async (data: { email: string, subject: string, content: string }) => {
    await EmailQueue.add('processEmail', {to: data.email, subject: data.subject, content: data.content}, {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 1000, // initial delay of 1 second
        }
    })
});

// Queue events for logging
EmailQueueEvents.on("completed", ({jobId, returnvalue}) => logger.info(`Job ${jobId} email sent: `, returnvalue));
EmailQueueEvents.on("failed", ({
                                   jobId,
                                   failedReason
                               }) => logger.error(`Job ${jobId} email sent failed: `, failedReason));

// Ensure the EmailQueue is gracefully shut down on common process termination events.
process.on("SIGINT", shutdownEmailQueue);
process.on("SIGTERM", shutdownEmailQueue);
process.on("beforeExit", shutdownEmailQueue);
