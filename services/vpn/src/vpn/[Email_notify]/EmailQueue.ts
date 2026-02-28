import {ConnectionOptions, Queue, QueueEvents, Worker} from "bullmq";
import {getLogger} from "log4js";
import GmailClient from "../../email_service";

type EmailType = {
    to: string;
    subject: string;
    content: string
}

const NODE_ENV = process.env.NODE_ENV || "production";
const connection: ConnectionOptions = {
    host: NODE_ENV === "development" ? "localhost" : "redis",
    port: 6379
};
const EmailQueue = new Queue("EmailQueue", {connection});
const EmailQueueEvents = new QueueEvents("EmailQueue", {connection});
const logger = getLogger('/vpn/[Email_notify]/EmailQueue');

/**
 * Start the EmailQueue worker to process queued track data.
 */
function startEmailQueueWorker() {
    return new Worker<EmailType>("EmailQueue", async (job) => {
            logger.debug("Job " + job.id + " send email: ", job.data);

            // send email notify
            const message = {
                from: "Cocomine VPN Manager Notify  <vpn@cocomine.cc>",
                to: job.data.to,
                replyTo: "cocomine@cocomine.cc",
                subject: Buffer.from(job.data.subject).toString('base64'),
                content: job.data.content,
            };

            const emailLines = [
                'From: ' + message.from,
                'To: ' + message.to,
                'Reply-To: ' + message.replyTo,
                'Content-type: text/html;charset=utf-8',
                'MIME-Version: 1.0',
                'Subject: =?utf-8?B?' + message.subject + '?=',
                '',
                message.content
            ];

            const email = emailLines.join('\r\n').trim();
            const base64Email = Buffer.from(email).toString('base64');

            // send email
            const res = await GmailClient.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: base64Email
                }
            });
            return res.data.id;
        },
        {connection, concurrency: 3}
    );
}

const EmailQueueWorker = startEmailQueueWorker();

/**
 * Shutdown the EmailQueue gracefully.
 */
async function shutdownEmailQueue() {
    try {
        await EmailQueue.close();
        await EmailQueueWorker.close();
        await EmailQueueEvents.close();
    } catch (e) {
        logger.error("Error shutdownEmailQueue", e);
    }
}

export {shutdownEmailQueue, EmailQueue, EmailQueueEvents};
export type {EmailType};