import {Request, Response, Router} from "express";
import {getLogger} from "log4js";
import xss from "xss";
import path from "node:path";
import fs from "node:fs/promises";
import fs_sync from "node:fs";
import VM, {https_profile, openvpn_profile, softether_profile, ss_profile, vpnType} from "../../[VM_Class]/VM";
import * as stream from "stream";
import {vm_data} from "../../VM_Data";

/* ========= userCert type ======= */
interface baseCert {
    type: vpnType,
    vm_id: string,
}

interface openvpnCert extends baseCert {
    type: 'OpenVPN',
    cert: string,
    key: string
}

interface softetherCert extends baseCert {
    type: 'SoftEther',
    username: string,
    cert: string,
    key: string
}

interface httpsCert extends baseCert {
    type: 'https',
    username: string,
    password: string
}

interface ssCert extends baseCert {
    type: 'SS',
    password: string
}

interface singboxCert extends baseCert {
    type: 'sing-box',
}

type certType = openvpnCert | softetherCert | httpsCert | ssCert | singboxCert;

type userCert = {
    "email": string,
    "cert": certType[]
}[]
/* ================================ */

const router = Router();
const logger = getLogger('/vpn/:id/profile');

// Read userCert.json file
const filePath = path.join('config', 'userCert.json');
let userCert: userCert = JSON.parse(fs_sync.readFileSync(filePath, {
    encoding: 'utf-8',
    flag: 'r'
}));

// Watch for changes in the userCert.json file
fs_sync.watch(filePath, (eventType) => {
    if (eventType === 'change') {
        logger.info('userCert.json file changed, reloading...');
        // Reload the userCert data
        try {
            userCert = JSON.parse(fs_sync.readFileSync(filePath, {encoding: 'utf-8', flag: 'r'}));
            logger.info('userCert.json reloaded successfully');
        } catch (error) {
            logger.error('Error reloading userCert.json:', error);
        }
    }
});

const get_openvpn_setting = async (vm: VM, profile: openvpn_profile, req: Request, res: Response) => {

    //get user Cert
    const user = userCert.find((item) => item.email === req.payload.email);
    if (user === undefined || profile.filename === undefined) {
        res.status(404);
        res.json({code: 404, message: 'You Not on the list'});
        return null;
    }

    //get openvpn cert
    const openvpn_certs = user.cert.filter((item) => item.type === 'OpenVPN');
    if (openvpn_certs.length === 0) {
        res.status(404);
        res.json({code: 404, message: 'Profile cert Not found'});
        return null;
    }
    let openvpn_cert = openvpn_certs.find((item) => item.vm_id === vm.id);
    if (!openvpn_cert) openvpn_cert = openvpn_certs.find((item) => item.vm_id === ""); // default cert
    if (!openvpn_cert) {
        res.status(404).json({code: 404, message: 'User Profile cert Not Found'});
        return null;
    }

    //read file (openvpn)
    const profile_path = path.join(__dirname, profile.filename);
    const profile_file = await fs.readFile(profile_path, {encoding: 'utf-8', flag: 'r'});

    //replace variable
    const profile_file_replace = profile_file
        .replace(/%cert%/g, openvpn_cert.cert || '')
        .replace(/%key%/g, openvpn_cert.key || '');

    // to buffer
    const buffer = Buffer.from(profile_file_replace, 'utf-8');
    const readStream = new stream.PassThrough();
    readStream.end(buffer);

    //send to client
    res.set('Content-disposition', 'attachment; filename=' + encodeURI(`${vm.country}(${vm.name})_vpn[${req.payload.email}].ovpn`));
    res.set('Content-Type', 'application/octet-stream');

    logger.info('Send OpenVPN profile ' + vm.name + ' for ' + req.payload.email);
    readStream.pipe(res);
};

const get_softEther_setting = async (vm: VM, profile: softether_profile, req: Request, res: Response) => {

    //get user Cert
    const user = userCert.find((item) => item.email === req.payload.email);
    if (user === undefined || profile.filename === undefined) {
        res.status(404);
        res.json({code: 404, message: 'You Not on the list'});
        return null;
    }

    //get SoftEther cert
    const softEther_certs = user.cert.filter((item) => item.type === 'SoftEther');
    if (softEther_certs.length === 0) {
        res.status(404);
        res.json({code: 404, message: 'Profile cert Not found'});
        return null;
    }
    let softEther_cert = softEther_certs.find((item) => item.vm_id === vm.id);
    if (!softEther_cert) softEther_cert = softEther_certs.find((item) => item.vm_id === ""); // default cert
    if (!softEther_cert) {
        res.status(404).json({code: 404, message: 'User profile cert not found'});
        return null;
    }

    //read file (SoftEther)
    const profile_path = path.join(__dirname, profile.filename);
    const profile_file = await fs.readFile(profile_path, {encoding: 'utf-8', flag: 'r'});

    //replace variable
    const profile_file_replace = profile_file
        .replace(/%cert%/g, softEther_cert.cert || '')
        .replace(/%key%/g, softEther_cert.key || '')
        .replace(/%username%/g, softEther_cert.username || '')
        .replace(/%email%/g, req.payload.email || '');

    // to buffer
    const buffer = Buffer.from(profile_file_replace, 'utf-8');

    const readStream = new stream.PassThrough();
    readStream.end(buffer);

    //send to client
    res.set('Content-disposition', 'attachment; filename=' + encodeURI(`${vm.country}(${vm.name})_vpn[${req.payload.email}].vpn`));
    res.set('Content-Type', 'application/octet-stream');

    logger.info('Send SoftEther profile ' + vm.name + ' for ' + req.payload.email);
    readStream.pipe(res);
};

const get_https_setting = async (vm: VM, profile: https_profile, req: Request, res: Response) => {

    //get user Cert
    const user = userCert.find((item) => item.email === req.payload.email);
    if (user === undefined || profile.url === undefined) {
        res.status(404);
        res.json({code: 404, message: 'You Not on the list'});
        return null;
    }

    //get https setting
    const https_settings = user.cert.filter((item) => item.type === 'https');
    if (https_settings.length === 0) {
        res.status(404);
        res.json({code: 404, message: 'Profile cert Not found'});
        return null;
    }
    let https_setting = https_settings.find((item) => item.vm_id === vm.id);
    if (!https_setting) https_setting = https_settings.find((item) => item.vm_id === ""); // default cert
    if (!https_setting) {
        res.status(404).json({code: 404, message: 'User Profile cert Not Found'});
        return null;
    }

    //send to client
    res.json({
        code: 200,
        data: {
            username: https_setting.username,
            password: https_setting.password,
        }
    });
    logger.info('Send https setting ' + vm.name + ' for ' + req.payload.email);
};

const get_ss_setting = async (vm: VM, profile: ss_profile, req: Request, res: Response) => {

    //get user Cert
    const user = userCert.find((item) => item.email === req.payload.email);
    if (user === undefined || profile.url === undefined) {
        res.status(404);
        res.json({code: 404, message: 'You Not on the list'});
        return null;
    }

    //get SS setting
    const ss_settings = user.cert.filter((item) => item.type === 'SS');
    if (ss_settings.length === 0) {
        res.status(404);
        res.json({code: 404, message: 'Profile cert Not found'});
        return null;
    }
    let ss_setting = ss_settings.find((item) => item.vm_id === vm.id);
    if (!ss_setting) ss_setting = ss_settings.find((item) => item.vm_id === ""); // default cert
    if (!ss_setting) {
        res.status(404).json({code: 404, message: 'User Profile cert Not Found'});
        return null;
    }

    //send to client
    res.json({
        code: 200,
        data: {
            url: profile.url,
            method: profile.method,
            password: ss_setting.password,
        }
    });
    logger.info('Send ss setting ' + vm.name + ' for ' + req.payload.email);
};

/*======= router ======*/
//get VPN setting profileType
router.get('/:id/profile', async (req, res) => {
    const id = xss(req.params['id']);

    //check id format
    if (!/^[0-9]+$/.test(id)) {
        res.status(400);
        res.json({code: 400, message: 'VPN server ID format error'});
        return;
    }

    const vm = vm_data.find((item) => item.id === id);
    let type = req.query['type'];
    type = typeof type === 'string' ? xss(type) : undefined; //sanitize input

    //is server exist?
    if (vm === undefined) {
        res.status(404);
        res.json({code: 404, message: 'Not found VPN server ' + id});
        return;
    }

    //check input
    if (type === undefined) {
        res.status(400);
        res.json({code: 400, message: 'Missing query parameter'});
        return;
    }

    //is profileType exist?
    const profile = vm.profiles.find((item) => item.type === type);
    if (profile === undefined) {
        res.status(404);
        res.json({code: 404, message: 'Not found VPN profile ' + type});
        return;
    }

    //get profileType
    switch (profile.type) {
        case "OpenVPN":
            await get_openvpn_setting(vm, profile, req, res);
            break;
        case "SoftEther":
            await get_softEther_setting(vm, profile, req, res);
            break;
        case "https":
            await get_https_setting(vm, profile, req, res);
            break;
        case "SS":
            await get_ss_setting(vm, profile, req, res);
            break;
        case "sing-box":
            res.status(400);
            res.json({
                code: 400,
                message: 'sing-box profile not supported yet. Please use sing-box subscription link instead.'
            });
            break;
        default:
            res.status(404);
            res.json({
                code: 404,
                message: 'Unsupported VPN profileType.'
            });
            break;
    }
});

module.exports = router;