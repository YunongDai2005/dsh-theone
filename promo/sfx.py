import json, numpy as np, scipy.signal as sg, scipy.io.wavfile as wf
SR=44100; rnd=np.random.default_rng(7)
cues=json.load(open('cues.json')); meta=json.load(open('meta.json')); TOTAL=meta['total']
N=int((TOTAL+3)*SR); L=np.zeros(N); R=np.zeros(N)
T=lambda n: np.arange(n)/SR
def env(n,a,d): t=T(n); return np.minimum(1,t/max(a,1e-5))*np.exp(-t/d)
def bp(x,lo,hi,o=2): b,a=sg.butter(o,[lo/(SR/2),min(hi,SR/2-100)/(SR/2)],'band'); return sg.lfilter(b,a,x)
def hp(x,f,o=2): b,a=sg.butter(o,f/(SR/2),'high'); return sg.lfilter(b,a,x)
def lp(x,f,o=2): b,a=sg.butter(o,f/(SR/2),'low'); return sg.lfilter(b,a,x)
def osc(f,n,kind='sin'):
    ph=2*np.pi*np.cumsum(np.broadcast_to(np.asarray(f,float),(n,)))/SR
    return np.sin(ph) if kind=='sin' else 2*((ph/(2*np.pi))%1)-1
def mkir(sec,dec,seed):
    r=np.random.default_rng(seed); n=int(sec*SR); x=r.standard_normal(n)*np.exp(-T(n)/dec); x=lp(x,7000); return x/np.sqrt((x**2).sum())
IRL,IRR=mkir(3,.9,1),mkir(3,.9,2)
def put(t,x,g=1.,pan=0.,wet=0.):
    i=int(round(t*SR)); x=np.asarray(x)*g
    if wet>0:
        yl=sg.fftconvolve(x,IRL)*wet*2.2; yr=sg.fftconvolve(x,IRR)*wet*2.2
        add(i,x*(1-pan)**.5*.75,x*(1+pan)**.5*.75); add(i,yl,yr)
    else: add(i,x*(1-pan)**.5*.75,x*(1+pan)**.5*.75)
def add(i,a,b):
    if i<0: a=a[-i:]; b=b[-i:]; i=0
    n=min(len(a),N-i); L[i:i+n]+=a[:n]; R[i:i+n]+=b[:n]
def clack(heavy=1.):
    n=int(.03*SR)
    return (bp(rnd.standard_normal(n),2200,9000)*env(n,.0002,.0012)*.9
            +osc(1200+rnd.random()*1100,n)*env(n,.0001,.004)*.35
            +osc(280+rnd.random()*90,n)*env(n,.0008,.009)*.35*heavy)
def flap():  # split-flap rattle settling on its card
    k=rnd.integers(4,8); out=np.zeros(int(.18*SR)); tt=0
    for j in range(k):
        c=clack(.6+.4*(j==k-1))*(.45+.55*(j/(k-1))**.5)*(1.25 if j==k-1 else 1)
        i=int(tt*SR); out[i:i+len(c)]+=c[:len(out)-i]; tt+=.009+.006*rnd.random()+.002*j
    return out
def click():
    n=int(.02*SR)
    a=hp(rnd.standard_normal(n),3000)*env(n,.0002,.001)*.8+osc(4300,n)*env(n,.0001,.0022)*.35+osc(150,n)*env(n,.001,.012)*.4
    y=np.zeros(int(.12*SR)); y[:n]+=a; j=int(.068*SR); y[j:j+n]+=a*.45; return y
def noise_sweep(dur,f0,f1,shape,q=1.6,seed=0):
    r=np.random.default_rng(seed); n=int(dur*SR); x=r.standard_normal(n); out=np.zeros(n); blk=256; zi=None
    for i in range(0,n,blk):
        u=i/n; fc=f0*(f1/f0)**u; b,a=sg.butter(2,[max(20,fc/q)/(SR/2),min(fc*q,20000)/(SR/2)],'band')
        if zi is None: zi=np.zeros(max(len(a),len(b))-1)
        out[i:i+blk],zi=sg.lfilter(b,a,x[i:i+blk],zi=zi)
    return out*shape(np.linspace(0,1,n))
def whoosh(dur):
    a=noise_sweep(dur,180,3800,lambda u:np.sin(np.pi*np.clip(u/0.75,0,1)**.8)**2*(1-0.4*u),2.0,3)*2.4
    b=lp(np.random.default_rng(4).standard_normal(int(dur*SR)),120)*np.sin(np.pi*np.linspace(0,1,int(dur*SR)))**2*4
    return a+b
def swish(d=.3,f0=900,f1=6000): return noise_sweep(d,f0,f1,lambda u:np.sin(np.pi*u)**2,1.7,5)*1.6
def thump(f0=120,f1=55,d=.35,g=1.):
    n=int(d*SR); return osc(np.linspace(f0,f1,n),n)*env(n,.001,d/4)*g
def pad(dur):
    n=int(dur*SR); t=T(n); out=np.zeros(n)
    for f,g in [(65.41,.5),(130.81,.6),(196.0,.45),(261.63,.4),(329.63,.32),(392.0,.28),(493.88,.2),(587.33,.16),(783.99,.08)]:
        for c in (-6,0,6):
            out+=osc(f*2**(c/1200)*(1+.002*np.sin(2*np.pi*.3*t+f)),n)*g
    saw=sum(osc(f*2**(c/1200),n,'saw') for f in (130.81,196.0,261.63,329.63) for c in (-8,8)); out+=lp(saw,900)*.08
    e=np.minimum(1,t/1.6)**2*(.6+.4*np.minimum(1,t/dur)**2); e*=np.minimum(1,(n-np.arange(n))/(.04*SR))
    out=out*e/np.max(np.abs(out*e))
    sh=np.zeros(n)
    for k in range(14):
        f=[1046.5,1318.5,1568,1975.5,2349.3][k%5]; m=int(1.3*SR); b=osc(f,m)*env(m,.002,.35)*.12
        j=int((.9+k*(dur-1.4)/14)*SR); sh[j:j+m]+=b[:n-j]
    return out*.55+sh
def swell(dur):
    n=int(dur*SR); u=np.linspace(0,1,n); x=hp(np.random.default_rng(8).standard_normal(n),2500)*u**3.2
    x+=noise_sweep(dur,400,9000,lambda u:u**2.5,1.5,9)*.8; x[-int(.01*SR):]*=np.linspace(1,0,int(.01*SR)); return x*1.2
def impact():
    n=int(1.6*SR); return osc(np.linspace(62,38,n),n)*env(n,.002,.45)*1.0+lp(np.random.default_rng(10).standard_normal(n),1500)*env(n,.001,.08)*.5
def layer():
    n=int(.7*SR); x=osc(np.linspace(150,72,n),n)*env(n,.001,.09)*.9
    for f,g,d in [(1730,.12,.18),(2930,.08,.12),(4410,.05,.08)]: x+=osc(f,n)*env(n,.0005,d)*g
    return x+bp(np.random.default_rng(11).standard_normal(n),800,5000)*env(n,.0005,.01)*.4
NOTE={'C5':523.25,'E5':659.25,'G5':783.99,'A5':880,'C6':1046.5,'E6':1318.5,'G6':1568}
def bell(f,d=.8,a=.4):
    n=int(d*SR); return sum(w*osc(f*m,n)*env(n,.001,d*k) for m,w,k in [(1,1,.4),(2,.3,.22),(3.01,.15,.12),(4.17,.08,.08)])*a
def route(n='G5'):
    m=int(.5*SR); f=NOTE[n]*np.r_[np.linspace(.94,1,int(.025*SR)),np.ones(m-int(.025*SR))]; return osc(f,m)*env(m,.002,.12)*.6+np.pad(bell(NOTE[n]*2,.4,.12),(0,m-int(.4*SR)))
def sparkle(notes=('C6','E6','G6','C6'),gap=.055):
    out=np.zeros(int(1.4*SR))
    for i,nn in enumerate(notes):
        b=bell(NOTE[nn],.8,.22); j=int(i*gap*SR); out[j:j+len(b)]+=b[:len(out)-j]
    return out
def typing():
    out=np.zeros(int(.4*SR))
    for j in range(5):
        n=int(.012*SR); c=hp(rnd.standard_normal(n),2500)*env(n,.0002,.0016)*.5+osc(180,n)*env(n,.001,.004)*.2; i=int((j*.055+rnd.random()*.015)*SR); out[i:i+n]+=c
    return out
def snap():
    n=int(.12*SR); return hp(rnd.standard_normal(n),1500)*env(n,.0002,.003)*.9+osc(np.linspace(220,90,n),n)*env(n,.001,.03)*.8

GAIN={'flap':.55,'folder':.6,'click':.55,'whoosh':.55,'settle':.35,'pad':.55,'swell':.35,'impact':.8,'layer':.55,'type':.35,'route':.45,'hit':.5,'create':.45,'rise':.3,'snap':.5,'end':.45}
for c in cues:
    t=c['t']; ty=c['type']; g=GAIN.get(ty,.4)*c.get('g',1)
    if ty=='flap': put(t-.04,flap(),g,rnd.uniform(-.35,.35),.08)
    elif ty=='folder': put(t-.04,flap(),g); put(t,swish(.25,600,3000)*.5,g,0,.1)
    elif ty=='click': put(t,click(),g)
    elif ty=='whoosh': put(t,whoosh(c['dur']),g,0,.12)
    elif ty=='settle': put(t,thump(90,50,.4),g,0,.2)
    elif ty=='pad': put(t,pad(c['dur']),g,0,.35)
    elif ty=='swell': put(t,swell(c['dur']),g)
    elif ty=='impact': put(t,impact(),g,0,.25)
    elif ty=='layer': put(t,layer(),g,0,.25)
    elif ty=='type': put(t,typing(),g)
    elif ty=='route': put(t,route(c.get('n','G5')),g,0,.3)
    elif ty=='hit': put(t,route(c.get('n','C6')),g,0,.3); put(t,sparkle(('E6','G6'),.04)*.5,g,0,.3)
    elif ty=='create': put(t,sparkle(),g,0,.35)
    elif ty=='rise': put(t-.5,swish(.6,300,5000),g,0,.2)
    elif ty=='snap': put(t,snap(),g,0,.15)
    elif ty=='end': put(t,thump(90,45,.6,.8),g,0,.4); put(t,sparkle(('C6','G6','E6'),.07)*.6,g,0,.4)
sfx=np.stack([L,R],1)[:int(TOTAL*SR)]; sfx*=0.78/max(1,np.abs(sfx).max())
wf.write('sfx.wav',SR,(np.clip(sfx,-1,1)*32767).astype(np.int16)); print('peak',np.abs(sfx).max())
