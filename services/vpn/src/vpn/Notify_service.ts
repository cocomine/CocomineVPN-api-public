import {Worker} from "worker_threads";
import path from "node:path";
import {getLogger} from "log4js";


const NODE_ENV = process.env.NODE_ENV || 'production';
const logger = getLogger('/vpn [Notify service]');

// email notify worker
const email_notify_worker = NODE_ENV === "development"
    ? new Worker(path.resolve(__dirname, './[Email_notify]/email_notify_worker.ts'), {execArgv: ["--require", "ts-node/register"]})
    : new Worker(path.resolve(__dirname, './[Email_notify]/email_notify_worker.js'));
/**
 * @description email notify user
 * @param email user email
 * @param subject email subject
 * @param content email content
 */
const email_notify = async (email: string, subject: string, content: string) => {
    email_notify_worker.postMessage({
        email: email,
        subject: subject,
        content: content
    });
}
/**
 * This function is used to send a notification to a Discord channel.
 * It uses the Discord webhook URL from the environment variables to send a POST request.
 * The notification includes a username, avatar, and the content of the message.
 *
 * @async
 * @function
 * @param {string} content - The content of the message to be sent to the Discord channel.
 * @returns {Promise<void>} - The Promise object represents the completion of an asynchronous operation.
 */
const discord_notify = async (content: string): Promise<void> => {
    // discord webhook
    await fetch(process.env.DISCORD_WEBHOOK_URL as string, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "username": "Cocomine VPN Notify",
            "avatar_url": "https://vpn.cocomine.cc/icon-192.png",
            "content": content
        })
    }).catch((e) => logger.error(e));
}

/**
 * Sends a notification to a Discord channel using form data.
 * It uses the Discord webhook URL from the environment variables to send a POST request.
 * username and avatar_url is already set in the form data.
 *
 * @async
 * @function
 * @param {FormData} form - The form data to be sent to the Discord channel.
 */
const discord_notify_from_data = async (form: FormData) => {
    form.append('username', 'Cocomine VPN Notify');
    form.append('avatar_url', 'https://vpn.cocomine.cc/icon-192.png');

    await fetch(process.env.DISCORD_WEBHOOK_URL as string, {
        method: 'POST',
        body: form,
    }).catch((e) => logger.error(e));
}

export {discord_notify, email_notify, discord_notify_from_data};