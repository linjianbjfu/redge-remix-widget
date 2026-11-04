/** Local cleanup acceptance only. Never imported by the production or maintenance entry. */
import '../backend/src/typebox-setup.ts';
import {DurableObject} from 'cloudflare:workers';
import app from '../backend/src/index.ts';
import {UserAgentDO as ApplicationDO,type Env} from '../backend/src/do/user-agent-do.ts';
export class UserAgentDO extends DurableObject<Env> {
  private application: ApplicationDO | undefined;
  private app() {return this.application??=new ApplicationDO(this.ctx,this.env);}
  override fetch(request:Request) {return this.app().fetch(request);}
  override async alarm(){await this.app().alarm();}
  async seed(kind:string) {
    const i=this.app();
    if(kind==='native')i.sqlForTest.exec("INSERT INTO sessions(id,purpose,created_at,updated_at) VALUES('native-session','widgee',1,1)");
    if(kind==='web')i.storeForTest.createSession('web-session');
    if(kind==='corrupt')i.sqlForTest.exec('DROP TABLE sessions');
    await this.ctx.storage.put('fixture-data','keep until deletion');
    await this.ctx.storage.setAlarm(Date.now()+3600000);
  }
  // Miniflare recreates its own name table when an instance is loaded; it is not application data.
  async state() {
    const names=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__miniflare_do_name'").toArray().map(r=>r.name);
    return {tables:names,kv:[...await this.ctx.storage.list()],alarm:await this.ctx.storage.getAlarm(),
      sessions:names.includes('sessions')?this.ctx.storage.sql.exec('SELECT id,purpose FROM sessions').toArray():null};
  }
}
export default {
  ...app,
  async fetch(request:Request,env:Env,ctx:ExecutionContext) {
    if(new URL(request.url).pathname==='/__fixture'){
      const {action,name,kind}=await request.json() as {action:string;name:string;kind:string};
      const id=env.AGENT.idFromName(name), stub=env.AGENT.get(id) as unknown as DurableObjectStub<UserAgentDO>;
      if(action==='seed')await stub.seed(kind);
      return Response.json(action==='state'?await stub.state():{id:id.toString()});
    }
    return app.fetch(request,env,ctx);
  },
};
