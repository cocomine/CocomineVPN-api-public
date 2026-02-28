import {Router} from "websocket-express";
import xss from "xss";
import RedisClient from "../../redis_service";
import {AlreadyStatusError, NotIn60minError, ReadOnlyError} from "../[VM_Class]/VM";
import {getLogger} from "log4js";
import {discord_notify, email_notify} from "../Notify_service";
import {vm_data} from "../VM_Data";
import {Discord_VM_startup_banner_notify_job} from "../[VM_startup_banner]/Discord_VM_startup_banner_notify_job";
import path from "node:path";
import fs_sync from "node:fs";

// define put body type
type vpn_server_put_body = {
    target_state: "START" | "STOP"
}

const router = new Router();
const logger = getLogger('/vpn/:id');

//load email template
const filePath = path.join(__dirname, '..', '[Email_notify]', 'email-template.html');
let EmailHTMLTemplate: string = fs_sync.readFileSync(filePath, {
    encoding: 'utf-8',
    flag: 'r'
});

// Watch for changes in the email-template.html file
fs_sync.watch(filePath, (eventType) => {
    if (eventType === 'change') {
        logger.info('email-template.html file changed, reloading...');
        // Reload email-template.html
        EmailHTMLTemplate = fs_sync.readFileSync(filePath, {encoding: 'utf-8', flag: 'r'});
        logger.info('email-template.html reloaded successfully');
    }
});

/*======= router ======*/
router.use('/', require('./profile'));
logger.info("Loaded /vpn/:id/profile");

router.use('/', require('./troubleshoot'));
logger.info("Loaded /vpn/:id/troubleshoot");

// Get VPN server status
// path: /vpn/:id
router.get('/:id', async (req, res) => {
    const id = xss(req.params['id']);

    //check id format
    if (!/^[0-9]+$/.test(id)) {
        res.status(400);
        res.json({code: 400, message: 'VPN server ID format error'});
        return;
    }

    const vm = vm_data.find((item) => item.id === id);

    if (vm === undefined) {
        res.status(404);
        res.json({code: 404, message: 'Not found VPN server ' + id});
        return;
    }

    res.json({
        code: 200,
        data: vm.toObject(),
        message: 'Get VPN server ' + id + ' success',
    });
});

//extend VPN server online time
//path: /vpn/:id
router.patch('/:id', async (req, res) => {
    const id = xss(req.params['id']);

    //check id format
    if (!/^[0-9]+$/.test(id)) {
        res.status(400);
        res.json({code: 400, message: 'VPN server ID format error'});
        return;
    }

    const vm = vm_data.find((item) => item.id === id);

    if (vm === undefined) {
        res.status(404);
        res.json({code: 404, message: 'Not found VPN server ' + id});
        return;
    }

    if (vm.expired !== null) {
        try {
            vm.extendExpiredTime(new Date(vm.expired.getTime() + 4 * 60 * 60 * 1000));
            res.json({
                code: 200,
                data: vm,
                message: 'Extend VPN server ' + id + ' online time success',
            });

            const email_content = EmailHTMLTemplate.replace('%EMAIL_SUBJECT%', `${vm.country}(${vm.name}) VPN節點已延長開放時間!`)
                .replace('%USER_NAME%', req.payload.name ?? "")
                .replace('%EMAIL_BODY%',
                    `<p style="margin: 0 0 20px 0;">
                        ${vm.country}(${vm.name}) VPN節點已延長開放時間。節點會維持上線4小時, 4小時後如需要繼續使用請到 https://vpn.cocomine.cc/${vm.id} 重新啟動。
                    </p> 
                    <p style="margin: 0 0 20px 0;">
                        你亦可以在離線前一個小時延長開放時間, 避免服務中斷。
                    </p> 
                    <p style="margin: 0 0 20px 0;">
                    預計離線時間: ${vm.expired.toLocaleString('zh-HK')}
                    </p>`)
                .replace('%LINK%', `https://vpn.cocomine.cc/${vm.id}`);

            //notify user
            await email_notify(req.payload.email, `${vm.country}(${vm.name}) VPN節點已延長開放時間!`, email_content);

            // Create a new instance of Discord_VM_startup_banner_notify_job with a message indicating the VPN node has started.
            const banner_notify = new Discord_VM_startup_banner_notify_job(
                `🕔 ${vm.country}(${vm.name}) VPN節點已延長開放時間! \n\n預計離線時間: ${vm.expired.toLocaleString(
                    'zh-HK')}`);

            // If the VM's country is defined, set the banner properties with the VM's country, name, and estimated offline time.
            if (vm.country) {
                banner_notify.setBannerProperty(`${vm.country} VPN node has extended its opening hours!`,
                    vm.expired?.toLocaleString('en') ?? "N/A", vm.country);
            }

            // Send the banner notification.
            await banner_notify.send();
        } catch (e: any) {
            if (e instanceof NotIn60minError) {
                res.status(462);
                res.json({code: 462, message: 'The expired time is not in 60 min.'});
            } else {
                res.status(500);
                res.json({code: 500, message: 'Internal server error'});
                logger.error(e);
            }
        }
    } else {
        res.status(463);
        res.json({code: 463, message: 'VM ' + id + ' is not online'});
    }
});

//update VPN server status
//path: /vpn/:id
router.put('/:id', async (req, res) => {
    const body: vpn_server_put_body = req.body;
    logger.debug(body);

    //check body
    if (body.target_state === undefined) {
        res.status(400);
        res.json({code: 400, message: 'Missing body parameter'});
        return;
    }

    //check input
    if (body.target_state !== 'START' && body.target_state !== 'STOP') {
        res.status(400);
        res.json({code: 400, message: 'Invalid body parameter'});
        return;
    }

    //is server exist?
    const id = xss(req.params['id']);

    //check id format
    if (!/^[0-9]+$/.test(id)) {
        res.status(400);
        res.json({code: 400, message: 'VPN server ID format error'});
        return;
    }

    const vm = vm_data.find((item) => item.id === id);
    if (vm === undefined) {
        res.status(404);
        res.json({code: 404, message: 'Not found VPN server ' + id});
        return;
    }

    //start or stop server
    try {
        if (body.target_state === 'START') {
            logger.info(`User ${req.payload.email} is starting VM ${vm.id}`);
            const offline_time = new Date(Date.now() + 4 * 60 * 60 * 1000);
            await vm.start(false, offline_time, {
                successCallBack: async () => {
                    const email_content = EmailHTMLTemplate.replace('%EMAIL_SUBJECT%', `${vm.country}(${vm.name}) VPN節點已啟動!`)
                        .replace('%USER_NAME%', req.payload.name ?? "")
                        .replace('%EMAIL_BODY%',
                            `<p style="margin: 0 0 20px 0;">
                                ${vm.country}(${vm.name}) VPN節點已啟動。節點會維持上線4小時, 4小時後如需要繼續使用請到 https://vpn.cocomine.cc/${vm.id} 重新啟動。
                            </p> 
                            <p style="margin: 0 0 20px 0;">
                                你亦可以在離線前一個小時延長開放時間, 避免服務中斷。
                            </p> 
                            <p style="margin: 0 0 20px 0;">
                            預計離線時間: ${offline_time.toLocaleString('zh-HK')}
                            </p>`)
                        .replace('%LINK%', `https://vpn.cocomine.cc/${vm.id}`);

                    //notify user by email when VM started
                    await email_notify(
                        req.payload.email,
                        `${vm.country}(${vm.name}) VPN節點已啟動!`,
                        email_content
                    );
                }
            });

            //record online time
            await RedisClient.set("opener:" + vm.id, req.payload.email + ":" + (req.payload.name ?? ""),
                {EX: 4 * 60 * 60});

        } else {
            logger.info(`User ${req.payload.email} is stopping VM ${vm.id}`);
            await vm.stop();
            await RedisClient.del("opener:" + vm.id);
            await discord_notify(`🔴 ${vm.country}(${vm.name}) VPN節點已手動關閉! \n\n若要繼續使用, 請重新啟動`);
        }

        //response
        res.json({
            code: 200,
            message: 'VPN server ' + id + ' ' + body.target_state + ' success',
            data: vm,
        });
        logger.warn('VPN server ' + id + ' ' + body.target_state + '! (by ' + req.payload.email + ')');
    } catch (e) {
        if (e instanceof ReadOnlyError) {
            res.status(460);
            res.json({code: 460, message: 'VPN server ' + id + ' is only allow ' + vm.readonly + '!', data: vm});
        } else if (e instanceof AlreadyStatusError) {
            res.status(461);
            res.json({code: 461, message: 'VPN server ' + id + ' is already ' + vm.status + '!', data: vm});
        } else {
            res.status(500);
            res.json({code: 500, message: 'Internal server error'});
            logger.error(e);
        }
    }
});

module.exports = router;