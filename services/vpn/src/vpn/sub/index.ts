import {Router} from "express";
import {getLogger} from "log4js";
import redis_service from "../../redis_service";
import {generateSecureTokenBase64, verifyToken} from "../../auth_service";
import path from "node:path";
import fs_sync from "fs";
import template from './singbox-template.json';
import xss from "xss";
import SqlPool from "../../sql_service";
import {audVerify} from "../audVerify";

export type singboxOutboundSelectorType = {
    tag: string,
    type: "selector",
    outbounds: any[],
}

export type singboxOutboundUrltestType = {
    tag: string,
    type: "urltest",
    outbounds: any[],
    [key: string]: any,
}

export type singboxConfigOutboundsType = [singboxOutboundSelectorType, singboxOutboundUrltestType, ...any[]]

export type singboxConfigType = {
    inbounds: object[],
    outbounds: singboxConfigOutboundsType,
    route: object,
}

export type singboxCertType = {
    email: string,
    outbounds: {
        tag: string
        [key: string]: any
    }[],
}

const router = Router();
const logger = getLogger('/vpn/sub');

// read sing-box subscription configuration
// Read singbox-cert.json file
const filePath = path.join('config', 'singbox-cert.json');
let singboxCert: singboxCertType[] = JSON.parse(fs_sync.readFileSync(filePath, {
    encoding: 'utf-8',
    flag: 'r'
}));

// Watch for changes in the userCert.json file
fs_sync.watch(filePath, (eventType) => {
    if (eventType === 'change') {
        logger.info('singbox-cert.json file changed, reloading...');
        // Reload the userCert data
        try {
            singboxCert = JSON.parse(fs_sync.readFileSync(filePath, {encoding: 'utf-8', flag: 'r'}));
            logger.info('singbox-cert.json reloaded successfully');
        } catch (error) {
            logger.error('Error reloading singbox-cert.json:', error);
        }
    }
});

// On server startup, restore singbox tokens from SQL to Redis
(async function restoreTokensFromSql() {
    try {
        const [rows] = await SqlPool.query<any[]>('SELECT email, token, updated_at FROM singbox_tokens');
        if (Array.isArray(rows) && rows.length > 0) {
            logger.info(`Found ${rows.length} sub tokens in SQL, restoring to Redis...`);
            for (const row of rows) {
                const {email, token, updated_at} = row;
                if (email && token) {
                    // 计算 Token 的年龄，单位为天
                    const updatedAt = new Date(updated_at);
                    const now = new Date();
                    const ageInDays = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24); //(当前时间 - 更新日期) 转换为天数

                    // 如果 Token 已经过期（超过 90 天），则不恢复
                    if (ageInDays >= 90) {
                        logger.warn(`Token for ${email} is older than 90 days (created at ${updated_at}), skipping restoration.`);
                        continue; // Skip tokens older than 90 days
                    }
                    // 恢复: Token -> Email (设置 TTL 以便过期)
                    // 通过“90 天的总秒数 - 已经过去的秒数”计算剩余的有效时间（秒）
                    await redis_service.set(`sub:token:${token}`, email, {EX: Math.ceil((60 * 60 * 24 * 30 * 3) - ((now.getTime() - updatedAt.getTime()) / 1000))});
                    // 恢复: Email -> Token
                    await redis_service.hSet('sub:user_tokens', email, token);
                }
            }
            logger.info('Sub tokens restoration complete.');
        }
    } catch (error: any) {
        logger.error(`Failed to restore tokens from SQL. The 'singbox_tokens' table might be missing or the query failed.`);
        logger.error(error);
    }
})();

/*======= router ======*/
// sing-box subscription
// path: /vpn/sub/:token/singbox
router.get('/:token/singbox', async (req, res) => {
    const token = xss(req.params.token);

    if (!/^[a-zA-Z0-9\-_]{32,}$/.test(token)) {
        res.type('text/plain');
        return res.status(403).send('Invalid token format.');
    }

    // 1. 从 Redis 通过 Token 查找对应的用户 Email
    // 假设我们在 Redis 中存储的 Key 格式为 "sub:token:<token_value>"
    const email = await redis_service.get(`sub:token:${token}`);

    if (!email) {
        res.type('text/plain');
        res.status(400).send("Invalid or expired subscription token.");
        return;
    }

    logger.info(`Sing-box Subscription accessed by ${email}`);

    // 2. 只有查找到用户，才生成具体的 sing-box 配置 JSON
    const userCert = singboxCert.find((item) => item.email === email);
    if (!userCert) {
        res.status(404).send("User certificate not found.");
        return;
    }

    // generate sing-box json based on email/user rights
    const outbounds: singboxConfigOutboundsType = JSON.parse(JSON.stringify(template.outbounds)); // Deep copy the template
    outbounds.push(...userCert.outbounds);
    const urltestOutbound = outbounds.find(item => item.type === 'urltest');
    const selectorOutbound = outbounds.find(item => item.type === 'selector');

    if (!urltestOutbound || !selectorOutbound) {
        logger.error("Required 'urltest' or 'selector' outbound not found in template configuration.");
        res.status(500).send("Server configuration error.");
        return;
    }

    urltestOutbound.outbounds = userCert.outbounds.map(item => item.tag);
    selectorOutbound.outbounds.push(...userCert.outbounds.map(item => item.tag));
    res.json({...template, outbounds: outbounds});
});

// normal subscription
// path: /vpn/sub/:token
router.get('/:token', async (req, res) => {
    const token = xss(req.params.token);
    res.type('text/plain');

    if (!/^[a-zA-Z0-9\-_]{32,}$/.test(token)) {
        return res.status(403).send('Invalid token format.');
    }

    // 1. 从 Redis 通过 Token 查找对应的用户 Email
    // 假设我们在 Redis 中存储的 Key 格式为 "sub:token:<token_value>"
    const email = await redis_service.get(`sub:token:${token}`);
    if (!email) {
        res.status(400).send("Invalid or expired subscription token.");
        return;
    }

    // 2. 只有查找到用户，才生成具体的 sing-box 配置 JSON
    const userCert = singboxCert.find((item) => item.email === email);
    if (!userCert) {
        res.status(404).send("User certificate not found.");
        return;
    }

    logger.info(`Subscription accessed by ${email}`);

    const urls: string[] = [];
    for (let outbound of userCert.outbounds) {
        const url = new URL(`${outbound.type}://${outbound.uuid}@${outbound.server}:${outbound.server_port}`);
        url.searchParams.set('type', 'tcp');
        url.searchParams.set('flow', outbound.flow);
        url.hash = outbound.tag;
        if (outbound.tls && outbound.tls.enabled) {
            if (outbound.tls.reality) {
                url.searchParams.set('security', 'reality');
                url.searchParams.set('pbk', outbound.tls.reality.public_key);
                url.searchParams.set('sid', outbound.tls.reality.short_id);
                url.searchParams.set('fp', outbound.tls.utls.fingerprint);
                url.searchParams.set('sni', outbound.tls.server_name);
            } else {
                url.searchParams.set('security', 'tls');
            }
        }
        urls.push(url.toString());
    }

    res.send(urls.join('\n'));
});

router.use(verifyToken);

router.use(audVerify);
logger.info("Loaded '/vpn/sub' middleware");
/*======= End of middleware =======*/

// check subscription token is generated
// path: /vpn/sub
router.get('/', async (req, res) => {
    const token = await redis_service.hGet('sub:user_tokens', req.payload.email);

    if (!token) {
        res.status(204).send(); // No Content
        return;
    }

    if ((await redis_service.exists(`sub:token:${token}`)) <= 0) {
        res.status(204).send(); // No Content
        return;
    }

    res.status(200).json({
        code: 200,
        message: "Token already exists",
        data: {token: token}
    });
});

// subscription token generation
// path: /vpn/sub
router.post('/', async (req, res) => {
    const email = req.payload.email;

    try {
        // 1. 检查是否存在旧 Token，为了安全，应该删除旧 Token 的反向映射
        const oldToken = await redis_service.hGet('sub:user_tokens', email);
        if (oldToken) {
            await redis_service.del(`sub:token:${oldToken}`);
        }

        // 2. 生成新 Token
        const newToken = generateSecureTokenBase64(64);

        // 3. 存储双向映射
        // 映射 A: Token -> Email (用于 GET /:token 快速查找用户)
        // 可以设置过期时间，90 days
        await redis_service.set(`sub:token:${newToken}`, email, {EX: 60 * 60 * 24 * 30 * 3});

        // 映射 B: Email -> Token (用于界面显示用户当前的 Token)
        await redis_service.hSet('sub:user_tokens', email, newToken);

        // 存储到 SQL 数据库
        const connection = await SqlPool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(
                'INSERT INTO singbox_tokens (email, token) VALUES (?, ?) ON DUPLICATE KEY UPDATE token = ?, updated_at = NOW()',
                [email, newToken, newToken]
            );
            await connection.commit();
        } catch (e: any) {
            await connection.rollback();
            logger.error(e);
        } finally {
            connection.release();
        }

        logger.info(`Generated new sing-box token for user ${email}`);
        res.status(201).json({
            code: 201,
            message: 'Token created',
            data: {token: newToken}
        });
    } catch (e) {
        logger.error(e);
        res.status(500).json({code: 500, message: 'Internal Server Error'});
    }
});


module.exports = router;