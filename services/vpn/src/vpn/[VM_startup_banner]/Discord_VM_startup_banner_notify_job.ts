import {Worker} from "worker_threads";
import path from "node:path";
import {discord_notify, discord_notify_from_data} from "../Notify_service";


const NODE_ENV = process.env.NODE_ENV || 'production';
type workerMessage = { jobId: string, buffer: Buffer }

// VM startup banner generate worker
const VM_startup_banner_generate_worker = NODE_ENV === "development"
    ? new Worker(path.resolve(__dirname, './VM_startup_banner_generate_worker.ts'),
        {execArgv: ["--require", "ts-node/register"]})
    : new Worker(path.resolve(__dirname, './VM_startup_banner_generate_worker.js'));


/**
 * Class representing a Discord VM startup banner notification job.
 */
class Discord_VM_startup_banner_notify_job {
    private textMsg: string
    private msg: string | null = null
    private expTime: string | null = null
    private country: string | null = null
    private jobId: string | null = null

    /**
     * Create a Discord VM startup banner notification job.
     * @param {string} textMsg - The text message to be sent.
     */
    constructor(textMsg: string) {
        this.textMsg = textMsg;
    }

    /**
     * Create a banner by sending a message to the worker.
     * @private
     */
    private create_banner() {
        this.jobId = crypto.randomUUID();
        VM_startup_banner_generate_worker.postMessage({
            msg: this.msg,
            expTime: this.expTime,
            country: this.country,
            jobId: this.jobId
        });
    }

    /**
     * Set the properties for the banner.
     * @param {string} msg - The message to be displayed on the banner.
     * @param {string} [expTime="N/A"] - The expiration time of the banner.
     * @param {string} country - The country associated with the banner.
     */
    public setBannerProperty(msg: string, expTime: string = "N/A", country: string) {
        this.msg = msg;
        this.expTime = expTime;
        this.country = country;
    }

    /**
     * Set the text message to be sent.
     * This will override the constructor `textMsg` you set.
     * @param {string} msg - The text message.
     */
    public setTextMsg(msg: string) {
        this.textMsg = msg;
    }

    /**
     * Send the notification. If banner properties are set, it will generate a banner and send it.
     * Otherwise, it will send a simple text message.
     * @async
     */
    public async send() {
        if (this.msg && this.expTime && this.country) {

            const done = async (data: workerMessage) => {
                if (data.jobId !== this.jobId) return; // ignore other messages

                const form = new FormData();
                form.append('file1', new Blob([data.buffer as any], {type: 'image/png'}), 'banner.png');
                form.append('content', this.textMsg);

                //fs.writeFileSync("test/"+this.textMsg+".png", data.buffer); // For test
                VM_startup_banner_generate_worker.removeListener("message", done);
                await discord_notify_from_data(form);
            }

            VM_startup_banner_generate_worker.addListener("message", done);
            this.create_banner();
        } else {
            await discord_notify(this.textMsg);
        }
    }
}

// For Test
/*let i = 0
 let timeout =setInterval(() => {
 let bannerNotify = new Discord_VM_startup_banner_notify_job(i.toString());
 bannerNotify.setBannerProperty("Test message " + i, "Test time", "us");
 bannerNotify.send();
 i++

 if(i > 200) clearInterval(timeout);
 },100);

 setInterval(() => {
 console.log(VM_startup_banner_generate_worker.listenerCount("message"));
 }, 100);*/

export {Discord_VM_startup_banner_notify_job};