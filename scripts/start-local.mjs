import { env,start,checkRuntime } from './local-runtime.mjs'

checkRuntime()
if (env.THEONE_ROUTER_MODE === 'llm' && !env.THEONE_ROUTER_API_KEY) throw new Error('请先在 .env 中填写 THEONE_ROUTER_API_KEY。')
start(['--profile','theone','--host','127.0.0.1','--port',process.env.THEONE_WEB_PORT || '3018','--no-open'])
