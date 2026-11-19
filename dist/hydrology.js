import {buildHullRadiation} from './art/lake-hull-response.js';
import {waterViews} from './art/lake-poses.js';
import * as THREE from './three.module.js';
import {Reflector} from './Reflector.js';
import {clamp, smooth, sunDirection, sunVectorGLSL} from './calibration.js';

const TAU = Math.PI * 2;
const gravity = 9.81;
export const depth = 0.82;
export const rippleLength = 0.42;
const kRing = TAU / rippleLength;
const omegaRing = Math.sqrt(gravity * kRing * Math.tanh(kRing * depth));
export const groupSpeed = omegaRing / (2*kRing) * (1 + 2*kRing*depth / Math.sinh(2*kRing*depth));
const waves = [
  [0.018, 3.65, .91, -.415, 1.17],
  [0.009, 1.39, -.48, -.877, -.73],
  [0.0041, .71, .995, .10, .51],
  [0.0024, .34, .59, -.807, 2.47]
].map(([amplitude, length, x, z, phase])=>{
  const k = TAU / length;
  return {a:amplitude, kx:k*x, kz:k*z, w:Math.sqrt(gravity*k*Math.tanh(k*depth)), phase};
});

export function ambientWater(x, z, time) {
  let height = 0;
  for (const w of waves) height += w.a * Math.sin(w.kx*x + w.kz*z - w.w*time + w.phase);
  return height;
}

export function makeDynamics(asset) {
  const b = asset.boat, width = asset.boatWidth, length = asset.boatLength;
  const origin = b.position.clone(), yaw = b.rotation.y;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const world = (x,z)=>new THREE.Vector2(origin.x+c*x+s*z,origin.z-s*x+c*z);
  const water = (x,z,t)=>{ const q=world(x,z); return ambientWater(q.x,q.y,t); };
  const along=length*.39, across=width*.46;
  const dt=1/120, start=-8, states=[], events=[];
  const pos=[0,0,0], velocity=[0,0,0];
  const loadedMotion=[0,0,0],loadedVelocity=[0,0,0],loadHistory=[];
  const frequencies=[5.2,4.3,5.7], damping=[.64,.70,.57];
  const dip = [[],[]];
  for(let i=0;i<=Math.round((12.1-start)/dt);i++){
    const t=start+i*dt;
    const stern=water(0,along,t), bow=water(0,-along,t);
    const left=water(-across,0,t), right=water(across,0,t);
    const load = smooth(7.37,7.95,t);
    const step = Math.exp(-Math.pow((t-7.65)/.245,2));
    const target=[
      (stern+bow+left+right)*.25 - .034*load,
      Math.atan2(bow-stern,2*along) + .004*step,
      Math.atan2(right-left,2*across) + .046*step + .0035*load
    ];
    const boarding=[-.034*load,.004*step,.046*step+.0035*load];
    for(let j=0;j<3;j++) {
      const w=frequencies[j];
      loadedVelocity[j]+=(w*w*(boarding[j]-loadedMotion[j])-2*damping[j]*w*loadedVelocity[j])*dt;
      loadedMotion[j]+=loadedVelocity[j]*dt;
      velocity[j]+=(w*w*(target[j]-pos[j])-2*damping[j]*w*velocity[j])*dt;
      pos[j]+=velocity[j]*dt;
    }
    loadHistory.push([...loadedMotion,...loadedVelocity]);
    states.push({t,h:pos[0],pitch:pos[1],roll:pos[2],dh:velocity[0],dp:velocity[1],dr:velocity[2],water:[bow,stern,left,right]});
    dip[0].push(velocity[0]-across*velocity[2]);
    dip[1].push(velocity[0]+across*velocity[2]);
  }
  for(let side=0;side<2;side++){
    let last=-99;
    for(let i=2;i<states.length-1;i++){
      const v=dip[side], t=states[i].t;
      if (v[i]<v[i-1] && v[i]<=v[i+1] && v[i]<-.010 && t-last>.92) {
        const sign=side*2-1, q=world(sign*width*.445,-length*.085);
        events.push({t,x:q.x,z:q.y,side:sign,amp:clamp(-v[i]*.12,.003,.016),velocity:v[i]});
        last=t;
      }
    }
  }
  events.sort((a,b)=>a.t-b.t);
  function sample(t) {
    const j=clamp((t-start)/dt,0,states.length-1);
    const i=Math.floor(j), a=states[i], b=states[Math.min(i+1,states.length-1)], u=j-i;
    const zero=states[Math.round(-start/dt)];
    const lerp=(key)=>a[key]+(b[key]-a[key])*u-(['h','pitch','roll'].includes(key)?zero[key]:0);
    return {t,h:lerp('h'),pitch:lerp('pitch'),roll:lerp('roll'),dh:lerp('dh'),dp:lerp('dp'),dr:lerp('dr'),water:a.water.map((x,k)=>x+(b.water[k]-x)*u)};
  }
  function sampleUnloaded(t){
    const state=sample(t),j=clamp((t-start)/dt,0,loadHistory.length-1);
    const i=Math.floor(j),a=loadHistory[i],b=loadHistory[Math.min(i+1,loadHistory.length-1)];
    ['h','pitch','roll','dh','dp','dr'].forEach((key,k)=>{state[key]-=a[k]+(b[k]-a[k])*(j-i);});
    return state;
  }
  function apply(t) {
    const state=sample(t);
    b.position.set(origin.x,origin.y+state.h,origin.z);
    b.rotation.set(state.pitch,yaw,state.roll,'YXZ');
    b.updateMatrixWorld(true);
    return state;
  }
  const zero=states[Math.round(-start/dt)];
  return {apply,sample,sampleUnloaded,events,origin,yaw,width,length,world,along,across,frequencies,damping,
    trim:{h:-zero.h,pitch:-zero.pitch,roll:-zero.roll}};
}

function waterGrid(dyn){
  // Closely spaced vertices at the landing, increasingly broad rings at distance.
  function knots(center, radius, step) {
    const side=[0]; let d=step;
    while(d<425){side.push(d);d+=step*Math.max(1,Math.pow(d/radius,1.7));}
    side.push(460);
    return side.slice(1).reverse().map(v=>center-v).concat(side.map(v=>center+v));
  }
  function refine(axis,centre,reach){
    const result=axis.filter(v=>Math.abs(v-centre)>reach);
    for(let v=centre-reach;v<=centre+reach;v+=.050)result.push(v);
    return result.sort((a,b)=>a-b);
  }
  const xs=refine(knots(1,5,.16),dyn.origin.x,2.44);
  const zs=refine(knots(9,7,.19),-dyn.origin.z,2.73),p=[],index=[];
  for(let j=0;j<zs.length;j++) for(let i=0;i<xs.length;i++) {
    p.push(xs[i],zs[j],0);
    if(i && j){const d=j*xs.length+i, a=d-xs.length-1;index.push(a,a+1,d,a,d,d-1);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(index);
  g.computeBoundingSphere();return g;
}

const uniforms = {
  hullRadiation:{value:null},hullFlow:{value:null},hullOrigin:{value:new THREE.Vector2()},hullForcing:{value:1},hullSpan:{value:6.144},
  tDiffuse:{value:null}, textureMatrix:{value:new THREE.Matrix4()},color:{value:new THREE.Color()},
  clock:{value:0}, wave:{value:[]}, phase:{value:new THREE.Vector4()}, packets:{value:[]},
  boatCenter:{value:new THREE.Vector2()}, lateral:{value:new THREE.Vector2()}, dimensions:{value:new THREE.Vector2()},
  halfWidth:{value:new Array(13).fill(0)}, depthMap:{value:null},  dataView:{value:0}, observedBirth:{value:99},
  inverseMirrorProjection:{value:new THREE.Matrix4()}, mirrorWorld:{value:new THREE.Matrix4()}, mirrorVp:{value:new THREE.Matrix4()},
  cleanPiles:{value:null},incident:{value:null}, skylight:{value:null}, skyspread:{value:null}, probeLight:{value:null},probeRipples:{value:null},probeVp:{value:[]},probeEye:{value:[]},probeMoment:{value:[]},returnFit:{value:null}, substrate:{value:null}, capillary:{value:null}, bathymetry:{value:null},
  dockStart:{value:new THREE.Vector2()},dockEnd:{value:new THREE.Vector2()},boatInverse:{value:new THREE.Matrix4()},
  wettedEnds:{value:new THREE.Vector2()},piling:{value:[]},pierNear:{value:new THREE.Vector4()},pierFar:{value:new THREE.Vector4()},
  soffitMap:{value:null},soffitRelief:{value:null},beamEnds:{value:[]},beamProfiles:{value:[]},
  observedPackets:{value:[]},
};
const field = `
uniform float clock;
uniform sampler2D hullRadiation,hullFlow;
uniform float hullForcing,hullSpan;
uniform vec2 hullOrigin;
uniform vec4 wave[4];
uniform vec4 phase;
uniform vec4 packets[8];
uniform vec2 lateral;
uniform float observedBirth;
vec2 surfaceDrift(vec2 uv){
  vec4 q=texture2D(hullFlow,clamp(uv,.0001,.9999))*255.;
  return (vec2(q.r*256.+q.g,q.b*256.+q.a)-32768.)/180000.;
}
vec3 advectedRipple(vec2 local,vec2 drift,vec2 gradX,vec2 gradZ,vec2 direction,float wavelength,float steepness,float phase){
  vec2 k=direction*(6.2831853/wavelength);
  float waveNumber=length(k),omega=sqrt((9.81*waveNumber+.000073*waveNumber*waveNumber*waveNumber)*tanh(.82*waveNumber));
  float quiet=dot(k,local)-omega*clock+phase,advected=quiet-dot(k,drift),amplitude=steepness/waveNumber;
  vec2 kBent=k-vec2(dot(k,gradX),dot(k,gradZ));
  return amplitude*vec3(sin(advected)-sin(quiet),kBent*cos(advected)-k*cos(quiet));
}
vec3 radiatedSurface(vec2 p){
  vec2 v=p-hullOrigin,alongHull=vec2(-lateral.y,lateral.x);
  vec2 uv=vec2(dot(v,lateral),dot(v,alongHull))/hullSpan+.5;
  if(min(uv.x,uv.y)<=.001||max(uv.x,uv.y)>=.999||hullForcing<.00001)return vec3(0.);
  vec4 wavelet=texture2D(hullRadiation,uv)*255.;
  float eta=(wavelet.r*256.+wavelet.g-32768.)/400000.;
  vec2 slope=(wavelet.ba-128.)/240.;
  vec2 drift=surfaceDrift(uv);
  vec3 shortWave=vec3(0.);
  if(dot(drift,drift)>1e-10){
    vec2 dx=vec2(.00390625,0.),dz=dx.yx;
    vec2 gradX=(surfaceDrift(uv+dx)-surfaceDrift(uv-dx))/.048;
    vec2 gradZ=(surfaceDrift(uv+dz)-surfaceDrift(uv-dz))/.048;
    // Existing short waves are advected and compressed by the computed
    // velocity field. Their phase/slope difference vanishes for zero load.
    vec2 local=vec2(dot(v,lateral),dot(v,alongHull));
    shortWave+=advectedRipple(local,drift,gradX,gradZ,vec2(.891,-.454),.352,.028,1.63);
    shortWave+=advectedRipple(local,drift,gradX,gradZ,vec2(-.781,-.625),.275,.022,-.31);
    shortWave+=advectedRipple(local,drift,gradX,gradZ,vec2(.994,-.109),.232,.026,2.81);
    shortWave+=advectedRipple(local,drift,gradX,gradZ,vec2(.643,-.766),.184,.021,-2.72);
    shortWave+=advectedRipple(local,drift,gradX,gradZ,vec2(-.999,-.045),.142,.017,.93);
    shortWave+=advectedRipple(local,drift,gradX,gradZ,vec2(.922,-.387),.116,.014,-1.55);
  }
  slope+=shortWave.yz;
  return hullForcing*vec3(eta+shortWave.x,lateral*slope.x+alongHull*slope.y);
}
vec3 ambientAt(vec2 p,float t) {
  vec3 h=vec3(0.);
  for(int i=0;i<4;i++){
    vec4 w=wave[i];
    float q=dot(w.xy,p)-w.z*t+phase[i];
    h+=vec3(w.w*sin(q),w.w*w.xy*cos(q));
  }
  return h;
}
vec3 ambient(vec2 p){return ambientAt(p,clock);}
vec3 surfaceAt(vec2 p,out float observed) {
  observed=0.;
  vec3 h=ambient(p);
  for(int i=0;i<8;i++){
    vec4 e=packets[i]; float age=clock-e.z;
    if(age<0. || age>5.8 || abs(e.w)<.0001) continue;
    vec2 delta=p-e.xy;float r=length(delta);vec2 dir=delta/max(r,.0001);
    float d=r-${groupSpeed.toFixed(9)}*age;
    if(abs(d)>.6 || r>2.8) continue;
    float outward=smoothstep(-.12,.35,sign(e.w)*dot(dir,lateral));
    float env=abs(e.w)*outward*exp(-d*d/.043-r*.73)*smoothstep(0.,.11,age)*(1.-smoothstep(4.4,5.8,age));
    if(abs(e.z-observedBirth)<.0002)observed=env;
    float q=${kRing.toFixed(9)}*r-${omegaRing.toFixed(9)}*age;
    h+=vec3(env*cos(q),env*(-${kRing.toFixed(9)}*sin(q)-(2.*d/.043+.73)*cos(q))*dir);
  }
  return h;
}
vec3 surface(vec2 p){float spare;return surfaceAt(p,spare)+radiatedSurface(p);}`;

export function buildWater(ctx,dyn,asset) {
  // Every closed timber member has six four-vertex faces. Read the actual
  // upper and lower end pairs of each member, including scarfed sister beams.
  const timbers=asset.dock.getObjectByName('Deck endgrain and submerged stringers');
  timbers.updateWorldMatrix(true,false);
  const positions=timbers.geometry.getAttribute('position'),beamEnds=[],beamProfiles=[];
  const vertex=i=>new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(timbers.matrixWorld);
  for(let i=0;i+23<positions.count;i+=24){
    const a=vertex(i),b=vertex(i+1),c=vertex(i+2),d=vertex(i+3);
    const halfWidth=.5*Math.hypot(a.x-d.x,a.z-d.z);
    const halfHeight=.5*(a.y-vertex(i+4).y);
    const start=a.clone().lerp(d,.5),end=b.clone().lerp(c,.5);
    beamEnds.push(new THREE.Vector4(start.x,start.z,end.x,end.z));
    beamProfiles.push(new THREE.Vector4(start.y-halfHeight,end.y-halfHeight,halfWidth,halfHeight));
  }
  const shader={name:'Lake · local slope reflection',uniforms,
    vertexShader:`
      uniform mat4 textureMatrix;
      varying vec4 reflected;
      varying vec3 wp;
      ${field}
      void main(){
        vec3 v=position; v.z=surface(vec2(v.x,-v.y)).x;
        wp=(modelMatrix*vec4(v,1.)).xyz;
        reflected=textureMatrix*vec4(v,1.);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);
      }`,
    fragmentShader:`
      uniform sampler2D tDiffuse,depthMap,incident,skylight,skyspread,probeLight,probeRipples,returnFit,substrate,capillary,bathymetry;
      uniform mat4 inverseMirrorProjection,mirrorWorld,mirrorVp,boatInverse;
      uniform vec2 boatCenter, dimensions,dockStart,dockEnd;
      uniform vec2 wettedEnds;
      uniform vec4 piling[8];
      uniform vec4 pierNear,pierFar;
      uniform vec4 beamEnds[${beamEnds.length}],beamProfiles[${beamEnds.length}];
      uniform sampler2D soffitMap,soffitRelief,cleanPiles;
      uniform mat4 probeVp[4];uniform vec3 probeEye[4];uniform float probeMoment[4];
      uniform float halfWidth[13],dataView;
      uniform vec4 observedPackets[8];
      varying vec4 reflected;
      varying vec3 wp;
      ${field}
      const vec3 observingEye=vec3(0.,2.05,0.);
      const vec3 sun=${sunVectorGLSL};
      float hash21(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+1.),f.x),f.y);}
      vec2 obsUV(vec3 dir){
        float dz=max(.001,-.998997*dir.z-.044763*dir.y);
        return vec2(.5+915./975.*dir.x/dz,(492.+915.*(.998997*dir.y-.044763*dir.z)/dz)/524.);
      }
      float chartSupport(vec2 uv){return smoothstep(-.085,-.001,uv.x)*(1.-smoothstep(1.,1.085,uv.x))*smoothstep(-.085,-.001,uv.y)*(1.-smoothstep(1.001,1.065,uv.y));}
      vec2 waveAtlas(vec2 p,float tick){
        float id=mod(tick,48.);
        vec2 cell=vec2(mod(id,8.),floor(id/8.));
        vec2 uv=(cell*162.+1.+fract(p)*160.)/vec2(1296.,972.);
        return (texture2DLodEXT(capillary,vec2(uv.x,1.-uv.y),0.).rg*2.-1.);
      }
      vec2 spectralSlope(vec2 p,float t,float footprint){
        float f=t*16.,i=floor(f);
        vec2 root=p/3.8;
        vec2 a=mix(waveAtlas(root,i),waveAtlas(root,i+1.),fract(f));
        mat2 frame=mat2(.39,.920814,-.920814,.39);
        vec2 pr=frame*p/1.41+vec2(.32,.17);
        f=t*24.71+17.;i=floor(f);
        vec2 b=mat2(.39,-.920814,.920814,.39)*mix(waveAtlas(pr,i),waveAtlas(pr,i+1.),fract(f));
        float regionEnergy=.65+.42*noise(p*.64+vec2(-.025,.012)*t);
        return regionEnergy*(.083*a*(1.-smoothstep(.033,.18,footprint))+.038*b*(1.-smoothstep(.015,.072,footprint)));
      }
      vec3 initialWater(vec2 p){
        vec3 h=ambientAt(p,0.);
        for(int i=0;i<8;i++){
          vec4 e=observedPackets[i];float age=-e.z;if(age<0.||age>5.8||abs(e.w)<.0001)continue;
          vec2 delta=p-e.xy;float r=length(delta);vec2 dir=delta/max(r,.0001);float d=r-${groupSpeed.toFixed(9)}*age;
          if(abs(d)>.6||r>2.8)continue;float outward=smoothstep(-.12,.35,sign(e.w)*dot(dir,lateral));
          float env=abs(e.w)*outward*exp(-d*d/.043-r*.73)*smoothstep(0.,.11,age)*(1.-smoothstep(4.4,5.8,age));
          float q=${kRing.toFixed(9)}*r-${omegaRing.toFixed(9)}*age;
          h+=vec3(env*cos(q),env*(-${kRing.toFixed(9)}*sin(q)-(2.*d/.043+.73)*cos(q))*dir);
        }
        return h;
      }
      vec3 sourceAt(vec2 uv,vec3 fallback){
        float d=texture2D(depthMap,clamp(uv,.0005,.9995)).r;
        if(d>.99999)return fallback;
        vec4 hit=inverseMirrorProjection*vec4(clamp(uv,.0005,.9995)*2.-1.,d*2.-1.,1.);
        return (mirrorWorld*vec4(hit.xyz/hit.w,1.)).xyz;
      }
      vec2 projMirror(vec3 p){vec4 v=mirrorVp*vec4(p,1.);return v.xy/v.w*.5+.5;}
      float deckEdge(vec2 p){
        vec2 axis=dockEnd-dockStart;
        float along=dot(p-dockStart,axis)/dot(axis,axis);
        vec2 left=mix(pierNear.xy,pierFar.xy,along),right=mix(pierNear.zw,pierFar.zw,along);
        vec2 across=right-left;
        float u=dot(p-left,across)/dot(across,across);
        return max(max(-along,along-1.)*length(axis),max(-u,u-1.)*length(across));
      }
      vec2 soffitUV(vec2 p){
        vec2 axis=dockEnd-dockStart;
        float t=dot(p-dockStart,axis)/dot(axis,axis);
        vec2 l=mix(pierNear.xy,pierFar.xy,t),r=mix(pierNear.zw,pierFar.zw,t);
        float u=dot(p-l,r-l)/dot(r-l,r-l);
        return vec2((u+.12)/1.24,(t+.027)/1.054);
      }
      float stringerEntrance(vec3 origin,vec3 ray){
        float nearest=1000.;
        for(int i=0;i<${beamEnds.length};i++){
          vec4 ends=beamEnds[i],profile=beamProfiles[i];
          vec2 axis=ends.zw-ends.xy;
          float lengthXZ=length(axis),rise=(profile.y-profile.x)/lengthXZ;
          vec2 z=axis/lengthXZ,x=vec2(-z.y,z.x),d=origin.xz-(ends.xy+ends.zw)*.5;
          float along=dot(d,z),rayAlong=dot(ray.xz,z);
          vec3 o=vec3(dot(d,x),origin.y-(profile.x+profile.y)*.5-along*rise,along);
          vec3 v=vec3(dot(ray.xz,x),ray.y-rayAlong*rise,rayAlong);
          vec3 inv=1./(v+mix(vec3(-.00001),vec3(.00001),step(vec3(0.),v)));
          vec3 halfSize=vec3(profile.z,profile.w,lengthXZ*.5);
          vec3 a=(-halfSize-o)*inv,b=(halfSize-o)*inv,entry=min(a,b),exitAt=max(a,b);
          float nearAt=max(0.,max(max(entry.x,entry.y),entry.z));
          if(min(min(exitAt.x,exitAt.y),exitAt.z)>nearAt)nearest=min(nearest,nearAt);
        }
        return nearest;
      }
      float dielectric(float c){
        float st=(1.-c*c)/(1.333*1.333),ct=sqrt(max(0.,1.-st));
        float rs=(c-1.333*ct)/(c+1.333*ct),rp=(1.333*c-ct)/(1.333*c+ct);
        return .5*(rs*rs+rp*rp);
      }
      float bedDepth(vec2 p){
        vec2 uv=(p-vec2(-15.,-28.))/vec2(35.,32.);
        float z=texture2D(bathymetry,clamp(uv,.001,.999)).r*2.55;
        vec2 outDist=p-clamp(p,vec2(-15.,-28.),vec2(20.,4.));
        return clamp(z+.11*length(outDist),.06,5.);
      }
      float storeWidth(float st){float v=clamp(st,0.,.99999)*12.;int j=int(v);return mix(halfWidth[j],halfWidth[j+1],fract(v));}
      float footprint(vec3 p){
        vec3 hull=(boatInverse*vec4(p,1.)).xyz;
        float st=hull.z/dimensions.y+.5;
        float w=storeWidth(st)+.069*sin(3.14159*clamp(st,0.,1.))+.009;
        float railH=.255+.19*pow(abs(st*2.-1.),1.65);
        float bh=max(max(abs(hull.x)-w,abs(hull.z)-dimensions.y*.498),max(hull.y-railH,-.14-hull.y));
        float dk=max(deckEdge(p.xz),max(p.y-.35,.235-p.y));
        if(dk<.12){
          float cover=textureLod(soffitMap,clamp(soffitUV(p.xz),.0005,.9995),2.6).a;
          dk=max(dk,.21*(.50-cover));
        }
        return min(bh,dk);
      }
      float pilingSunVisibility(vec3 waterReceiver){
        float vis=1.;vec2 towardSun=normalize(sun.xz);
        for(int i=0;i<8;i++){
          vec4 post=piling[i];vec2 toPost=post.xy-waterReceiver.xz;
          float forward=dot(toPost,towardSun);
          if(forward < -post.z || forward>3.3)continue;
          float distanceFromAxis=length(toPost-towardSun*max(0.,forward));
          float atHeight=waterReceiver.y+forward*sun.y/max(.08,length(sun.xz));
          float penumbra=.004+.009*max(.0,forward);
          float shade=(1.-smoothstep(post.z-penumbra,post.z+penumbra,distanceFromAxis))*
                      (1.-smoothstep(post.w-.015,post.w+.015,atHeight));
          vis=min(vis,1.-shade);
        }
        return vis;
      }
      float lightVis(vec3 receiver){
        float shadow=1.,h=clamp((.34-receiver.y)/sun.y,0.,6.);
        for(int j=0;j<5;j++){
          float ray=max(0.,h+float(j-2)*.225);
          shadow=min(shadow,smoothstep(-.025,.068+.035*ray,footprint(receiver+ray*sun)));
        }
        vec3 transmitted=refract(-sun,vec3(0.,1.,0.),1./1.333);
        vec3 skyEdge=receiver-transmitted*(max(0.,-receiver.y)/max(.12,-transmitted.y));
        if(deckEdge(skyEdge.xz)<1.1)shadow*=smoothstep(.67,.80,stringerEntrance(skyEdge,sun));
        return shadow*pilingSunVisibility(skyEdge);
      }
      vec3 gravel(vec2 p){
        mat2 r=mat2(.733,.680,-.680,.733);
        vec3 a=texture2D(substrate,p/1.88).rgb;
        vec3 b=texture2D(substrate,r*p/1.27+vec2(.127,.304)).rgb;
        return mix(a,b,smoothstep(.24,.74,noise(p*.49)));
      }
      vec2 sampleUV(int i,vec3 world,out float support){
        vec4 clip=probeVp[i]*vec4(world,1.);
        vec2 uv=clip.xy/max(.01,clip.w)*.5+.5;
        support=smoothstep(.02,.35,clip.w)*smoothstep(-.004,.145,uv.x)*smoothstep(-.004,.145,uv.y)*
          (1.-smoothstep(.855,1.004,uv.x))*(1.-smoothstep(.855,1.004,uv.y));
        return vec2((float(i)+clamp(uv.x,.002,.998))/4.,clamp(uv.y,.003,.997));
      }
      void main(){
        vec2 p=wp.xz;
        vec3 waterInHull=(boatInverse*vec4(wp,1.)).xyz;
        float st=waterInHull.z/dimensions.y+.5;
        // Real gunwales already mask the dry cockpit. Keep the submerged
        // stencil slightly inside the shell to avoid revealing the lake bed.
        if(waterInHull.z>wettedEnds.x && waterInHull.z<wettedEnds.y && abs(waterInHull.x)<storeWidth(st)-.028)discard;
        float observed;vec3 s=surfaceAt(p,observed);
        vec3 hullWave=radiatedSurface(p);s+=hullWave;
        if(dataView>2.5){
          float hue=clamp(abs(hullWave.x)/.014,0.,1.);
          vec3 neutral=vec3(.075,.095,.10),up=vec3(.96,.67,.19),down=vec3(.085,.43,.76);
          gl_FragColor=vec4(mix(neutral,hullWave.x>0.?up:down,hue),1.);
          return;
        }
        vec2 packetSlope=s.yz-ambient(p).yz;
        if(dataView>1.5){
          float raw=floor(min(1.,observed/.02)*65535.+.5);
          gl_FragColor=vec4(floor(raw/256.),mod(raw,256.),0.,255.)/255.;return;
        }
        float span=max(length(dFdx(p)),length(dFdy(p))),t=clock;
        vec3 initial=initialWater(p);
        for(int wi=0;wi<4;wi++){
          vec4 w=wave[wi];float lost=smoothstep(.47,2.65,span*length(w.xy));
          s.yz-=lost*w.w*w.xy*cos(dot(w.xy,p)-w.z*t+phase[wi]);
          initial.yz-=lost*w.w*w.xy*cos(dot(w.xy,p)+phase[wi]);
        }
        vec2 capSlope=spectralSlope(p,t,span);s.yz+=capSlope;initial.yz+=spectralSlope(p,0.,span);
        vec3 N=normalize(vec3(-s.y,1.,-s.z)),N0=normalize(vec3(-initial.y,1.,-initial.z));
        vec3 V=normalize(cameraPosition-wp),E0=normalize(observingEye-wp),R=reflect(-V,N),R0=reflect(-E0,N0);
        vec3 quietNormal=normalize(vec3(-s.y+hullWave.y,1.,-s.z+hullWave.z));
        vec3 loadRayShift=R-reflect(-V,quietNormal);
        vec2 flatUV=reflected.xy/reflected.w;
        vec3 hitFlat=sourceAt(flatUV,wp+reflect(-V,vec3(0.,1.,0.))*180.);
        float rayLen=clamp(length(hitFlat-wp),.1,250.);
        vec3 flatRay=reflect(-V,vec3(0.,1.,0.));
        // Integrate the wider virtual footprint at a long reflection distance.
        // Nearby hulls and piles retain their local instantaneous normal.
        float coherence=mix(.92,.32,smoothstep(2.,45.,rayLen));
        vec3 groundRay=normalize(mix(flatRay,R,coherence));
        vec2 uv=projMirror(wp+groundRay*rayLen);uv=clamp(uv,.002,.998);
        vec3 hit=sourceAt(uv,wp+R*180.);
        float compareLen=clamp(length(hit-wp),.1,250.);
        if(compareLen<rayLen*.82||compareLen>rayLen*1.24) {
          vec2 fine=projMirror(wp+groundRay*compareLen);vec3 h2=sourceAt(fine,wp+R*180.);
          // Prefer the intersection lying closest to the reflected ray. This keeps
          // narrow piles and the hull from disintegrating at a depth discontinuity.
          float e1=length(cross(hit-wp,groundRay)),e2=length(cross(h2-wp,groundRay));
          if(e2<e1){hit=h2;uv=clamp(fine,.002,.998);}
        }
        float rootError=length(cross(hit-wp,groundRay));
        if(rootError>.032+.011*length(hit-wp) && length(hitFlat-wp)>length(hit-wp)*2.6){
          hit=hitFlat;uv=clamp(flatUV,.002,.998);rootError=length(cross(hit-wp,groundRay));
        }
        rayLen=clamp(length(hit-wp),.1,250.);
        float lod=clamp(log2(1.+rayLen*.115),0.,5.2);
        // Filter the reflected footprint rather than a single reflection-map
        // texel. Short unresolved wave normals subtend a real angular cone.
        // At shore depth edges a single planar-camera ray can lose its source.
        vec2 mirrorPixels=vec2(textureSize(tDiffuse,0));
        vec2 dxUV=dFdx(uv),dyUV=dFdy(uv);
        vec3 acrossRay=normalize(cross(groundRay,vec3(0.,1.,0.))+vec3(.00001,0.,0.));
        vec3 upRay=normalize(cross(acrossRay,groundRay));
        float cone=rayLen*(.004+.014*smoothstep(.003,.039,span));
        vec3 target=wp+groundRay*rayLen;
        vec2 coneX=projMirror(target+acrossRay*cone)-projMirror(target);
        vec2 coneY=projMirror(target+upRay*cone)-projMirror(target);
        float coneRadius=max(length(coneX*mirrorPixels),length(coneY*mirrorPixels));
        float rasterRadius=max(length(dxUV*mirrorPixels),length(dyUV*mirrorPixels));
        float footprintLod=clamp(log2(max(1.,max(coneRadius,rasterRadius*.84))),0.,5.5);
        float filteredLod=max(lod,footprintLod);
        vec3 captured=textureLod(tDiffuse,uv,filteredLod).rgb;
        float verifiedSource=1.-smoothstep(.011+.0020*rayLen,.028+.009*rayLen,rootError);
        float nearby=1.-smoothstep(19.,49.,rayLen);
        vec3 localAverage=textureLod(tDiffuse,clamp(flatUV,.002,.998),max(2.6,filteredLod)).rgb;
        captured=mix(captured,localAverage,(1.-verifiedSource)*nearby*.86);
        float h=bedDepth(p);
        vec3 under=refract(-V,N,1./1.333);float path=h/max(.24,-under.y);
        vec2 bedP=p+under.xz*path;
        float viss=lightVis(vec3(bedP,-h).xzy);
        vec3 tran=exp(-vec3(3.65,3.16,2.84)*path);
        // Surface and bed irradiance diminish under the hull, dock, and overhanging bank.
        float canopy=.65+.35*smoothstep(.05,.62,h);
        float mudPatch=.64+.36*noise(bedP*.85);
        vec3 silt=vec3(.008,.014,.012)*canopy;
        vec3 benthic=gravel(bedP)*vec3(.43,.47,.40)*mix(.16,.84,viss)*mudPatch;
        vec3 body=mix(silt,benthic,tran);
        float f=dielectric(clamp(dot(N,V),.003,1.));
        float sunlight=pow(max(dot(R,sun),0.),180.)*3.1+pow(max(dot(R,sun),0.),960.)*3.;
        float farPath=smoothstep(5.,55.,rayLen);
        float skySlope=R.y/max(.06,length(R.xz));
        float unoccluded=farPath*smoothstep(.13,.30,skySlope)*pilingSunVisibility(wp);
        vec2 radUV=vec2(.5+atan(R.x,-R.z)/6.2831853,asin(clamp(R.y,0.,1.))/1.57079633);
        vec3 incidentL=exp2(texture2D(skylight,clamp(radUV,.002,.998)).rgb*12.-6.);
        vec3 broadSky=exp2(textureLod(skylight,clamp(radUV,.002,.998),3.6).rgb*12.-6.);
        // The surveyed hemisphere supplies extended sky/land radiance. Its
        // narrow positive outliers are unresolved old glitter, not a second sun.
        vec3 hemispheric=min(incidentL,broadSky*1.34+.02);
        vec2 skyMeta=texture2D(skyspread,clamp(radUV,.002,.998)).rg;
        float slopeAlong=dot(s.yz,normalize(sun.xz))*.78+dot(s.yz,normalize(vec2(-.81,.58)))*.22;
        float facet=clamp(slopeAlong/.039,-2.8,2.8);
        float angularSigma=skyMeta.r*1.8*smoothstep(.015,.16,V.y);
        hemispheric*=exp2(clamp(angularSigma*facet*.82,-1.3,1.55));
        // Relative sky and land exposures are reconstructed independently: the LDR
        // photography's diffuse shading already includes a compressed sunlit range.
        // Near-field wood and stone have already passed through the same
        // scene exposure as the visible bank. They cannot emit a second sun.
        float extendedGain=3.5+4.3*smoothstep(.019,.36,dot(captured,vec3(.2126,.7152,.0722)));
        vec3 terrestrial=captured*mix(extendedGain,1.13,nearby);
        float outside=smoothstep(78.,145.,rayLen);
        float horizonSource=smoothstep(.10,.31,R.y);
        vec3 mirror=mix(terrestrial,hemispheric,outside*max(horizonSource,skyMeta.g));

        vec3 col=mix(body,mirror,f);
        // Registered water-only radiance ratios reproject the source through the
        // measured water plane; the same buffer contains no shoreline or boat colour.
        vec3 rLookup=normalize(R+reflect(-E0,vec3(0.,1.,0.))-R0);
        vec2 skyUV=obsUV(vec3(rLookup.x,-rLookup.y,rLookup.z));
        float incidentConf=chartSupport(skyUV)*smoothstep(.00,.14,-rLookup.z);
        vec3 chartSky=texture2D(incident,clamp(skyUV,.001,.999)).rgb;
        float angularF=dielectric(clamp(rLookup.y,.006,1.));
        vec3 generalSky=chartSky*clamp(f/max(.012,angularF),.4,1.8);
        col=mix(col,generalSky,incidentConf*outside*.13);
        vec3 realSource=hit;
        // Under the mean surface, conjugate rays from both eyes to the same 3D
        // reflector intersect in different places. Reproject the measured ratio,
        // preserving parallax of the reflected shoreline and timber.
        float sy=clamp(realSource.y,-.03,120.);
        vec2 fromOrig=mix(observingEye.xz,realSource.xz,observingEye.y/(observingEye.y+max(.002,sy)));
        vec2 fromCurr=mix(cameraPosition.xz,realSource.xz,cameraPosition.y/(cameraPosition.y+max(.002,sy)));
        vec2 probe=p+(fromOrig-fromCurr)*(1.-smoothstep(17.,65.,rayLen));
        vec2 change=s.yz-initial.yz;
        probe+=change*min(rayLen*.19,.37);
        vec2 localUV=obsUV(vec3(probe.x,wp.y-observingEye.y,probe.y));
        vec4 ob=texture2D(returnFit,clamp(localUV,.001,.999));
        vec4 cleared=texture2D(cleanPiles,clamp(localUV,.001,.999));
        // A near-field timber silhouette measured from the survey camera is
        // unusable on an open-water ray from another eye. A verified current
        // timber hit may preserve its measured return; the actual mirror map
        // supplies all other pile positions and the submerged shadow is solar.
        float eyeBaseline=length(cameraPosition-observingEye);
        float registered=1.-smoothstep(.024,.19,eyeBaseline);
        float samePole=0.;
        if(cleared.a>.001){
          for(int i=0;i<8;i++){
            vec4 post=piling[i];vec2 nearPost=hit.xz-post.xy;
            if(length(nearPost)>post.z+.035 || hit.y<-.035 || hit.y>post.w+.025)continue;
            vec2 originalToe=obsUV(vec3(post.x,-observingEye.y,post.y));
            vec2 originalCrown=obsUV(vec3(post.x,-post.w-observingEye.y,post.y));
            vec2 q=(localUV-originalToe)*vec2(975.,524.),v=(originalCrown-originalToe)*vec2(975.,524.);
            float ratio=clamp(dot(q,v)/max(.01,dot(v,v)),0.,1.);
            float gap=length(q-ratio*v),radius=915.*post.z/max(1.,-post.y);
            samePole=max(samePole,(1.-smoothstep(radius+.7,radius+5.,gap))*(1.-smoothstep(.017,.055,rootError)));
          }
        }
        ob.rgb=mix(ob.rgb,cleared.rgb,cleared.a*(1.-max(registered,samePole)));

        vec3 localIncident=texture2D(incident,clamp(localUV,.001,.999)).rgb;
        vec3 throughput=exp2(ob.rgb*10.-7.);
        float ratioF=clamp(f/max(.018,dielectric(clamp(dot(E0,N0),.006,1.))),.048,2.8);
        ratioF=mix(1.,ratioF,smoothstep(.045,.22,E0.y));
        vec3 measured=localIncident*throughput*ratioF+body*max(0.,1.-ratioF);
        float sourceAngle=clamp(dot(E0,V),-1.,1.);
        float parallax=length(cameraPosition-observingEye)/max(length(wp-observingEye),.5);
        float conf=ob.a*chartSupport(localUV)*smoothstep(.946,.9996,sourceAngle)*exp(-41.*parallax*parallax);
        // The water-only observations describe material response in
        // directions hidden from the opening photograph. Visibility and the
        // incident/outgoing ray geometry set their weights continuously.
        vec3 fittedSum=vec3(0.);float weightSum=0.,angleTrust=0.;
        for(int j=0;j<4;j++){
          vec3 eyeJ=probeEye[j],towardJ=normalize(eyeJ-wp);
          float align=clamp(dot(V,towardJ),-1.,1.);
          float baseline=length(cameraPosition-eyeJ)/max(length(wp-eyeJ),.65);
          float errorAngle=2.*(1.-align)+.31*baseline*baseline;
          float wj=exp(-2.9*errorAngle)/(.066+errorAngle);
          if(wj<.008)continue;
          vec2 projectedJ=mix(eyeJ.xz,hit.xz,eyeJ.y/(eyeJ.y+max(.002,sy)));
          vec2 qj=p+projectedJ-fromCurr;
          // A surveyed water image already integrates its own distribution of
          // wave normals. Keep that receiver in world space. The current hull
          // normal acts on the live reflected ray, Snell ray and Fresnel term.
          float capTime=probeMoment[j];
          vec3 refWave=ambientAt(qj,capTime);
          refWave.yz+=spectralSlope(qj,capTime,span);
          vec2 dSlope=(s.yz-hullWave.yz)-refWave.yz;

          vec3 sampleWorld=vec3(qj.x,wp.y,qj.y);
          float support;vec2 surveyUV=sampleUV(j,sampleWorld,support);
          vec4 observation=texture2D(probeLight,surveyUV);
          float directSupport=texture2D(probeRipples,surveyUV).b;
          // Only distant light can use a low-frequency estimate inferred
          // across an observation gap. Nearby timber and shoreline rely on
          // real, unobstructed rays or the live reflected geometry.
          float admitted=mix(directSupport,1.,smoothstep(26.,92.,rayLen));
          wj*=support*support*observation.a*observation.a*admitted;
          if(j==3)wj*=max(.095,1.-angleTrust*angleTrust*.963);
          if(wj<.001)continue;
          angleTrust=max(angleTrust,exp(-13.*errorAngle)*support*mix(observation.a,directSupport,.65));
          // The micro-band travels with the measured wind-wave group, while the
          // broad radiance is associated with the actual 3D reflector above.
          float age=t-capTime;
          float variation=.87+.26*noise(p*.37);
          vec2 transported=p-vec2(.306,-.153)*age*variation;
          vec2 shortTransport=p-vec2(.183,-.117)*age*(2.-variation);
          float flowValid;vec2 flowUV=sampleUV(j,vec3(transported.x,wp.y,transported.y),flowValid);
          float flowMask=texture2D(probeRipples,flowUV).b;
          float shortValid;vec2 shortUV=sampleUV(j,vec3(shortTransport.x,wp.y,shortTransport.y),shortValid);
          // The photometric micro-band belongs to this water receiver. Its
          // spatial footprint combines the native observation resolution
          // and the projected pixel. The renderer handles camera exposure.
          vec2 atlasSize=vec2(textureSize(probeRipples,0));
          float bandwidth=1.55+min(3.0,4.*sqrt(errorAngle));
          vec2 midDx=dFdx(flowUV)*atlasSize,midDy=dFdy(flowUV)*atlasSize;
          vec2 shortDx=dFdx(shortUV)*atlasSize,shortDy=dFdy(shortUV)*atlasSize;
          float midLod=clamp(.5*log2(bandwidth*bandwidth+max(dot(midDx,midDx),dot(midDy,midDy))),0.,5.);
          float shortLod=clamp(.5*log2(bandwidth*bandwidth+max(dot(shortDx,shortDx),dot(shortDy,shortDy))),0.,5.);
          float shortMask=texture2D(probeRipples,shortUV).b;
          float fine=(textureLod(probeRipples,flowUV,midLod).r*5.-2.5)*flowValid*flowMask+
                     (textureLod(probeRipples,shortUV,shortLod).g*4.-2.)*shortValid*shortMask;
          float integrated=(textureLod(probeRipples,flowUV,max(2.4,midLod+.85)).r*5.-2.5)*flowValid*flowMask+
                     (textureLod(probeRipples,shortUV,max(2.4,shortLod+.85)).g*4.-2.)*shortValid*shortMask;
          float opticalSupport=smoothstep(.961,.995,dot(R,sun))*unoccluded;
          fine=mix(min(fine,integrated+.115),fine,opticalSupport);
          float localFacet=clamp(.48*facet+dot(capSlope,normalize(sun.xz+vec2(.27,-.18)))*22.,-2.2,2.2);
          float missingDetail=max(1.-flowMask*flowValid,.72*(1.-directSupport));
          fine+=.57*localFacet*mix(.55,angularSigma,.60)*missingDetail;
          vec3 sourceV=normalize(eyeJ-sampleWorld);
          float atFlat=dielectric(clamp(sourceV.y,.012,1.));
          float atSurface=dielectric(clamp(dot(sourceV,normalize(vec3(-refWave.y,1.,-refWave.z))),.012,1.));
          float relativeF=mix(1.,clamp(f/atSurface,.32,2.2),smoothstep(.035,.21,sourceV.y));
          vec3 observedEnergy=exp2(observation.rgb*14.-8.)*atFlat*relativeF;
          vec3 extendedEnergy=exp2(textureLod(probeLight,surveyUV,4.25).rgb*14.-8.)*atFlat*relativeF;
          float lum=dot(observedEnergy,vec3(.2126,.7152,.0722));
          float warmGlint=smoothstep(.13,.44,lum)*smoothstep(.055,.265,
               (observedEnergy.r-observedEnergy.b)/max(.018,lum));
          vec3 energy=mix(observedEnergy,min(observedEnergy,extendedEnergy*1.25),warmGlint);
          fine=mix(fine,min(fine,.34),warmGlint);
          vec3 calibrated=(energy+vec3(.006,.010,.009)*(1.-f))*exp2(fine);
          float penetration=(1.-f)*smoothstep(.2,.90,V.y)*(.10+.15*(1.-smoothstep(.12,.8,h)));
          calibrated+=penetration*(body-vec3(.007,.011,.009));
          fittedSum+=max(calibrated,vec3(.001))*wj;weightSum+=wj;
        }
        if(weightSum>.001){
          float influence=.972*weightSum/(weightSum+.32);
          // Scattered light from the near-field packet still shifts actual hull
          // reflections as the operator puts weight on the gunwale.
          col=mix(col,fittedSum/weightSum,influence);
        }
        // Additional slope from a propagating hull packet tilts the measured
        // specular lobe toward or away from the brighter part of the sky.
        float waveResponse=clamp(-dot(packetSlope,normalize(sun.xz+V.xz*.34))*2.45,-.52,.52);
        col*=exp2(waveResponse);
        // Fill unresolved glints between surveyed directions with the simulated
        // capillary spectrum. Film-response compression preserves their warm hue.
        float unsampled=(1.-angleTrust)*smoothstep(.06,.42,length(capSlope)*13.+.13);
        col*=exp2(clamp(-6.4*dot(capSlope,normalize(sun.xz))*unsampled,-.36,.36));
        vec3 hullSource=(boatInverse*vec4(hit,1.)).xyz;
        float uHull=hullSource.z/dimensions.y+.5;
        float sideGap=abs(hullSource.x)-storeWidth(uHull)-.12;
        float hullVisibility=(1.-smoothstep(-.03,.055,sideGap))*(1.-smoothstep(.498,.54,abs(uHull-.5)))*
             (1.-smoothstep(.44,.52,hullSource.y))*smoothstep(-.075,-.005,hullSource.y);
        hullVisibility*=1.-smoothstep(.024,.070,rootError);
        col=mix(col,mix(body*.62,captured*2.15,f),hullVisibility*(1.-angleTrust*.65)*.72);
        // Return a true, live timber reflection when the ray intersects the
        // bridge; an open-water probe cannot represent that local occluder.
        vec2 alongBridge=normalize(dockEnd-dockStart),deltaBridge=hit.xz-dockStart;
        float longitudinal=dot(deltaBridge,alongBridge), transverse=abs(dot(deltaBridge,vec2(-alongBridge.y,alongBridge.x)));
        float isDock=smoothstep(-.18,-.035,longitudinal)*(1.-smoothstep(7.95,8.12,longitudinal))*
           (1.-smoothstep(.57,.68,transverse))*smoothstep(-.016,.018,hit.y)*(1.-smoothstep(.82,1.05,hit.y));
        float goodHit=1.-smoothstep(.018,.065,rootError);
        col=mix(col,mix(body*.54,captured*3.10,f),isDock*goodHit*(.73-.38*angleTrust));
        // Reconstruct the first underside hit through the scanned 58 planks.
        // Their true gaps transmit skylight and expose the two lower stringers.
        if(deckEdge(p)<2.2 && groundRay.y>.021){
          float atDeck=(.3235-wp.y)/groundRay.y;
          for(int k=0;k<2;k++){
            vec2 q=soffitUV(p+groundRay.xz*atDeck);
            float undersideY=.18+.20*texture2D(soffitRelief,clamp(q,.0005,.9995)).r;
            atDeck=(undersideY-wp.y)/groundRay.y;
          }
          vec3 belowPlank=wp+groundRay*atDeck;
          vec2 q=soffitUV(belowPlank.xz);
          vec4 board=texture2D(soffitMap,clamp(q,.0005,.9995));
          float edge=deckEdge(belowPlank.xz);
          float envelope=(1.-smoothstep(.012,.038,edge))*(1.-smoothstep(2.8,3.4,atDeck));
          vec2 scatterUV=soffitUV(belowPlank.xz+atDeck*(capSlope*.32+vec2(.004,-.002)))-q;
          float woodCover=.58*board.a+.21*(texture2D(soffitMap,clamp(q+scatterUV,.0005,.9995)).a+
                                             texture2D(soffitMap,clamp(q-scatterUV,.0005,.9995)).a);
          float atBeam=stringerEntrance(wp,groundRay);
          float beamAvailable=1.-smoothstep(2.6,3.35,atBeam),cover=envelope*woodCover;
          float beamFirst=(1.-smoothstep(atDeck-.008,atDeck+.008,atBeam))*beamAvailable;
          float onBeam=max(beamFirst,beamAvailable*(1.-cover));
          float strength=onBeam+cover*(1.-onBeam);
          if(strength>.001){
            float travel=mix(atDeck,min(atBeam,3.4),onBeam);
            vec3 timber=wp+groundRay*travel;
            vec2 woodUV=clamp(projMirror(timber),.001,.999);
            vec3 realWood=textureLod(tDiffuse,woodUV,.25).rgb;
            float verified=(1.-smoothstep(.025,.19,abs(length(hit-wp)-travel)))*goodHit;
            realWood=mix(realWood,captured,verified*.83);
            // Angle to the outer edge controls ambient light on the water
            // under the shadow. The timber's live material already receives
            // skylight and reflected light from the lake.
            float inset=max(0.,-deckEdge(timber.xz));
            float opening=.32/sqrt(.32*.32+inset*inset);
            vec2 relief=texture2D(soffitRelief,clamp(q,.0005,.9995)).gb*2.-1.;
            float planeFace=clamp(.88+.20*dot(relief,groundRay.xz),.60,1.14);
            vec3 source=mix(realWood,mix(realWood,board.rgb*(.27+.21*opening),.25)*planeFace,cover*(1.-onBeam));
            float undulation=clamp(9.*dot(capSlope,normalize(groundRay.xz))+.25*facet,-1.2,1.2);
            // View factor of the finite-width overhang at the water receiver.
            // Each side illuminates the water column through a different arc.
            vec2 receiver=soffitUV(p)*vec2(1.24,1.054)-vec2(.12,.027);
            float pierWidth=mix(length(pierNear.zw-pierNear.xy),length(pierFar.zw-pierFar.xy),clamp(receiver.y,0.,1.));
            vec2 margins=vec2(receiver.x,1.-receiver.x)*pierWidth;
            vec2 blocked=margins/sqrt(margins*margins+vec2(.105));
            float skyOpening=clamp(1.-.5*(blocked.x+blocked.y),.06,1.);
            float endDistance=min(receiver.y,1.-receiver.y)*length(dockEnd-dockStart);
            skyOpening=max(skyOpening,.65*(1.-smoothstep(-.12,.68,endDistance)));
            vec3 solarRay=normalize(sun+vec3(capSlope.x*.27,0.,capSlope.y*.27));
            float sunTravel=(.324-wp.y)/max(.10,solarRay.y);
            vec2 sunPoint=p+solarRay.xz*sunTravel,sunUV=soffitUV(sunPoint);
            float sunCover=(1.-smoothstep(.012,.048,deckEdge(sunPoint)))*
              texture2D(soffitMap,clamp(sunUV,.0005,.9995)).a;
            float sunBeam=stringerEntrance(wp,solarRay);
            float directLight=(1.-sunCover)*smoothstep(sunTravel-.04,sunTravel+.04,sunBeam);
            vec3 diffuseWater=vec3(.32+.85*skyOpening)+vec3(.58,.47,.32)*directLight;
            vec3 upwelling=body*diffuseWater*exp2((.12+.14*directLight)*undulation);
            // Use the same scene-to-incident exposure as other terrestrial
            // reflections. Dielectric Fresnel is applied once below.
            vec3 reflectedWood=source*(3.5+4.3*smoothstep(.019,.36,dot(source,vec3(.2126,.7152,.0722))));
            vec3 shade=mix(upwelling,reflectedWood,f);
            col=mix(col,shade,strength);
          }
          float slit=envelope*(1.-woodCover)*(1.-beamAvailable);
          if(slit>.001){
            vec3 through=mix(body,hemispheric,f);
            col=mix(col,through,slit*.75);
          }
        }
        float brightness=dot(col,vec3(.2126,.7152,.0722)),knee=mix(.55,.79,angleTrust);
        if(brightness>knee){
          float mapped=knee+(.988-knee)*(1.-exp(-(brightness-knee)/(.988-knee)));
          col*=mapped/brightness;
        }
        // Re-evaluate the measured incident sky and the submerged material on
        // both rays of the real hull slope. Their differential is zero without
        // mechanical forcing. It preserves optical detail inside a previously
        // measured, low-frequency body-radiance footprint.
        if(dot(hullWave.yz,hullWave.yz)>.000001){
          vec3 calmRay=R-loadRayShift;
          vec2 quietUV=vec2(.5+atan(calmRay.x,-calmRay.z)/6.2831853,asin(clamp(calmRay.y,0.,1.))/1.57079633);
          vec3 activeL=exp2(textureLod(skylight,clamp(radUV,.002,.998),.35).rgb*12.-6.);
          vec3 quietL=exp2(textureLod(skylight,clamp(quietUV,.002,.998),.35).rgb*12.-6.);
          float quietF=dielectric(clamp(dot(quietNormal,V),.003,1.));
          vec3 quietUnder=refract(-V,quietNormal,1./1.333);
          float quietPath=h/max(.24,-quietUnder.y);vec2 quietBed=p+quietUnder.xz*quietPath;
          vec3 quietSoil=gravel(quietBed)*vec3(.43,.47,.40)*mix(.16,.84,lightVis(vec3(quietBed,-h).xzy))*(.64+.36*noise(quietBed*.85));
          vec3 quietBody=mix(silt,quietSoil,exp(-vec3(3.65,3.16,2.84)*quietPath));
          vec3 rayDifference=(activeL*f-quietL*quietF)*smoothstep(2.2,18.,rayLen)+(body*(1.-f)-quietBody*(1.-quietF));
          col+=clamp(rayDifference,vec3(-.10),vec3(.16))*.90;
        }
        float observedWeight=conf*mix(1.,.995,smoothstep(.018,.13,eyeBaseline));
        col=mix(max(col,vec3(.0002)),measured,observedWeight);
        // The undiluted outgoing direct-solar lobe uses the same single world
        // light as the cabin and timber shadow. A fully measured opening ray
        // already contains its photographic direct component.
        float directSolar=f*sunlight*unoccluded*(1.-conf)*.66;
        col+=directSolar*vec3(1.,.81,.54);
        // A depth-map at finite resolution can miss the first centimetres of
        // the slender wet piles. Intersect the surveyed vertical cylinders
        // directly and sample the timber in the live mirrored scene.
        for(int i=0;i<8;i++){
          vec4 pile=piling[i];
          vec2 towardPile=pile.xy-p;
          float distanceXZ=length(towardPile);
          if(distanceXZ>.73)continue;
          float slopeMix=.62*smoothstep(.04,.56,distanceXZ);
          vec3 nearRay=normalize(mix(flatRay,groundRay,slopeMix));
          vec2 direction=normalize(nearRay.xz);
          float forward=dot(towardPile,direction);
          vec2 tangent=vec2(-direction.y,direction.x);
          float lineDistance=length(towardPile-max(0.,forward)*direction);
          float filterWidth=clamp(.52*(abs(dot(dFdx(p),tangent))+abs(dot(dFdy(p),tangent))),.001,.012);
          float side=1.-smoothstep(pile.z-filterWidth,pile.z+filterWidth,lineDistance);
          float entry=max(0.,forward-sqrt(max(0.,pile.z*pile.z-lineDistance*lineDistance)));
          float elevation=wp.y+entry*nearRay.y/max(.028,length(nearRay.xz));
          float contact=side*(1.-smoothstep(.40,.69,entry))*(1.-smoothstep(pile.w-.015,pile.w+.015,elevation));
          if(contact<.001)continue;
          vec2 face=mix(p+entry*direction,pile.xy,.58);
          vec2 woodUV=projMirror(vec3(face.x,max(elevation,.07),face.y));
          vec3 wetWood=textureLod(tDiffuse,clamp(woodUV,.001,.999),0.).rgb;
          float wet=clamp(elevation/.19,0.,1.);
          vec3 toe=wetWood*mix(.05,.48,wet)*(.16+.84*f)+body*.024*(1.-f);
          col=mix(col,min(col,toe),contact*(1.-.975*conf));
        }
        if(dataView>.5){
          float local=s.x-ambient(p).x;vec3 mid=vec3(.075,.129,.135);
          col=mix(mid,local>0.?vec3(.95,.64,.18):vec3(.10,.48,.76),clamp(abs(local)/.011,0.,1.));
        }
        gl_FragColor=vec4(max(col,0.),1.);
        #include <colorspace_fragment>
      }

      `};
  const water=new Reflector(waterGrid(dyn),{textureWidth:ctx.high?1152:768,textureHeight:ctx.high?1152:768,multisample:0,clipBias:.00002,shader});
  // The open hull displaces the water during roll. This colourless aperture
  // follows its gunwale and only masks water fragments behind the opening.
  const maskPositions=[],maskIndices=[];
  for(let i=0;i<=64;i++){
    const f=i/64,w=Math.max(0,asset.halfWidthAt(f)-.008),y=asset.gunwaleHeightAt(f)-.024,z=(f-.5)*dyn.length;
    maskPositions.push(-w,y,z,w,y,z);
    if(i){const a=(i-1)*2;maskIndices.push(a,a+2,a+1,a+2,a+3,a+1);}
  }
  const maskGeo=new THREE.BufferGeometry();
  maskGeo.setAttribute('position',new THREE.Float32BufferAttribute(maskPositions,3));maskGeo.setIndex(maskIndices);
  const dryCockpit=new THREE.Mesh(maskGeo,new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:true,side:THREE.FrontSide}));
  dryCockpit.renderOrder=.85;dryCockpit.name='Water excluded by gunwales';asset.boat.add(dryCockpit);
  const target=water.getRenderTarget();
  target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
  target.depthTexture=new THREE.DepthTexture(target.width,target.height,THREE.UnsignedIntType);
  target.depthTexture.minFilter=target.depthTexture.magFilter=THREE.NearestFilter;
  water.name='Lake / mirror and wave field';water.rotation.x=-Math.PI/2;
  water.frustumCulled=false;water.renderOrder=1;ctx.scene.add(water);
  const u=water.material.uniforms;
  const loader=new THREE.TextureLoader();
  function loadWaterMap(name,{repeat=false,srgb=false,mips=true}={}){
    const map=loader.load('./art/lake-'+name+'.webp');
    if(repeat)map.wrapS=map.wrapT=THREE.RepeatWrapping;
    if(srgb)map.colorSpace=THREE.SRGBColorSpace;
    map.generateMipmaps=mips;
    map.minFilter=mips?THREE.LinearMipmapLinearFilter:THREE.LinearFilter;
    map.magFilter=THREE.LinearFilter;
    map.anisotropy=mips?8:1;
    return map;
  }
  u.incident.value=loadWaterMap('incident',{srgb:true});
  u.returnFit.value=loadWaterMap('return-fit');u.cleanPiles.value=loadWaterMap('clear-pilings');
  u.skylight.value=loadWaterMap('skylight');
  u.skyspread.value=loadWaterMap('skyspread');
  u.probeLight.value=loadWaterMap('probes');u.probeRipples.value=loadWaterMap('residual');
  for(const view of waterViews){
    const survey=new THREE.PerspectiveCamera(view.fov,975/984,.045,1200);
    survey.position.fromArray(view.eye);
    survey.rotation.set(-view.pitchDown,-view.heading,view.roll,'YXZ');
    survey.updateMatrixWorld();
    u.probeVp.value.push(new THREE.Matrix4().multiplyMatrices(survey.projectionMatrix,survey.matrixWorldInverse));
    u.probeEye.value.push(survey.position.clone());u.probeMoment.value.push(view.time);
  }
  u.substrate.value=loadWaterMap('substrate',{repeat:true,srgb:true});
  u.soffitMap.value=loadWaterMap('soffit',{srgb:true});
  u.soffitRelief.value=loadWaterMap('soffit-relief');
  u.capillary.value=loadWaterMap('capillary',{mips:false});
  const bottomSize=160,bottomData=new Uint8Array(bottomSize*bottomSize);
  for(let j=0;j<bottomSize;j++)for(let i=0;i<bottomSize;i++){
    const x=-15+35*(i+.5)/bottomSize,z=-28+32*(j+.5)/bottomSize;
    // The shoreline is surveyed; the bed is a calibrated submerged extension.
    const basin=Math.max(0,-ctx.groundY(x,z));
    const localDepth=Math.min(2.5,.355*basin+Math.max(0,x-3.25)*.075);
    bottomData[j*bottomSize+i]=Math.round(255*localDepth/2.55);
  }
  const bottom=new THREE.DataTexture(bottomData,bottomSize,bottomSize,THREE.RedFormat);
  bottom.minFilter=bottom.magFilter=THREE.LinearFilter;bottom.needsUpdate=true;u.bathymetry.value=bottom;
  u.dockStart.value.set(asset.dockStart.x,asset.dockStart.z);u.dockEnd.value.set(asset.dockEnd.x,asset.dockEnd.z);
  u.wettedEnds.value.set(asset.waterlineMinZ??-dyn.length*.5,asset.waterlineMaxZ??dyn.length*.5);
  u.piling.value=asset.posts.map((point,i)=>new THREE.Vector4(point.x,point.z,asset.postRadii[i],asset.postTops[i].y));
  const [leftNear,rightNear,leftFar,rightFar]=asset.dockCorners;
  u.beamEnds.value=beamEnds;u.beamProfiles.value=beamProfiles;
  u.pierNear.value.set(leftNear.x,leftNear.z,rightNear.x,rightNear.z);
  u.pierFar.value.set(leftFar.x,leftFar.z,rightFar.x,rightFar.z);
  u.depthMap.value=target.depthTexture;
  const reflect=water.onBeforeRender;
  water.onBeforeRender=(...args)=>{
    reflect(...args);
    u.inverseMirrorProjection.value.copy(water.camera.projectionMatrix).invert();
    u.mirrorWorld.value.copy(water.camera.matrixWorld);
    u.mirrorVp.value.multiplyMatrices(water.camera.projectionMatrix,water.camera.matrixWorldInverse);
  };
  u.wave.value=waves.map(w=>new THREE.Vector4(w.kx,w.kz,w.w,w.a));
  u.phase.value.fromArray(waves.map(w=>w.phase));
  u.packets.value=Array.from({length:8},()=>new THREE.Vector4(0,0,99,0));
  u.boatCenter.value.set(dyn.origin.x,dyn.origin.z);
  u.lateral.value.set(Math.cos(dyn.yaw),-Math.sin(dyn.yaw));
  u.dimensions.value.set(dyn.width,dyn.length);
  const radiation=buildHullRadiation(THREE,ctx,dyn,asset,ambientWater);
  u.hullRadiation.value=radiation.texture;u.hullFlow.value=radiation.flowTexture;u.hullOrigin.value.set(dyn.origin.x,dyn.origin.z);u.hullSpan.value=radiation.span;
  const hull=asset.waterlineHalfWidths;
  for(let j=0;j<13;j++){
    if(hull?.length>1) {
      const q=j*(hull.length-1)/12,i=Math.floor(q);
      u.halfWidth.value[j]=THREE.MathUtils.lerp(hull[i],hull[Math.min(i+1,hull.length-1)],q-i);
    } else u.halfWidth.value[j]=dyn.width*.41*Math.pow(Math.sin(Math.PI*j/12),.73);
  }
  const initialPackets=dyn.events.filter(e=>e.t<=0 && -e.t<5.8).slice(-8);
  u.observedPackets.value=Array.from({length:8},(_,i)=>{
    const e=initialPackets[i];return e?new THREE.Vector4(e.x,e.z,e.t,e.amp*e.side):new THREE.Vector4(0,0,99,0);
  });
  return {water,sunDirection:sunDirection.clone(),hullRadiation:radiation,setHullForcing(scale){u.hullForcing.value=clamp(scale,0,1);},update(t){
    radiation.update(t);
    u.boatInverse.value.copy(asset.boat.matrixWorld).invert();
    u.clock.value=t;
    const live=dyn.events.filter(e=>e.t<=t && t-e.t<5.8).slice(-8);
    for(let i=0;i<8;i++){const e=live[i];if(e)u.packets.value[i].set(e.x,e.z,e.t,e.amp*e.side);else u.packets.value[i].set(0,0,99,0);}
  }};
}
