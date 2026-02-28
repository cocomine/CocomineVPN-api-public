import {Router as WSRouter} from "websocket-express";
import {vm_data, vm_data_last_update, vm_data_next_update} from "./VM_Data";
import {getLogger} from "log4js";

const router = new WSRouter();
const logger = getLogger('/vpn');

/*======= router ======*/
router.use('/v2/ws', require('./v2/ws'));
logger.info("Loaded /vpn/v2/ws");

router.use('/sub', require('./sub'));
logger.info("Loaded /vpn/sub");

/*======= Middleware '/vpn' ======*/
// verify cf token
const {verifyToken} = require("../auth_service");
router.use(verifyToken);

//verify token AUD
const {audVerify} = require("./audVerify");
router.use(audVerify);
logger.info("Loaded '/vpn' middleware");
/*======= End of middleware =======*/

//path: /vpn/:id
router.useHTTP('/', require('./(id)'))
logger.info("Loaded /vpn/:id");

//path: /vpn/track
router.useHTTP('/track', require('./track'))
logger.info("Loaded /vpn/track");

// get all VPN server status
// path: /vpn
router.get('/', async (req, res) => {
    res.json({
        code: 200,
        data: vm_data.map(v => v.toObject()),
        message: 'Get all VPN server success',
        last_update: vm_data_last_update,
        next_update: vm_data_next_update
    });
});

module.exports = router