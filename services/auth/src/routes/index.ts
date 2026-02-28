import {Router} from 'express';
import {getLogger} from 'log4js';
import {verifyToken} from '../auth_service';

const router = Router();
const logger = getLogger('/auth');

/*=======router======*/
// path: /auth/odic/*
router.use('/odic', require('./odic'));
logger.info('Loaded /auth/odic');

//path: /auth/userinfo
router.get('/userinfo', verifyToken, async (req, res) => {
    res.json(req.payload);
});
logger.info("Loaded /auth/userinfo");

// path: /auth
router.get('/', verifyToken, (req: any, res) => {
    logger.info('User ' + req.payload.email + ' app login success!');
    res.status(200).json({code: 200, message: 'OK!'});
});

module.exports = router;
