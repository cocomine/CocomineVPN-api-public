import {discord_notify, email_notify} from "./Notify_service";
import RedisClient from "../redis_service";
import schedule from "node-schedule";
import {getLogger} from "log4js";
import VM from "./[VM_Class]/VM";
import Google_vm from "./[VM_Class]/Google_vm";
import {broadcastsMessage} from "./v2/ws/BroadcastsMessage";
import {Discord_VM_startup_banner_notify_job} from "./[VM_startup_banner]/Discord_VM_startup_banner_notify_job";
import {listAllInstances as GoogleListAllInstances} from "./[Cloud_Service]/google_service";
import {setTimeout as sleep} from 'timers/promises';
import path from "node:path";
import fs_sync from "node:fs";


const logger = getLogger('/vpn [VM_data]');
let vm_data: VM[] = [] // all VM data
const vm_data_last_update: Date = new Date(); // last update time VM data json
const vm_data_next_update: Date = new Date(); // next update time VM data json

//load email template
const filePath = path.join(__dirname, '[Email_notify]', 'email-template.html');
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

// schedule job to update VM status every 15 minute
const job = schedule.scheduleJob('*/15 * * * *', async () => {
    await get_vm_status();
    vm_data_last_update.setTime(Date.now());

    // set next update time
    const nextInvocation = job.nextInvocation();
    if (nextInvocation !== null) {
        vm_data_next_update.setTime(nextInvocation.getTime());
        logger.info('Update all VM status, next update at ' + nextInvocation.toLocaleString());
    }
});
job.invoke(); // invoke job immediately

/**
 * @description get all VM status
 */
async function get_vm_status() {
    let google_vm;
    try {
        google_vm = await GoogleListAllInstances();
        //azure_vm = await azure.listAllInstances();
    } catch (e) {
        logger.error(e);
        return;
    }
    const tmp: VM[] = [];

    // Sets up event listeners for a VM instance.
    function extracted(vm: VM) {
        // Adds an event listener for the 'onStatusChange' event on the VM instance.
        // When the status changes, it broadcasts a message with the updated VM status.
        vm.addEventListener('onStatusChange', async () => {
            await broadcastsMessage("/vpn/vm", vm);
        })

        // Adds an event listener for the 'onPowerChange' event on the VM instance.
        vm.addEventListener('onPowerChange', async (oldDate, newData) => {
            // is online
            if (newData) {
                // set expired time if not set before
                if(vm.expired === null){
                    vm.expired = new Date(Date.now() + 4 * 60 * 60 * 1000); // set expired time to 4 hours later
                }

                // Create a new instance of Discord_VM_startup_banner_notify_job with a message indicating the VPN node has started.
                const banner_notify = new Discord_VM_startup_banner_notify_job(
                    `🟢 ${vm.country}(${vm.name}) VPN節點已啟動! \n\n預計離線時間: ${vm.expired?.toLocaleString(
                        'zh-HK') ?? "N/A"}`);

                // If the VM's country is defined, set the banner properties with the VM's country, name, and estimated offline time.
                if (vm.country) {
                    banner_notify.setBannerProperty(`${vm.country} VPN node has been online!`,
                        vm.expired?.toLocaleString('en') ?? "N/A", vm.country);
                }

                // Send the banner notification.
                await banner_notify.send();
            }

            // is offline
            else {
                // auto restart VM if not expired
                if (vm.expired !== null && vm.expired.getTime() > Date.now()) {
                    try{
                        async function tmp(expired: Date, count = 0){
                            console.log(expired)
                            // limit to 5 attempts
                            if(count >= 5){
                                logger.error(`Failed to restart VM ${vm.id} after 5 attempts.`);
                                return;
                            }

                            // try to start VM
                            await vm.start(undefined, expired, {
                                failCallBack: async err => {
                                    await sleep(1000);
                                    logger.error(`Attempt ${count + 1} to restart VM ${vm.id} failed: ${err.message}`);
                                    await tmp(expired, count++)
                                }
                            })
                        }

                        await tmp(vm.expired)
                        await discord_notify(
                            `🟡 ${vm.country}(${vm.name}) VPN節點因資源緊張被強制釋放, 正在嘗試重新啟動...`);
                    } catch (e) {
                        logger.error(e);
                    }
                }
            }

            logger.warn(vm.id + ' is ' + (newData ? 'online' : 'offline!'))
            await broadcastsMessage("/vpn/vm", vm);
        })
    }

    // google
    for await (const {zone, data} of google_vm) {
        for await (const item of data) {
            if (item != undefined) {
                // check if VM is existed
                const perv = vm_data.find((vm) => vm.id === item.id);
                if (perv != undefined) {
                    await perv.updateStatus(); // update status

                    tmp.push(perv)
                    continue;
                }

                const vm = new Google_vm(item.status, item.id as string, zone);
                if(vm.isPowerOn) vm.expired = new Date(Date.now() + 4 * 60 * 60 * 1000); // set expired time to 4 hours later
                extracted(vm);
                tmp.push(vm)
            }
        }
    }

    // azure
    /*for await (const item of azure_vm) {
     // check if VM is existed
     const perv = vm_data.find((vm) => vm.id === item.name);
     if (perv != undefined) {
     await perv.updateStatus();

     tmp.push(perv)
     continue;
     }

     const status = await azure.getInstanceView(item.name as string);
     const displayStatus = (/.+\/(.+)/.exec(status.statuses?.find((item) => /PowerState\//.test(item.code || ''))?.code || '')?.[1]) ?? "deallocated";

     const vm = new Azure_vm(item.name as string, displayStatus as AzureVM_Status, item.name as string, item.location as string);
     extracted(vm);
     tmp.push(vm)
     }*/

    vm_data = tmp;
    await check_online_time();
}

/**
 * @description check online time and stop VM
 */
async function check_online_time() {
    for await (const vm of vm_data) {
        // check only power on VM
        if (vm.isPowerOn) {
            // stop VM if expired
            if (vm.expired !== null && vm.expired.getTime() < Date.now()) {
                await vm.stop(true).catch((e) => logger.error(e)); // stop VM without check readonly
                await discord_notify(
                    `🔴 ${vm.country}(${vm.name}) VPN節點連續開啟4個小時, 已自動關閉! \n\n若要繼續使用, 請重新啟動`); // discord webhook
            }

            // notify user by email 1 hour before VM is going to offline
            if (vm.expired !== null && vm.expired.getTime() - 60 * 60 * 1000 < Date.now()) {
                const opener = await RedisClient.get("opener:" + vm.id)
                if (opener !== null) {
                    const [email, name] = opener.split(":");

                    const email_content = EmailHTMLTemplate.replace('%EMAIL_SUBJECT%', `${vm.country}(${vm.name}) VPN節點即將關閉!`)
                        .replace('%USER_NAME%', name ?? "")
                        .replace('%EMAIL_BODY%',
                            `<p style="margin: 0 0 20px 0;">
                                ${vm.country}(${vm.name}) VPN節點即將一小時內關閉。如有需要請到 https://vpn.cocomine.cc/${vm.id} 延長開放時間。
                            </p> 
                            <p style="margin: 0 0 20px 0;">
                                預計離線時間: ${vm.expired.toLocaleString('zh-HK')}
                            </p>`)
                        .replace('%LINK%', `https://vpn.cocomine.cc/${vm.id}`);

                    //notify user
                    await email_notify(email, `${vm.country}(${vm.name}) VPN節點即將關閉!`, email_content);
                    await RedisClient.del("opener:" + vm.id);
                }
            }
        }
    }
}

export {vm_data, vm_data_last_update, vm_data_next_update};