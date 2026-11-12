import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { StudioWorkflow, validateMembers } from './studio.mjs';
import { StudioAuth, makePassword } from './studio-auth.mjs';
import { ModelPlanner, PayPalSandbox } from './adapters.mjs';
import { previewPlanner, previewTopics, previewPayPal } from './preview.mjs';
import { publicError, AppError } from './errors.mjs';

const mutationRoutes = new Set(['/plan','/correct','/revise','/discard','/approve','/reconcile','/remote/review','/remote/apply','/remote/reconcile','/remote/status']);
export const studioTopics = previewTopics.map(topic => topic.id === 'budget'
  ? { ...topic, title: 'Studio expenses', summary: 'Shared studio expense notes; no customer invoices' }
  : { ...topic });
export function createStudioApp({ members, topics, planner, paypal, databaseDirectory = ':memory:', studio = {id:'theone-studio',name:'The One Studio'},
  capabilities = {model:true,paypal:true}, preview = false, html }) {
  const normalized = validateMembers(members,topics);
  const auth = new StudioAuth(normalized);
  const workflow = new StudioWorkflow({members:normalized,topics,planner,paypal,databaseDirectory,studio});
  // html is injectable for isolated HTTP authorization tests. Production always
  // serves the same checked-in studio UI, never a secret-bearing template.
  const source = html ?? readFileSync(new URL('./studio.html',import.meta.url),'utf8');
  const server = createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    const nonce=randomBytes(24).toString('hex');
    res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const respond=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    const fail=error=>{const result=publicError(error);respond(result.status,result.body);};
    const port=server.address()?.port;
    const allowed=[`127.0.0.1:${port}`,`localhost:${port}`];
    if(!allowed.includes(req.headers.host)||req.headers.origin&&!allowed.map(h=>`http://${h}`).includes(req.headers.origin)) {
      respond(403,{code:'FOREIGN_ORIGIN',error:'Foreign Host or Origin denied'});return;
    }
    try {
      if(req.method==='GET'&&req.url==='/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(source.replaceAll('__TOKEN__',nonce));return;}
      if(!['GET','POST'].includes(req.method)) {respond(405,{code:'METHOD_NOT_ALLOWED',error:'Unsupported method'});return;}
      let session=auth.session(req,res);
      const sessionView=()=>({actor:session.actorId?workflow.actor(session.actorId):null,csrf:session.csrf,studio:workflow.studio,preview});
      if(req.method==='GET'&&req.url==='/session') {respond(200,sessionView());return;}
      if(!['/login','/logout'].includes(req.url))auth.requireActor(session);
      auth.checkCsrf(req,session);
      if(req.method==='GET') {
        const actorId=auth.requireActor(session);
        if(req.url==='/state'){respond(200,workflow.state(actorId,{capabilities,preview}));return;}
        if(req.url==='/routing/metrics'){respond(200,workflow.routingMetrics(actorId));return;}
        if(req.url==='/routing/attempts'){respond(200,workflow.attempts(actorId));return;}
        const inspection=/^\/proposals\/([a-f0-9-]{36})\/(review|history)$/.exec(req.url);
        if(inspection){respond(200,inspection[2]==='review'?workflow.review(actorId,inspection[1]):workflow.history(actorId,inspection[1]));return;}
        const brief=/^\/projects\/([a-z0-9_-]{1,40})\/brief$/.exec(req.url);
        if(brief){respond(200,workflow.brief(actorId,brief[1]));return;}
        respond(404,{code:'NOT_FOUND',error:'Unknown route'});return;
      }
      if(req.headers['content-type']!=='application/json'){respond(415,{code:'JSON_REQUIRED',error:'JSON required'});return;}
      const chunks=[];let length=0;
      for await(const chunk of req){length+=chunk.length;if(length>12_000){respond(413,{code:'REQUEST_TOO_LARGE',error:'Request too large'});req.resume();return;}chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID_REQUEST','A JSON object is required.',400);
      if(req.url==='/login'){session=auth.login(req,res,session,data);respond(200,sessionView());return;}
      if(req.url==='/logout'){session=auth.logout(res,session);respond(200,sessionView());return;}
      const actorId=auth.requireActor(session);
      if(!mutationRoutes.has(req.url)){respond(404,{code:'NOT_FOUND',error:'Unknown route'});return;}
      // Identity and role are exclusively session-owned. Reject tempting client
      // identity fields instead of silently giving a caller the wrong impression.
      if(['actor','actor_id','owner_id','member_id','role','studio_id','workspace_id'].some(key=>key in data))throw new AppError('IDENTITY_IS_SERVER_OWNED','Member identity and role come from your signed-in session.',400);
      if(req.url==='/plan'&&!capabilities.model)throw new AppError('NOT_CONFIGURED','Configure the model API before proposing.',503);
      if((['/approve','/reconcile'].includes(req.url)||req.url.startsWith('/remote/'))&&!capabilities.paypal)throw new AppError('NOT_CONFIGURED','Configure PayPal Sandbox before creating or checking drafts.',503);
      let result;
      if(req.url==='/plan')result=await workflow.plan(actorId,data.message,data.request_id);
      else if(req.url==='/correct')result=workflow.correct(actorId,data.id,data.revision,data.topic_id);
      else if(req.url==='/revise')result=workflow.revise(actorId,data.id,data.revision,data.changes);
      else if(req.url==='/discard')result=workflow.discard(actorId,data.id,data.revision,data.acknowledge_remote_unknown);
      else if(req.url==='/approve')result=await workflow.approve(actorId,data.id,data.digest);
      else if(req.url==='/reconcile')result=await workflow.reconcile(actorId,data.id);
      else if(req.url==='/remote/review')result=workflow.reviewRemote(actorId,data.id,data.revision,data.action,data.changes);
      else if(req.url==='/remote/apply')result=await workflow.applyRemote(actorId,data.id,data.revision,data.action,data.changes,data.digest);
      else if(req.url==='/remote/reconcile')result=await workflow.reconcileRemote(actorId,data.id);
      else result=await workflow.refreshRemote(actorId,data.id);
      respond(200,result);
    }catch(error){fail(error);}
  });
  server.requestTimeout=50_000;
  server.on('close',()=>{auth.close();workflow.close();});
  return server;
}

// Adapt only the deliberately scripted preview to a member's catalog. The live
// model already receives the authorized catalog and never falls back to scripts.
export const studioPreviewPlanner={
  async route(message,topics,context){
    const result=await previewPlanner.route(message.replace(/\bstudio expenses\b/gi,'budget'),topics,context),decision=result.decision;
    const allowed=new Set(topics.map(t=>t.id));
    if(decision.action==='CLARIFY')return {...result,decision:{...decision,candidateIds:(decision.candidateIds??[]).filter(id=>allowed.has(id)),relatedIds:[]}};
    if(decision.action==='CREATE')return result;
    if(!allowed.has(decision.contextId))return {...result,decision:{action:'CLARIFY',contextId:null,candidateIds:topics.filter(t=>t.invoice_enabled!==false).map(t=>t.id),relatedIds:[],question:'Which available project do you mean?',reason:'The requested project is not in this member catalog.'}};
    return {...result,decision:{...decision,
      ...(decision.contextId==='budget'?{reason:`Expense notes belong to ${topics.find(t=>t.id==='budget').title}.`}:{}),
      relatedIds:(decision.relatedIds??[]).filter(id=>allowed.has(id))}};
  },
  plan:previewPlanner.plan.bind(previewPlanner),
};

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const env=process.env,configPath=resolve(env.THEONE_STUDIO_CONFIG||'.data/studio-config.private.json');
  if(process.argv.includes('--init')) {
    if(existsSync(configPath))throw Error('Studio configuration already exists; it was not overwritten.');
    const definitions=[{id:'alex',name:'Alex',role:'finance',project_ids:['design','move','budget']},
      {id:'mia',name:'Mia',role:'member',project_ids:['design','budget']},
      {id:'leo',name:'Leo',role:'member',project_ids:['move','budget']}];
    const credentials=definitions.map(member=>({...member,password:randomBytes(18).toString('base64url')}));
    const members=credentials.map(({password,...member})=>({...member,...makePassword(password)}));
    mkdirSync(dirname(configPath),{recursive:true,mode:0o700});
    writeFileSync(configPath,JSON.stringify({studio:{id:'theone-studio',name:'The One Studio'},members},null,2)+'\n',{mode:0o600,flag:'wx'});
    console.log(`Created ${configPath}. Keep these one-time displayed passwords private; only salted hashes were saved.`);
    for(const {name,password} of credentials)console.log(`${name}: ${password}`);
  }else {
    if(!existsSync(configPath))throw Error('Run npm run studio:init first to create local studio accounts.');
    const config=JSON.parse(readFileSync(configPath,'utf8')),preview=process.argv.includes('--preview');
    const missing={async route(){throw Error('Model API is not configured');},async plan(){throw Error('Model API is not configured');},async createDraft(){throw Error('PayPal Sandbox is not configured');}};
    const hasModel=Boolean(env.MODEL_API_KEY&&env.MODEL_BASE_URL&&env.MODEL_NAME),hasPayPal=Boolean(env.PAYPAL_SANDBOX_CLIENT_ID&&env.PAYPAL_SANDBOX_CLIENT_SECRET);
    const planner=preview?studioPreviewPlanner:hasModel?()=>new ModelPlanner({baseUrl:env.MODEL_BASE_URL,apiKey:env.MODEL_API_KEY,model:env.MODEL_NAME,
      disableThinking:env.MODEL_DISABLE_THINKING==='true',reasoningStyle:env.MODEL_REASONING_STYLE||'none'}):missing;
    const paypal=preview?previewPayPal():hasPayPal?new PayPalSandbox({clientId:env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:env.PAYPAL_SANDBOX_CLIENT_SECRET}):missing;
    const topics=env.THEONE_TOPICS_FILE?JSON.parse(readFileSync(env.THEONE_TOPICS_FILE,'utf8')):studioTopics.map(t=>({...t,recipient:preview?t.recipient:env.SANDBOX_RECIPIENT||t.recipient}));
    const app=createStudioApp({members:config.members,studio:config.studio,topics,planner,paypal,preview,
      databaseDirectory:resolve(env.THEONE_STUDIO_DATA||(preview?'.data/studio-preview':'.data/studio-live')),
      capabilities:{model:preview||hasModel,paypal:preview||hasPayPal}});
    const port=Number(env.PORT||3074);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid studio port');
    app.listen(port,'127.0.0.1',()=>console.log(`The One Studio: http://127.0.0.1:${port} — ${preview?'simulated providers, real member sessions':'PayPal Sandbox only'}; local single-workspace prototype`));
  }
}
