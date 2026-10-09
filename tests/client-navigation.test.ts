import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GatewayNavigation, type GatewayNavigationHost } from '../src/client-navigation.ts'

function fixture() {
  const values = new Map<string,string>()
  const ids = new Set<string>()
  const opened: string[] = [], created: string[] = [], prepared: string[] = []
  let controller = new AbortController()
  const known = { id: undefined as string | undefined }
  const host: GatewayNavigationHost = {
    async current() { return known.id },
    async exists(id) { return ids.has(id) },
    async create(id) { created.push(id); ids.add(id) },
    async prepare(id) { prepared.push(id) },
    open(id) { opened.push(id) },
    beginNavigation() { controller.abort(); controller = new AbortController(); return controller.signal },
  }
  const storage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value)}}
  const make = () => new GatewayNavigation(host,storage,'gateway',()=> 'fixed-gateway')
  return {host,make,ids,opened,created,prepared,values,known,cancel:()=>controller.abort()}
}

test('a new browser or device continues the main chat DSH already has',async()=>{
  const f=fixture()
  f.ids.add('existing-gateway'); f.known.id='existing-gateway'
  await f.make().open()
  assert.deepEqual(f.created,[])
  assert.deepEqual(f.opened,['existing-gateway'])
  assert.equal(f.values.get('gateway'),'existing-gateway')
  // A main chat that is gone from DSH is not reused.
  const g=fixture(); g.known.id='deleted-gateway'
  await g.make().open()
  assert.deepEqual(g.created,['fixed-gateway'])
})

test('main entry reuses its saved host session across client restarts',async()=>{
  const f=fixture()
  await f.make().open()
  await f.make().open()
  assert.deepEqual(f.created,['fixed-gateway'])
  assert.deepEqual(f.opened,['fixed-gateway','fixed-gateway'])
})

test('double click creates once and only the latest navigation opens',async()=>{
  const f=fixture(), nav=f.make()
  await Promise.all([nav.open(),nav.open()])
  assert.equal(f.created.length,1)
  assert.equal(f.opened.length,1)
})

test('switching away while creation runs does not pull the user back',async()=>{
  const f=fixture()
  let resume!:()=>void
  f.host.create=async id=>{await new Promise<void>(resolve=>{resume=resolve});f.ids.add(id)}
  const pending=f.make().open()
  await new Promise<void>(resolve=>setImmediate(resolve))
  f.cancel(); resume(); await pending
  assert.equal(f.opened.length,0)
})

test('ambiguous creation failure retries the reserved identity',async()=>{
  const f=fixture(), nav=f.make()
  f.host.create=async id=>{f.created.push(id);f.ids.add(id);throw new Error('response lost')}
  await assert.rejects(nav.open(),/response lost/)
  f.host.create=async()=>{assert.fail('must adopt the existing session')}
  await nav.open()
  assert.deepEqual(f.created,['fixed-gateway'])
  assert.deepEqual(f.opened,['fixed-gateway'])
})

test('model preparation failure never opens an ordinary provider as main chat',async()=>{
  const f=fixture(), nav=f.make()
  f.host.prepare=async()=>{throw new Error('model unavailable')}
  await assert.rejects(nav.open(),/model unavailable/)
  assert.equal(f.opened.length,0)
  f.host.prepare=async id=>{f.prepared.push(id)}
  await nav.open()
  assert.equal(f.created.length,1)
  assert.equal(f.opened.length,1)
})

test('host list failure preserves the old identity and does not create',async()=>{
  const f=fixture();f.values.set('gateway','existing-gateway')
  f.host.exists=async()=>{throw new Error('disconnected')}
  await assert.rejects(f.make().open(),/disconnected/)
  assert.equal(f.created.length,0)
  assert.equal(f.values.get('gateway'),'existing-gateway')
})

test('storage failure blocks creation instead of orphaning a new conversation',async()=>{
  const f=fixture()
  const nav=new GatewayNavigation(f.host,{getItem:()=>null,setItem:()=>{throw new Error('storage blocked')}},'key',()=> 'id')
  await assert.rejects(nav.open(),/storage blocked/)
  assert.equal(f.created.length,0)
})
