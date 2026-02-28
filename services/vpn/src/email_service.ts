import * as google from "@googleapis/oauth2";
import {gmail} from "@googleapis/gmail";

const OAuth2 = google.auth.OAuth2;
const authClient = new OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);

authClient.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const GmailClient = gmail({version: 'v1', auth: authClient});

//@deprecated
// create reusable transporter object using the default SMTP transport
/*const transporter = nodemailer.createTransport({
    host: "smtp-relay.gmail.com",
    port: 465,
    secure: true,
    auth: {
        type: "OAuth2",
        user: 'cocomine@cocomine.cc',
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    },
    logger: false,
    debug: LOG_LEVEL === "debug", // include SMTP traffic in the logs,
    name: 'cocomine.cc',
});

// verify connection configuration
transporter.verify(function(error, success) {
    if (error) {
        logger.error(error);
    } else {
        logger.info('Server is ready to take our messages');
    }
});*/

export default GmailClient;