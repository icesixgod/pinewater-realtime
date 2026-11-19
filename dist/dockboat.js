import * as THREE from './three.module.js';
import {sunDirection,sunVectorGLSL} from './calibration.js';
import scannedPier from './art/dockboat-scans.js';
import observations from './art/dockboat-observations.js';

const V = (x,y,z) => new THREE.Vector3(x,y,z);
const lightSpaceRight=V(0,1,0).cross(sunDirection).normalize();
const lightSpaceUp=sunDirection.clone().cross(lightSpaceRight);
const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const mix = (a,b,x) => a+(b-a)*x;
const seed = n => {
  let a = Math.imul(n ^ 107981, 1597334677);
  a = Math.imul(a ^ (a >>> 15), 2246822519);
  return ((a ^ (a >>> 13)) >>> 0) / 4294967296;
};
const deckCuts = [0,.018291,.035251,.053874,.073828,.093781,.10409,.113735,.133356,.153642,.164283,.181909,.200532,.210841,.220818,.231127,.249751,.259395,.270037,.279681,.28999,.300632,.310609,.320253,.332225,.352511,.371467,.39275,.413036,.432657,.452943,.476222,.496176,.519787,.541071,.564017,.586299,.610243,.62554,.640838,.665447,.687396,.710675,.735617,.761556,.778588,.79562,.812651,.829683,.846715,.863746,.880778,.89781,.914842,.931873,.948905,.965937,.982968,1];
const beamSamples = [0,.066,.133,.195,.248,.296,.330,.360,.378,.385,.384,.371,.349,.322,.289,.250,.207,.156,.094,.044,0];
const sheerSamples = [.46,.429,.380,.352,.328,.312,.298,.286,.275,.264,.261,.263,.267,.273,.283,.298,.314,.335,.362,.397,.44];
function station(samples,t) {
  const h=clamp(t)*(samples.length-1), i=Math.min(samples.length-2,Math.floor(h));
  const f=h-i, a=samples[i], b=samples[i+1];
  const d0=(b-samples[Math.max(0,i-1)])/(i===0?1:2);
  const d1=(samples[Math.min(samples.length-1,i+2)]-a)/(i+2>=samples.length?1:2);
  return (2*f*f*f-3*f*f+1)*a+(f*f*f-2*f*f+f)*d0+(-2*f*f*f+3*f*f)*b+(f*f*f-f*f)*d1;
}

class Surface {
  constructor() {this.p=[];this.u=[];this.c=[];this.ids=[];}
  quad(points,uv,shade=1) {
    const offset=this.p.length/3;
    for(let k=0;k<4;k++) {
      const p=points[k];this.p.push(p.x,p.y,p.z);this.u.push(uv[k][0],uv[k][1]);
      const s=Array.isArray(shade)?shade[k]:shade;
      if(Array.isArray(s))this.c.push(...s);else this.c.push(s,s,s);
    }
    this.ids.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
  }
  addTo(group,material,name) {
    if(!this.ids.length) return;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(this.u,2));
    g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3)); g.setIndex(this.ids);
    g.computeVertexNormals();g.computeBoundingSphere();
    const m=new THREE.Mesh(g,material);m.name=name;group.add(m);return m;
  }
}
const square=(l=1,w=1,u=0,v=0)=>[[u,v],[u+l,v],[u+l,v+w],[u,v+w]];

function texture(file, repeat=true) {
  const tex=new THREE.TextureLoader().load(new URL('./art/dockboat-'+file+'.webp',import.meta.url).href);
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=8;
  if(repeat) tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  return tex;
}
function readScan(piece) {
  const unpack=(s,type)=>{
    const b=atob(s),u=new Uint8Array(b.length);
    for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
    return new type(u.buffer);
  };
  return {p:unpack(piece.p,Int16Array),n:unpack(piece.n,Int8Array),uv:unpack(piece.uv,Uint16Array),i:unpack(piece.i,Uint16Array)};
}
function scanBatch() {return {p:[],uv:[],duv:[],c:[],i:[]};}
function scanGeometry(batch,group,mat,name) {
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(batch.p,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uv,2));
  g.setAttribute('uv1',new THREE.Float32BufferAttribute(batch.uv,2));
  g.setAttribute('deckUv',new THREE.Float32BufferAttribute(batch.duv,2));
  if(batch.ends)g.setAttribute('plankEndDistance',new THREE.Float32BufferAttribute(batch.ends,1));
  g.setAttribute('color',new THREE.Float32BufferAttribute(batch.c,3));g.setIndex(batch.i);
  g.computeVertexNormals();g.computeBoundingSphere();
  const o=new THREE.Mesh(g,mat);o.name=name;group.add(o);return o;
}
function pierMaterial(kind) {
  const albedo=texture('pier-'+kind+'-diff',false),normal=texture('pier-'+kind+'-nor_gl',false),arm=texture('pier-'+kind+'-arm',false);
  normal.colorSpace=arm.colorSpace=THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({map:albedo,normalMap:normal,normalScale:new THREE.Vector2(.72,.72),aoMap:arm,aoMapIntensity:.92,
    roughnessMap:arm,roughness:.94,metalness:.013,vertexColors:true,side:THREE.DoubleSide});
}
function vesselWood(file,normalFile='vessel-normal',roughness=.76) {
  const normal=texture(normalFile);normal.colorSpace=THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({map:texture(file),normalMap:normal,normalScale:new THREE.Vector2(.39,.39),roughness,
    metalness:.025,vertexColors:true,side:THREE.DoubleSide});
}
function vesselObservations() {
  const loader=new THREE.TextureLoader();
  const colorAtlas=texture('studies',false),rubrail=texture('rubrail-observation',false);
  const depthAtlas=loader.load(new URL('./art/dockboat-studies-meta.png',import.meta.url).href);
  depthAtlas.colorSpace=THREE.NoColorSpace;depthAtlas.generateMipmaps=false;depthAtlas.minFilter=depthAtlas.magFilter=THREE.NearestFilter;
  const entries=[192,287,96].map(f=>({world:new THREE.Matrix4().fromArray(observations[f].world),
    vessel:new THREE.Matrix4().fromArray(observations[f].vessel)}));
  const prior=texture('deck',false),deckFaces=texture('deck-planks',false);
  const shadow=loader.load(new URL('./art/dockboat-sun.png',import.meta.url).href);
  shadow.colorSpace=THREE.NoColorSpace;shadow.generateMipmaps=false;shadow.minFilter=shadow.magFilter=THREE.NearestFilter;
  const coverage=loader.load(new URL('./art/dockboat-deck-confidence.png',import.meta.url).href);
  coverage.colorSpace=THREE.NoColorSpace;coverage.anisotropy=8;
  return {entries,prior,deckFaces,coverage,shadow,colorAtlas,depthAtlas,rubrail};
}
function observedSurface(object,id,moving,cap,rest) {
  if(!object?.isMesh||!id)return;
  const mode=moving?'vessel':'world',m=object.material.clone();object.material=m;
  if(!moving)m.userData.bridgeSurface=({8:'planks',9:'stringers',10:'piles'})[id]??'fittings';
  const obs=cap.entries;
  const level=[0,.82,.95,.90,.94,.95,.96,.64,.92,.60,.92][id]||.80;
  m.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{
      woodEvidence:{value:cap.colorAtlas},woodGeometry:{value:cap.depthAtlas},
      camC:{value:obs[2][mode]},camA:{value:obs[0][mode]},camB:{value:obs[1][mode]},restW:{value:rest},obsType:{value:id},obsStrength:{value:level},
      woodLightRight:{value:lightSpaceRight},woodLightUp:{value:lightSpaceUp},registeredDeck:{value:cap.prior},deckFaces:{value:cap.deckFaces},plankCoverage:{value:cap.coverage},sunDepth:{value:cap.shadow}
    });
    if(id===4)shader.uniforms.railObservation={value:cap.rubrail};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      uniform mat4 camA,camB,camC,restW;
      varying vec4 nearObs,turnObs,approachObs;
      varying vec3 worldWood,restWood;
      varying vec2 deckGrain;
      ${id===8?'attribute vec2 deckUv;attribute float plankEndDistance;varying float deckEndDistance;':''}
      ${id===4?'attribute vec2 railUv;varying vec2 woodRailUv;':''}`)
      .replace('#include <project_vertex>',`#include <project_vertex>
        nearObs=camA*vec4(transformed,1.);turnObs=camB*vec4(transformed,1.);approachObs=camC*vec4(transformed,1.);
        worldWood=(modelMatrix*vec4(transformed,1.)).xyz;restWood=(restW*vec4(transformed,1.)).xyz;
        ${id===8?'deckGrain=deckUv;deckEndDistance=plankEndDistance;':'deckGrain=vec2(0.);'}
        ${id===4?'woodRailUv=railUv;':''}`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D woodEvidence,woodGeometry,registeredDeck,deckFaces,plankCoverage,sunDepth;
      uniform float obsType,obsStrength;uniform vec3 woodLightRight,woodLightUp;
      varying vec4 nearObs,turnObs,approachObs;
      varying vec3 worldWood,restWood;
      varying vec2 deckGrain;
      ${id===8?'varying float deckEndDistance;':''}
      ${id===4?'uniform sampler2D railObservation; varying vec2 woodRailUv;':''}
      vec4 readObservation(float slot,vec4 clip) {
        vec2 u=clip.xy/clip.w*.5+.5;
        if(clip.w<.05 || min(u.x,u.y)<.002 || max(u.x,u.y)>.998)return vec4(0.);
        vec2 witnessUV=vec2((u.x+slot)/3.,u.y);
        vec4 meta=texture2D(woodGeometry,witnessUV);
        float cls=floor(meta.b*255.+.5);
        float same=1.-step(.45,abs(cls-obsType));
        float z=(floor(meta.r*255.+.5)*256.+floor(meta.g*255.+.5))/3300.;
        float epsilon=obsType>7.5?.045:.021;
        float fringe=min(min(u.x,1.-u.x),min(u.y,1.-u.y));
        float weight=same*meta.a*(1.-smoothstep(epsilon,epsilon*2.3,abs(clip.w-z)))*smoothstep(.003,.063,fringe);
        vec3 value=texture2D(woodEvidence,witnessUV).rgb;
        return vec4(value,weight);
      }
      float sunVis(vec3 p) {
        vec3 axis=${sunVectorGLSL},right=woodLightRight,up=woodLightUp;
        vec3 q=p-vec3(1.6,.15,-7.7);vec2 u=vec2(dot(q,right)/10.3,dot(q,up)/7.3)+.5;
        float z=9.-dot(q,axis),g=0.;
        for(int i=0;i<9;i++){
          vec2 sampleOffset=vec2(float(i%3)-1.,float(i/3)-1.)*.00137;
          vec4 v=texture2D(sunDepth,u+sampleOffset);
          float sd=(floor(v.r*255.+.5)*256.+floor(v.g*255.+.5))/3200.;
          g+=1.-smoothstep(.006,.021,z-sd);
        }
        return g/9.;
      }`)
      .replace('#include <opaque_fragment>',`
        vec4 ac=readObservation(0.,nearObs),bc=readObservation(1.,turnObs);
        float sunLit=sunVis(restWood);
        outgoingLight*=mix(.45,1.,sunLit);
        vec3 result=outgoingLight;
        ${id===8?`
          vec3 oldRay=vec3(0.,2.05,0.)-worldWood,nowRay=cameraPosition-worldWood;
          float facing=1.-smoothstep(.004,.13,1.-dot(normalize(oldRay),normalize(nowRay)));
          float scale=1.-smoothstep(1.075,1.63,length(oldRay)/max(.05,length(nowRay)));
          vec3 oldColour=texture2D(registeredDeck,deckGrain).rgb;
          vec3 timberEvidence=texture2D(plankCoverage,deckGrain).rgb;
          vec4 sampledBoard=vec4(texture2D(deckFaces,deckGrain).rgb,timberEvidence.r);
          vec3 newColour=sampledBoard.rgb;
          vec3 Ndeck=inverseTransformDirection(normal,viewMatrix);
          float topFace=smoothstep(.32,.78,Ndeck.y);
          // This rectified albedo has had foreground piles and directional cast shadows removed.
          // Its repaired fibres stay continuous across the excluded source regions.
          float projection=.89*facing*scale;
          vec3 rawWood=texture2D(map,vMapUv).rgb,coarse=textureLod(map,vMapUv,4.0).rgb;
          vec3 grain=clamp((rawWood+.027)/(coarse+.027),vec3(.56),vec3(1.63));
          vec3 timberValue=clamp((rawWood+.048)/vec3(.16,.154,.145),vec3(.42),vec3(1.92));
          vec3 textureRecovery=mix(timberValue,grain,.40);
          vec3 fibres=newColour*mix(textureRecovery,mix(vec3(1.),grain,.62),sampledBoard.a);
          float microLight=.91+.09*clamp(dot(Ndeck,${sunVectorGLSL})*1.5,0.,1.);
          fibres*=microLight;
          vec3 angleNow=normalize(cameraPosition-worldWood);
          float returnFit=smoothstep(.79,.985,dot(angleNow,normalize(vec3(2.36716033,1.46283731,-7.70916924)-restWood)));
          float approachFit=smoothstep(.82,.986,dot(angleNow,normalize(vec3(0.03964974,1.87153263,-4.83978046)-restWood)));
          vec4 ahead=readObservation(2.,approachObs);
          // Auxiliary images have their own occlusion labels. Use the interior of an observed
          // plank, away from the antialiased edges of neighbouring posts and the canoe.
          float af=.68*approachFit*ahead.a*smoothstep(.77,.995,ahead.a)*timberEvidence.b;
          float bf=.74*returnFit*bc.a*smoothstep(.77,.995,bc.a)*timberEvidence.b;
          if(af+bf>.0001){
            vec3 exposed=(af*ahead.rgb+bf*bc.rgb)/max(.0001,af+bf);
            fibres=mix(fibres,exposed,clamp(max(af,bf),0.,.74));
          }
          fibres=mix(fibres,oldColour,projection);
          float tipSide=1.-smoothstep(.012,.067,deckEndDistance);
          vec3 cutFibre=textureLod(deckFaces,deckGrain,3.).rgb*clamp((rawWood+.033)/(coarse+.033),vec3(.66),vec3(1.44));
          fibres=mix(fibres,cutFibre*(.81+.19*sunLit),tipSide*.42*(1.-projection));
          float faceL=dot(result,vec3(.28,.57,.15));
          vec3 weatheredEnd=mix(result,vec3(faceL*1.055,faceL*1.005,faceL*.94),.78)*(.69+.22*sunLit);
          result=mix(result,weatheredEnd,tipSide*(1.-topFace));
          // Colour observations supply wood grain. Its cast shadow follows the same
          // world-space sun as the chimney, porch, poles and highlight on the lake.
          fibres*=.58+.42*sunLit;
          result=mix(result,fibres,topFace*.98);
        `:''}
        vec3 ph=bc.a>0.?bc.rgb:ac.rgb;
        float weight=max(bc.a,ac.a);
        if(ac.a>.0 && bc.a>.0)ph=mix(bc.rgb,ac.rgb,${moving?'.90':'.18'});
        ${id!==8?`
          vec4 cc=readObservation(2.,approachObs);
          if(cc.a>0.){
            float priority=weight>.0?(weight/(weight+.31*cc.a)):.0;
            ph=mix(cc.rgb,ph,priority);weight=max(weight,cc.a*.92);
          }`:''}
        ${id===4?`
          if(woodRailUv.x>=0.){
            vec4 finished=texture2D(railObservation,woodRailUv);
            ph=finished.rgb;weight=finished.a;
          }
        `:''}
        float gain=obsStrength*weight;
        ${id===9?'gain*=.12;':''}
        ${id===8?'gain=0.;':''}
        result=mix(result,ph*(.966+.034*sunLit),gain);
        ${id===4||id===1||id===2||id===5||id===6?`
          vec3 N=inverseTransformDirection(normal,viewMatrix),V=normalize(cameraPosition-worldWood),L=${sunVectorGLSL};
          float fres=.024+.16*pow(1.-clamp(dot(N,V),0.,1.),4.);
          float gloss=pow(max(0.,dot(N,normalize(V+L))),${id===4?'46.':'74.'});
          float varnish=${id===4?'.49':id===1?'.36':'.12'};
          result+=varnish*fres*(.25+sunLit*.75)*(.08+gloss)*vec3(.89,.73,.56);
        `:''}
        ${id===9?`
          float l=dot(result,vec3(.28,.56,.16));
          float under=1.-smoothstep(.24,.315,worldWood.y);
          result=mix(result,vec3(l*1.06,l*.994,l*.91),.69)*(.70+.17*under);
        `:''}
        ${id===8||id===9?`
          // Below the deck the lake is the visible lower hemisphere. The three
          // linear-light measurements come from shaded water, sunlit water, and the sky.
          vec3 faceNormal=normalize(cross(dFdx(worldWood),dFdy(worldWood)));
          float exposedBelow=1.-smoothstep(.12,.54,faceNormal.y);
          if(exposedBelow>.0001){
            vec2 axis=vec2(.41600,-.90936),across=vec2(.90936,.41600);
            vec2 d=restWood.xz-vec2(-.118003,-4.459344);
            float side=dot(d,across),edge=smoothstep(.06,.48,abs(side));
            float nearEnd=1.-smoothstep(.0,.58,min(dot(d,axis),7.90045-dot(d,axis)));
            vec3 Nlocal=inverseTransformDirection(normal,viewMatrix),toEye=normalize(cameraPosition-worldWood);
            float outward=max(0.,dot(Nlocal.xz,across*sign(side))),downward=max(0.,-Nlocal.y);
            vec3 openLake=vec3(.0977,.1043,.0993),warmLake=vec3(.7653,.6298,.4878),openSky=vec3(.8614,.7716,.7057);
            float lakeView=.19+.15*edge+.055*outward;
            vec3 irradiance=mix(openLake,warmLake,lakeView)*(.77+.27*downward)+
              openSky*(.052+.155*outward*edge+.058*nearEnd);
            vec3 albedo=texture2D(map,vMapUv).rgb;
            float fibres=clamp(dot(albedo,vec3(.25,.57,.18))/.10,.48,1.45);
            float wet=1.-smoothstep(.13,.30,restWood.y+.008*(fibres-.85));
            vec3 bounce=albedo*irradiance*(1.-.17*wet);
            float glancing=pow(1.-max(0.,dot(Nlocal,toEye)),4.);
            vec3 reflectedLake=mix(openLake,warmLake,.13+.18*max(0.,dot(reflect(-toEye,Nlocal).xz,across)));
            bounce+=wet*(.018+.050*glancing)*reflectedLake*(.73+.27*fibres);
            result+=exposedBelow*bounce;
          }
        `:''}
        ${id===10?`
          float tide=.026+.009*sin(worldWood.x*27.+worldWood.z*6.3)+.004*sin(worldWood.z*59.+worldWood.y*7.);
          float saturated=1.-smoothstep(.008,.106,worldWood.y-tide);
          float value=dot(result,vec3(.28,.57,.15));
          vec3 dampWood=mix(result,vec3(value*.90,value*.88,value*.78),.41)*.71;
          result=mix(result,dampWood,saturated*.90);
        `:''}
        ${id===1?`
          float stripe=.015*sin(restWood.z*10.+restWood.x*2.9)+.005*sin(restWood.z*33.);
          float damp=1.-smoothstep(.005,.085,worldWood.y+stripe);
          vec3 VN=inverseTransformDirection(normal,viewMatrix),VE=normalize(cameraPosition-worldWood);
          float fresnel=pow(1.-clamp(dot(VN,VE),0.,1.),3.);
          result=mix(result,result*vec3(.74,.76,.74)+vec3(.007,.007,.006)*(.2+fresnel),damp);
        `:''}
        outgoingLight=result;
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey=()=> 'wood-observed-v17-'+id+'-'+mode;m.needsUpdate=true;
}

// Timber between horizontal end-centres. End grain and faces are separately illuminated.
function timber(batch,a,b,width,height,tint=1,offset=0) {
  const length=a.distanceTo(b), along=b.clone().sub(a).normalize();
  let side=V(-along.z,0,along.x);side.normalize().multiplyScalar(width/2);
  const rise=V(0,height/2,0);
  const v=(p,r,h)=>p.clone().addScaledVector(side,r).addScaledVector(rise,h);
  const lo=[v(a,-1,-1),v(b,-1,-1),v(b,1,-1),v(a,1,-1)];
  const hi=[v(a,-1,1),v(b,-1,1),v(b,1,1),v(a,1,1)];
  batch.quad(hi,square(length/1.35,width/.55,offset,.23+offset*.29),tint);
  batch.quad(lo,square(length/1.35,width/.55,offset,.40),tint*.28);
  for(let i=0;i<4;i++) {
    const j=(i+1)%4;
    let factor=(i===0?.62:i===2?.79:.58)*tint;
    batch.quad([hi[i],hi[j],lo[j],lo[i]],square((i%2?width:length)/1.35,height/.55,offset,.62+offset*.15),factor);
  }
}

function fastener(batch,p,radius,tint=1) {
  const points=[]; for(let i=0;i<6;i++) {
    const a=i*Math.PI/3;points.push(V(p.x+Math.cos(a)*radius,p.y+.0009,p.z+Math.sin(a)*radius));
  }
  for(let i=1;i<5;i++) batch.quad([points[0],points[i],points[i+1],points[0]],square(),tint);
}

function makeDock(ctx,materials) {
  const h=.35,{atY,atD}=ctx;
  const a=atY(378,784,h),b=atY(555,806,h),c=atY(693,583,h),d=atY(778,585,h);
  const base=(t,u,dy=0)=>{
    const p=a.clone().lerp(b,u).lerp(c.clone().lerp(d,u),t);p.y+=dy;return p;
  };
  const group=new THREE.Group();group.name='Weathered landing stage';ctx.scene.add(group);
  const boardLength=base(0,.5).distanceTo(base(1,.5)),deck=scanBatch(),pillars=scanBatch();
  deck.ends=[];
  const scans=scannedPier.boards.map(readScan),postsSource=scannedPier.poles.map(readScan);
  const beam=new Surface(),nails=new Surface();
  // The canoe's rising forefoot sits across the old rectangular outline. The
  // boards beside the berth have one shallow saw-cut cheek and a short return.
  // Distances are perpendicular to the surveyed east edge, in metres. Keep
  // the far and landing planks, vessel position and all cabin survey fixed.
  const edgeLength=b.distanceTo(d),eastAxis=d.clone().sub(b).normalize();
  const eastNormal=V(-eastAxis.z,0,eastAxis.x);
  const cutProfile=[[3.88,0],[4.46,.107],[5.025,.185],[5.20,.185],[5.96,0]];
  function berthCut(t){
    const s=t*edgeLength;
    for(let k=1;k<cutProfile.length;k++){
      const [s0,a]=cutProfile[k-1],[s1,b]=cutProfile[k];
      if(s>=s0 && s<=s1)return mix(a,b,(s-s0)/(s1-s0));
    }
    return 0;
  }
  function acrossWidth(t){return base(t,1).sub(base(t,0)).dot(eastNormal);}
  // The original scarfed carrier is doubled against its inboard face across
  // the berth. Both ends of the shorter rail share a full plank bay with it.
  // The new end grain therefore always overhangs timber beneath the walking face.
  const inside=.155,outside=.831,sister=.717;
  const stringerRuns=[
    [inside,.41,0,.415,0],[inside,.41,.415,.783,1],[inside,.41,.783,1,2],
    [outside,.66,0,.415,0],[outside,.66,.415,.541,1],[sister,.66,.484,.760,1],
    [outside,.66,.714,.783,1],[outside,.66,.783,1,2]
  ];
  for(const [u,shift,from,to,k] of stringerRuns){
    const lo=from+(from?.00033:0),hi=to-(to<1?.00034:0);
    const y=-.129+(k===1?.0015:0);
    timber(beam,base(lo,u,y),base(hi,u,y+.0015),.109,.187,.71+.10*seed(k+Math.floor(shift*33)),shift+.71*k);
  }
  for(let n=0;n<deckCuts.length-1;n++){
    const z0=deckCuts[n]+(.0018+seed(n*31+3)*.0013)/boardLength,z1=deckCuts[n+1]-(.002+seed(n*19+28)*.0017)/boardLength;
    const scan=scans[(n*7+Math.floor(n/4)*2)%scans.length],offset=deck.p.length/3;
    const rev=n%3===0,flip=n%4===1;
    const leftTip=(seed(621+n)-.5)*.023,rightTip=(seed(918+n)-.5)*.026;
    const lift=(seed(218+n)-.5)*.009,twist=(seed(n+51)-.5)*.012,deposit=.87+.22*seed(948+n);
    for(let i=0;i<scan.p.length/3;i++){
      const x=scan.p[3*i]/16000,y=scan.p[3*i+1]/16000,z=scan.p[3*i+2]/16000;
      const u=rev?1-x:x,v=flip?1-z:z;
      const endCut=1.-THREE.MathUtils.smoothstep(Math.min(u,1-u),.01,.095);
      const split=(.00015+.00019*seed(77+n))*endCut;
      const t=mix(z0+split,z1-split,v);
      const edgeWane=(seed(n*17)-.46)*.009*(u-.5);
      const bevel=.005*endCut*(.5+.5*Math.sin((n+.5)*4.9+v*.8));
      const cut=berthCut(t)/acrossWidth(t);
      const physicalU=u+edgeWane+mix(leftTip,rightTip,u)-u*cut;
      const p=base(t,physicalU,y*.94+lift+twist*(u-.5)-bevel);
      deck.p.push(p.x,p.y,p.z);deck.uv.push(scan.uv[i*2]/65535,scan.uv[2*i+1]/65535);
      deck.duv.push(clamp(u-u*cut),1-t);deck.ends.push(Math.min(u,1-u));deck.c.push(deposit*1.13,deposit*1.03,deposit*.92);
    }
    for(let i=0;i<scan.i.length;i+=3){
      // The reference frame maps scanned positive-Z toward world negative-Z. Keep the original outward winding.
      const q0=scan.i[i]+offset,q1=scan.i[i+1]+offset,q2=scan.i[i+2]+offset;
      if(rev!==flip)deck.i.push(q0,q1,q2);else deck.i.push(q0,q2,q1);
    }
    for(const u of [.128,.856]){
      const t=mix(z0,z1,.43+seed(n+88)*.19);
      const carrier=u>.5 && t>=.541 && t<=.714 ? sister-outside : 0;
      const p=base(t,u+carrier+(seed(20*n+u*100|0)-.5)*.026,lift+.0007);
      fastener(nails,p,.0026+seed(n+10)*.0011,.32+seed(n+2)*.21);
    }
  }
  scanGeometry(deck,group,materials.scannedBoards,'58 separate worn planks, registered upper faces');
  beam.addTo(group,materials.wood,'Deck endgrain and submerged stringers');
  const postData=[[600,764,728,.042,.005],[683,681,645,.037,-.012],[765,600,568,.043,.011],[781,585,555,.041,.009],[693,583,553,.042,.009],[651,610,565,.046,.011],[625,627,595,.034,-.006],[559,674,621,.044,-.010]];
  const posts=[],postTops=[],postRadii=[];
  postData.forEach(([u,v,tip,r,lean],idx)=>{
    const center=atY(u,v,h),top=atD(u,tip,-center.z);posts.push(center);postTops.push(top);postRadii.push(r);
    const part=postsSource[idx%3],offset=pillars.p.length/3,angle=idx*2.137+.72;
    for(let i=0;i<part.p.length/3;i++){
      const x=part.p[3*i]/16000,z=part.p[3*i+2]/16000,k=part.p[3*i+1]/16000;
      const y=mix(-.55,top.y,k),swollen=Math.min(1.055-.055*THREE.MathUtils.smoothstep(y,.01,.16),1/Math.max(.001,Math.hypot(x,z)));
      const bx=(x*Math.cos(angle)-z*Math.sin(angle))*r*swollen,bz=(x*Math.sin(angle)+z*Math.cos(angle))*r*swollen;
      const amount=(y-h)/(top.y+.55),wet=.21+.79*THREE.MathUtils.smoothstep(y,.015,.155);
      pillars.p.push(center.x+bx+lean*amount,y,center.z+bz-lean*.44*amount);
      pillars.uv.push(part.uv[i*2]/65535,part.uv[i*2+1]/65535);pillars.duv.push(0,0);
      pillars.c.push(.94*wet,.93*wet,.84*wet);
    }
    for(const k of part.i)pillars.i.push(k+offset);
  });
  scanGeometry(pillars,group,materials.scannedPoles,'Adzed timber pilings with wet toes');
  nails.addTo(group,materials.iron,'Iron nailheads');
  const knot0=postTops[4].clone(),knot1=postTops[5].clone();knot0.y-=.16;knot1.y-=.12;
  const sag=knot0.clone().lerp(knot1,.5);sag.y-=.095;
  const curve=new THREE.QuadraticBezierCurve3(knot0,sag,knot1);
  const cord=texture('cord');
  const rope=new THREE.Mesh(new THREE.TubeGeometry(curve,32,.0059,7,false),new THREE.MeshStandardMaterial({map:cord,color:0xa2947b,roughness:.97}));
  rope.name='Slack rope between far-left piles';rope.material.userData.bridgeSurface='rope';group.add(rope);
  return {group,base,a,b,c,d,posts,postTops,postRadii,boardLength,berthCut,cutProfile,
    eastEdgeAt:t=>base(t,1-berthCut(t)/acrossWidth(t))};
}

function makeBoat(ctx,materials,dock) {
  const {atY}=ctx;
  const bow=atY(731,613,.46),stern=atY(912,716,.44);
  const near=stern.clone(),far=bow.clone();near.y=far.y=0;
  const axis=near.clone().sub(far),length=axis.length();axis.normalize();
  const yaw=Math.atan2(axis.x,axis.z);
  const boat=new THREE.Group();boat.name='Red cedar lake canoe';
  boat.rotation.order='YXZ';boat.position.copy(far.clone().lerp(near,.5));boat.rotation.y=yaw;
  ctx.scene.add(boat);boat.updateMatrixWorld(true);
  const center=boat.position.clone(), across=V(axis.z,0,-axis.x);
  const neutral=p=>center.clone().addScaledVector(axis,p.z).addScaledVector(across,p.x).add(V(0,p.y,0));
  const floorY=-.061,half=t=>Math.max(0,station(beamSamples,t)), rim=t=>station(sheerSamples,t);
  const keel=t=>-.146+.042*Math.pow(Math.abs(2*t-1),2.6);
  // The keel shortens below the stems, matching the photographs of the raked ends.
  const point=(t,v,side,inset=0)=>{
    const end=2*t-1,curve=Math.pow(Math.sin(v*Math.PI*.5),.56);
    const neck=Math.min(1,half(t)/.09);
    const fuller=.031*Math.pow(Math.sin(Math.PI*t),1.6)*Math.exp(-Math.pow((v-.27)/.19,2))*
      THREE.MathUtils.smoothstep(t,.17,.33)*(1-THREE.MathUtils.smoothstep(t,.71,.86));
    const w=Math.max(0,half(t)*curve+fuller-inset*neck*Math.sqrt(v));
    const dz=-Math.sign(end)*Math.pow(Math.abs(end),5)*mix(.303,.145,t)*Math.pow(1-v,2.72);
    const y=mix(keel(t),rim(t),v)+inset*(1-v);
    // The worn, raked near stem turns slightly to port below the bottom strake.
    // Its measured water intersection is forward of the previous neutral keel line.
    const lower=(1.-THREE.MathUtils.smoothstep(v,.14,.36))*THREE.MathUtils.smoothstep(t,.77,1);
    const shoulder=.0054*Math.exp(-Math.pow((y-.153)/.061,2))*THREE.MathUtils.smoothstep(t,.94,1);
    return V(side*w-.064*lower+shoulder,y,(t-.5)*length+dz+.054*lower);
  };
  const exterior=new Surface(),interior=new Surface(),ribSheet=new Surface(),rimSheet=new Surface(),floorSheet=new Surface(),seatSheet=new Surface(),rivets=new Surface();
  const N=68,S=7;
  for(const side of [-1,1])for(let k=0;k<S;k++){
    const vlo=(k/S)**1.22,vhi=((k+1)/S)**1.22,uvOff=seed(602+k+side*5);
    for(let i=0;i<N;i++) {
      const a=i/N,b=(i+1)/N;
      // A narrow bevel follows both edges of each clinker strake and makes its shadow visible in oblique views.
      const levels=[vlo,mix(vlo,vhi,.045),mix(vlo,vhi,.945),vhi];
      for(let r=0;r<3;r++){
        const y0=levels[r],y1=levels[r+1],seam=(r===0?.77:r===2?.92:1);
        const p=[point(a,y0,side),point(b,y0,side),point(b,y1,side),point(a,y1,side)];
        const bump=(q,j)=>{q.x+=side*(r===0&&j<2?-.0006:.0023)*Math.min(1,Math.abs(q.x)/.13);};
        p.forEach(bump);
        const wear=q=>seam*(.30+.70*clamp((q.y+.008)/.165))*(side>0?1.12:1);
        exterior.quad(p,[[a,y0],[b,y0],[b,y1],[a,y1]],p.map(wear));
        const inP=[point(a,y0,side,.012),point(b,y0,side,.012),point(b,y1,side,.012),point(a,y1,side,.012)];
        inP.forEach((p,j)=>p.x-=side*(r===0&&j<2?.0003:.0022)*Math.min(1,Math.abs(p.x)/.12));
        const interiorShade=q=>{
          const t=clamp(q.z/length+.5);
          const bowShade=.18+.82*THREE.MathUtils.smoothstep(t,.085,.455);
          const hatchShade=1-.31*THREE.MathUtils.smoothstep(t,.77,.99);
          const bay=((t-.065)/.0482+9.5)%1-.5;
          const ribShade=1-.35*Math.exp(-((bay+.14)**2)/.037);
          return seam*(.32+.60*clamp((q.y+.1)/.42))*(side<0?1.12:.96)*(.29+.71*bowShade)*hatchShade*ribShade;
        };
        const lo=(k*.149+uvOff*.22),vscale=1.33;
        interior.quad(inP,[[a*2.03+uvOff,lo+y0*vscale],[b*2.03+uvOff,lo+y0*vscale],[b*2.03+uvOff,lo+y1*vscale],[a*2.03+uvOff,lo+y1*vscale]],inP.map(interiorShade));
      }
    }
  }
  // Bent ribs conform to the interior from the keel up to each gunwale.
  const ribStations=[];
  for(let j=0;j<19;j++){
    const t=.065+j*.0482;ribStations.push(t);
    const w=.0125+.003*seed(j*17),dt=w/length;
    for(const side of [-1,1])for(let k=0;k<12;k++) {
      const y0=.038+k*.0785,y1=y0+.0785;
      const a=point(t-dt,y0,side,.031),b=point(t+dt,y0,side,.031),c=point(t+dt,y1,side,.031),d=point(t-dt,y1,side,.031);
      const shade=(side<0?.83:.59)*(.68+.42*y0)*(.61+.39*THREE.MathUtils.smoothstep(t,.08,.45)), off=(j*.162)%1;
      ribSheet.quad([a,d,c,b],[[y0*.51,off],[y1*.51,off],[y1*.51,off+.083],[y0*.51,off+.083]],shade);
      ribSheet.quad([d,a,point(t-dt,y0,side,.012),point(t-dt,y1,side,.012)],square(y1-y0,.034),shade*.64);
      ribSheet.quad([b,c,point(t+dt,y1,side,.012),point(t+dt,y0,side,.012)],square(y1-y0,.034),shade*.78);
    }
  }
  // Chamfered continuous hardwood gunwales. The light upper edge is under two centimetres wide.
  for(const t of ribStations){
    for(const side of [-1,1]){
      for(const v of [.21,.38,.55,.72,.89]){
        const n=point(t,v,side,.034);
        const longitudinal=V(0,0,1),vertical=point(t,v+.017,side,.034).sub(point(t,v-.017,side,.034)).normalize();
        const radius=.0025+.0006*seed(Math.floor(t*1000+v*197));
        const disk=(u,w,raise)=>n.clone().addScaledVector(longitudinal,u*radius).addScaledVector(vertical,w*radius).add(V(-side*raise,0,0));
        for(let j=0;j<6;j++){
          const a0=Math.PI*j/3,a1=Math.PI*(j+1)/3;
          rivets.quad([disk(0,0,.0011),disk(Math.cos(a0),Math.sin(a0),0),disk(Math.cos(a1),Math.sin(a1),0),disk(0,0,.0011)],
            square(),.60+.17*Math.cos((a0+a1)*.5-.58));
        }
      }
    }
  }
  // Rub rails lose varnish on the rounded outer shoulder; their local wood colour
  // remains constant as the view changes. Reflections are evaluated with the active view.
  const railTint=(side,t,k)=>{
    const worn=.35+.24*Math.sin(14.2*t+side*.7)+.22*Math.sin(38.1*t-.81*side)+.15*Math.sin(97*t+3.1);
    const surface=[.58,.74,.91,1.16,1.05,.71,.48,.42][k];
    return [surface*(.79+.31*worn),surface*(.77+.36*worn),surface*(.75+.43*worn)];
  };
  const section=[[-.016,-.015],[-.017,-.005],[-.014,.004],[-.008,.009],[.004,.010],[.013,.005],[.016,-.007],[.008,-.018]];
  for(const side of [-1,1])for(let i=0;i<N;i++){
    const a=i/N,b=(i+1)/N;
    const sectionPoint=(t,k)=>{
      const w=half(t);let p=point(t,1,side),[dw,dy]=section[k];
      const wear=.93+.06*Math.sin(t*16.8+side)+.025*Math.sin(t*67.4+side*2.3);
      p.x+=side*dw*(.44+.56*Math.min(1,w/.04))*wear;
      p.y+=dy*(.90+.1*Math.sin(t*31.4+side))+.0008*Math.sin(t*91.7+side);return p;
    };
    for(let k=0;k<section.length;k++){
      const l=(k+1)%section.length,sa=railTint(side,a,k),sb=railTint(side,b,k),shade=[sa,sb,sb,sa];
      rimSheet.quad([sectionPoint(a,k),sectionPoint(b,k),sectionPoint(b,l),sectionPoint(a,l)],[[a*2.25,k*.1],[b*2.25,k*.1],[b*2.25,(k+1)*.1],[a*2.25,(k+1)*.1]],shade);
    }
    if(i%5===2 && a>.08 && a<.93){
      const at=sectionPoint(a,3);fastener(rivets,at,.0026,1.06);
    }
  }
  // Seven longitudinal floorboards rest on the ribs. The intended footfall sits in the clear bay before the middle thwart.
  for(let j=0;j<7;j++)for(let i=0;i<40;i++){
    const t0=.095+i*.0196,t1=t0+.0196;
    const plank=(t,q)=>{
      const x=half(t)*.59*q;
      return V(x,floorY+.0035*Math.abs(q)**2+.009*Math.abs(2*t-1)**3,(t-.5)*length);
    };
    const lo=-1+j*2/7+.009,hi=-1+(j+1)*2/7-.009,off=seed(50+j);
    floorSheet.quad([plank(t0,lo),plank(t1,lo),plank(t1,hi),plank(t0,hi)],[[t0*1.7+off,lo*.41+off],[t1*1.7+off,lo*.41+off],[t1*1.7+off,hi*.41+off],[t0*1.7+off,hi*.41+off]],.65+seed(71+j)*.31);
  }
  const boardPositions=[
    {t:.255,breadth:.177,height:.2134,kind:'seat'},
    {t:.416,breadth:.032,height:.13795,kind:'thwart'},
    {t:.5433,breadth:.037,height:.1769,kind:'thwart'},
    {t:.6373,breadth:.032,height:.1564,kind:'thwart'}
  ];
  for(const [j,q] of boardPositions.entries()){
    const v=clamp((q.height-keel(q.t))/(rim(q.t)-keel(q.t)));
    const a=point(q.t,v,-1,.0135),b=point(q.t,v,1,.0135);a.y=b.y=q.height;
    const broad=q.kind==='seat';
    const thickness=broad?.032:.025,span=a.distanceTo(b);
    const profile=broad?[[-.50,-.37],[-.52,.11],[-.46,.43],[-.33,.50],[.36,.50],[.47,.45],[.51,.18],[.50,-.35],[.41,-.50],[-.40,-.50]]:
      [[-.52,-.13],[-.48,.26],[-.29,.48],[-.08,.53],[.21,.48],[.44,.28],[.50,.02],[.42,-.31],[0,-.50],[-.36,-.40]];
    const tones=broad?[[44,29,23],[71,55,48],[88,70,63],[82,66,61],[146,112,94],[170,133,110],[62,37,26],[38,25,21],[29,20,17],[35,23,19]]:
      [[45,29,23],[81,60,47],[105,83,66],[138,111,89],[148,117,93],[108,77,56],[68,45,34],[41,27,23],[33,22,19],[38,24,20]];
    const refCedar=new THREE.Color().setRGB(75/255,55/255,44/255,THREE.SRGBColorSpace);
    const bandPoint=(u,k)=>{
      const p=a.clone().lerp(b,u);
      p.y+=.0017*Math.sin(u*7+.89*j)+.0013*Math.sin(u*15+j*2.1);
      const taper=broad?1:.85+.15*Math.pow(Math.abs(2*u-1),1.5);
      p.z+=profile[k][0]*q.breadth*taper;
      p.y+=profile[k][1]*thickness*taper-.0029*(1-Math.pow(2*u-1,2));
      return p;
    };
    const bandTint=(u,k)=>{
      const tint=tones[k],rightShadow=1-(j===1?.63:.34)*THREE.MathUtils.smoothstep(u,.62,.96);
      const c=new THREE.Color().setRGB(rightShadow*tint[0]/255,rightShadow*tint[1]/255,rightShadow*tint[2]/255,THREE.SRGBColorSpace);
      return [c.r/refCedar.r,c.g/refCedar.g,c.b/refCedar.b];
    };
    for(let section=0;section<10;section++){
      const u0=section/10,u1=(section+1)/10;
      for(let k=0;k<profile.length;k++){
        const l=(k+1)%profile.length,sa=bandTint(u0,k),sb=bandTint(u1,k);
        seatSheet.quad([bandPoint(u0,k),bandPoint(u1,k),bandPoint(u1,l),bandPoint(u0,l)],
          [[u0*span/1.1+j*.17,k*.009],[u1*span/1.1+j*.17,k*.009],[u1*span/1.1+j*.17,(k+1)*.009],[u0*span/1.1+j*.17,(k+1)*.009]],[sa,sb,sb,sa]);
      }
    }
    if(q.kind==='seat'){
      for(const dz of [-.043,.015]) {
        const lineA=a.clone(),lineB=b.clone();
        lineA.z+=dz;lineB.z+=dz;lineA.y+=.0172;lineB.y+=.0172;
        timber(seatSheet,lineA,lineB,.0017,.0009,.48,j*.23);
      }
    }
    for(const k of [0,1]){
      const p=a.clone().lerp(b,k===0?.058:.942);p.y+=q.kind==='seat'?.0175:.0133;
      fastener(rivets,p,.0032,1.08);
    }
  }
  // End decks and laminated stems are continuous pieces of wood down to the keel.
  for(const close of [false,true]) {
    const tf=q=>close?1-q:q;
    const sectionCount=6;
    for(let i=0;i<sectionCount;i++){
      const a=tf(.003+i*.011),b=tf(.003+(i+1)*.011);
      const deckP=(t,side)=>{const p=point(t,1,side,.017);p.y-=.017;return p;};
      seatSheet.quad([deckP(a,-1),deckP(b,-1),deckP(b,1),deckP(a,1)],[[a*2,.36],[b*2,.36],[b*2,.58],[a*2,.58]],close?.86:1.02);
    }
    const t=close?1:0;
    for(let j=0;j<20;j++){
      const v0=j/20,v1=(j+1)/20, a=point(t,v0,1),b=point(t,v1,1);
      const q=(p,x,dz)=>V(p.x+x,p.y,p.z+(close?1:-1)*dz);
      for(const [m,n,dzA,dzB,shade] of [[-.008,-.009,-.001,.012,.70],[-.009,.009,.012,.012,.93],[.009,.008,.012,-.001,.75]]){
        const segment=[q(a,m,dzA),q(b,m,dzA),q(b,n,dzB),q(a,n,dzB)];
        if(b.y<rim(t)-.095)exterior.quad(segment,[[.985,v0],[.987,v1],[.991,v1],[.991,v0]],shade*(.62+.28*clamp((b.y+.005)/.19)));
        else rimSheet.quad(segment,square(v1-v0,.105),shade);
      }
    }
  }
  for(const end of [0,1]){
    const tip=point(end,1,1),close=end===1;
    const cap=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:close?0x4b3328:0x8a6751}));
    cap.scale.set(.011,.013,close?.035:.021);cap.position.copy(tip);cap.position.y+=.005;
    cap.position.z+=(close?1:-1)*.003;boat.add(cap);
  }
  exterior.addTo(boat,materials.oxide,'Seven red-oxide strakes below the sheer');
  interior.addTo(boat,materials.cedar,'Oiled cedar planking facing the cockpit');
  ribSheet.addTo(boat,materials.cedar,'Nineteen steam-bent ribs');
  const rails=rimSheet.addTo(boat,materials.rail,'Rub rails, stems and bright gunwales');
  // Resolve all measured views into the gunwale's continuous wood coordinates.
  // The short stem caps retain their own measured end-grain observations.
  const railUv=new Float32Array(rails.geometry.attributes.position.count*2).fill(-1);
  let vertex=0;
  for(let side=0;side<2;side++)for(let i=0;i<N;i++)for(let k=0;k<8;k++){
    for(const [end,ridge] of [[i,k],[i+1,k],[i+1,k+1],[i,k+1]]){
      railUv[2*vertex]=(4+2040*end/N)/2048;
      railUv[2*vertex+1]=1-(side*80+4+72*ridge/8)/160;
      vertex++;
    }
  }
  rails.geometry.setAttribute('railUv',new THREE.Float32BufferAttribute(railUv,2));
  floorSheet.addTo(boat,materials.cedar,'Open footwell and longitudinal floorboards');
  seatSheet.addTo(boat,materials.cedar,'Stern sheets, seat and thwarts');
  rivets.addTo(boat,materials.brass,'Bronze fastenings');

  // Solve the longitudinally raked hull against the neutral water plane and interpolate in fixed local-z stations.
  const waterSection=[];
  for(let i=0;i<=180;i++){
    const t=i/180,v=-keel(t)/(rim(t)-keel(t)),p=point(t,v,1),q=point(t,v,-1);
    // A conservative inscribed mask follows asymmetric stem detail without cutting outside the hull.
    waterSection.push({z:p.z,w:Math.max(0,Math.min(p.x,-q.x))});
  }
  function waterlineAt(z) {
    if(z<waterSection[0].z || z>waterSection[waterSection.length-1].z)return 0;
    let lower=0,upper=waterSection.length-1;
    while(upper-lower>1){
      const middle=(lower+upper)>>1;
      if(waterSection[middle].z<=z)lower=middle;else upper=middle;
    }
    const a=waterSection[lower],b=waterSection[upper];
    return mix(a.w,b.w,(z-a.z)/(b.z-a.z));
  }
  const waterlineHalfWidths=Array.from({length:13},(_,i)=>waterlineAt((i/12-.5)*length));
  const landingStation=.355,entryStation=.337;
  const portEntry=neutral(point(entryStation,1,-1));
  const dockVector=dock.d.clone().sub(dock.b);
  const frac=clamp(portEntry.clone().sub(dock.b).dot(dockVector)/dockVector.lengthSq());
  const dockExit=dock.b.clone().lerp(dock.d,frac);
  const landing=neutral(V(-.018,floorY+.0013,(landingStation-.5)*length));
  let maxHalf=0,maxBeamStation=0;
  for(let i=0;i<=1024;i++){
    const value=half(i/1024);
    if(value>maxHalf){maxHalf=value;maxBeamStation=i/1024;}
  }
  return {boat,boatLength:length,boatWidth:2*maxHalf,outerGunwaleWidth:2*(maxHalf+.016),maxBeamStation,boatYaw:yaw,boatAxis:axis,boatAcross:across,boatOrigin:center,
    portEntry,dockExit,dockExitFraction:frac,landing,landingStation,entryStation,bow,stern,
    rimAt:(t,side)=>neutral(point(clamp(t),1,side)),halfWidthAt:half,gunwaleHeightAt:rim,boardPositions,ribStations,
    waterlineHalfWidths,waterlineAt,waterlineMinZ:waterSection[0].z,waterlineMaxZ:waterSection[waterSection.length-1].z,neutralTransform:neutral};
}

export function buildDockBoat(ctx) {
  const materials={scannedBoards:pierMaterial('planks'),scannedPoles:pierMaterial('poles'),wood:vesselWood('stringer','vessel-normal',.93),cedar:vesselWood('cockpit-fibres'),rail:vesselWood('rubrail-weather','vessel-normal',.41),oxide:vesselWood('paint','vessel-normal',.52),
    iron:new THREE.MeshBasicMaterial({color:0x4b4438,vertexColors:true,side:THREE.DoubleSide}),
    brass:new THREE.MeshBasicMaterial({color:0x826345,vertexColors:true,side:THREE.DoubleSide})};
  const dock=makeDock(ctx,materials), craft=makeBoat(ctx,materials,dock);
  if(ctx.renderer){
    const cap=vesselObservations(),staticW=new THREE.Matrix4(),rest=craft.boat.matrixWorld.clone();
    const types=[['strakes',1],['planking facing',2],['bent ribs',3],['Rub rails',4],['floorboards',5],['seat and thwarts',6],
      ['fastenings',7],['planks, registered',8],['submerged stringers',9],['pilings',10],['pile crowns',10]];
    [craft.boat,dock.group].forEach(group=>group.children.forEach(object=>{
      const id=types.find(([name])=>object.name.includes(name))?.[1];if(id)observedSurface(object,id,group===craft.boat,cap,group===craft.boat?rest:staticW);
    }));
  }
  return {...craft,dock:dock.group,dockHeight:.35,dockStart:dock.base(0,.5),dockEnd:dock.base(1,.5),dockPoint:dock.base, dockLength:dock.boardLength,
    dockEastEdgeAt:dock.eastEdgeAt,dockBerthProfile:dock.cutProfile,
    dockCorners:[dock.a,dock.b,dock.c,dock.d],posts:dock.posts,postTops:dock.postTops,postRadii:dock.postRadii,
    landmarks:{dockNearLeft:dock.a,dockNearRight:dock.b,dockFarLeft:dock.c,dockFarRight:dock.d,bow:craft.bow,stern:craft.stern,
      portMid:craft.rimAt(.5,-1),starboardMid:craft.rimAt(.5,1)}};
}
