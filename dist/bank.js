import * as THREE from './three.module.js';
import {atY, atD, pix, pitch, smooth, sunDirection, sunVectorGLSL} from './calibration.js';
import {scans} from './art/bank-scans.js';
import {boulders} from './art/bank-boulder-profiles.js';
import {returnSurvey} from './art/bank-second-view.js';
import {bedSamples} from './art/bank-elevations.js';
import {botanics} from './art/bank-herbarium.js';
import {approachSurvey} from './art/bank-third-view.js';
import {ledges} from './art/bank-ledge-profiles.js';
import {entrySamples} from './art/bank-entry-elevations.js';
import {shoots} from './art/bank-spit-foliage.js';

// The shoreline is traced at still water. Distances below are in scene metres.
const shorelinePixels = [ [1090,1040], [977,974], [955,948], [921,930], [884,921], [824,921], [759,903], [743,883], [719,862], [688,851], [647,847], [613,835], [573,816], [542,805], [482,796], [428,786], [382,777], [359,765], [334,750], [311,742], [280,729], [253,711], [214,700], [186,684], [212,675], [248,664], [272,659], [302,653], [342,642], [369,634], [403,628], [423,621], [455,615], [477,609], [505,604], [532,597], [549,591], [572,581], [590,575], [614,568], [637,563], [655,557], [639,552], [619,545], [595,533], [559,518], [526,505], [488,496], [461,490], [533,488], [601,486], [681,484], [704,482], [661,476], [611,471] ];
const shoreNodes = shorelinePixels.map(([u,v])=>{const p=atY(u,v,0);return [-p.z,p.x];});
shoreNodes.push([112,6],[143,-22],[190,-64]);
shoreNodes.unshift([-32,32],[-6,14],[0,6.7],[2.5,3.1]);
const mix=(a,b,u)=>a+(b-a)*u;
const ease=(a,b,x)=>smooth(a,b,x);
function edgeAt(d) {
  if(d<=shoreNodes[0][0]) return shoreNodes[0][1];
  if(d>=shoreNodes.at(-1)[0]) return shoreNodes.at(-1)[1];
  let lo=0,hi=shoreNodes.length-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(shoreNodes[m][0]>d)hi=m;else lo=m;}
  const a=shoreNodes[lo], b=shoreNodes[hi];
  const u=(d-a[0])/(b[0]-a[0]);
  return mix(a[1],b[1],u)+.025*Math.sin(u*Math.PI)*Math.sin(d*5.71);
}
function shoreDistance(x,d){
  const edge=edgeAt(d), step=.19;
  // The metric correction preserves beach slope where the waterfront turns obliquely.
  const derivative=(edgeAt(d+step)-edgeAt(d-step))/(step*2);
  return (edge-x)/Math.sqrt(1+derivative*derivative);
}
const entranceEarthEdge=[[118,681],[140,691.2],[159,693.2],[176,700.0],[194,700.8],[215,707.4],[235,715.1],[259,725],[278,737],[302,748],[326,759],[342,769],[357,774],[372,783],[384,791],[399,795],[414,799],[437,804],[463,806.8],[489,809],[516,812],[541,817],[563,823]];
const nearEarthEdge=[[591,836],[613,838],[633,851],[653,862],[678,877],[702,890],[733,905],[756,913],[779,920],[805,925],[831,926],[853,930],[874,935],[905,944],[928,956],[955,968],[982,983],[1100,1051]];
const nearPlantEdge=[[340,744],[378,765],[440,785],[510,800],[554,798],[588,800],[612,818],[638,831],[657,833],[687,838],[708,846],[741,869],[769,879],[795,887],[824,883],[856,899],[891,901],[926,919],[975,942],[1090,1008]];
function silhouetteY(points,u){let i=1;while(i<points.length-1 && points[i][0]<u)i++;const a=points[i-1],b=points[i];return mix(a[1],b[1],(u-a[0])/(b[0]-a[0]));}
const terrainSamples=new Int8Array(Uint8Array.from(atob(bedSamples),c=>c.charCodeAt(0)).buffer);
function moraineHeight(x,d){
  const u=(x+11)*25,v=(d-5)*25;if(u<=0||v<=0||u>=400||v>=500)return 0;
  const i=Math.floor(u),j=Math.floor(v),k=j*401+i,fx=u-i,fz=v-j;
  return mix(mix(terrainSamples[k],terrainSamples[k+1],fx),mix(terrainSamples[k+401],terrainSamples[k+402],fx),fz)/490;
}
const entranceSamples=new Int8Array(Uint8Array.from(atob(entrySamples),c=>c.charCodeAt(0)).buffer);
function entranceRelief(x,d){const u=(x+3.6)*40,v=(d-2.5)*40;if(u<=0||v<=0||u>=176||v>=216)return 0;
 const i=Math.floor(u),j=Math.floor(v),a=j*177+i;return mix(mix(entranceSamples[a],entranceSamples[a+1],u-i),mix(entranceSamples[a+177],entranceSamples[a+178],u-i),v-j)/540;}
const peninsulaBack=[[486,499.1],[508,505.0],[525,510.5],[542,514.0],[555,518.4],[571,524.0],[586,529.4],[600,533.9],[612,539.8],[623,546.4],[641,552.5],[655,556.7],[667,559.]];
const inletShootLimit=[[146,672],[160,678],[176,683.4],[186,687.0],[201,691.8],[219,695.4],[235,694.4],[248,694.8],[263,704.9],[275,710.9]];
const farFoot=[[583,486.6],[608,486.1],[630,485.6],[653,484.9],[674,484.3],[689,483.7],[699,483.1],[707,482.2],[711,481.9]];
const farSpine=[[583,465.9],[605,465.9],[619,464.9],[633,465.6],[644,465.9],[650,468.7],[655,471.6],[662,473.3],[670,473.7],[676,474.8],[684,475.2],[690,477.7],[695,478.4],[701,479.7],[708,481.4],[711,481.9]];
function farShorePoint(u,v,behind=0){const water=atY(u,silhouetteY(farFoot,u),0);return atD(u,v,-water.z+behind);}
const spitTop=[[508,459],[539,461],[564,465.4],[588,468.4],[606,470.7],[622,473.3],[637,475.7],[653,477.2],[671,478.8],[684,480.3],[697,481.2],[711,482.2],[739,483.2],[770,484.5]];
export function groundY(x,z) {
  const d=-z,originalDistance=shoreDistance(x,d);
  // The narrow foreshores between individual stones lie below their topographic envelope.
  const pocket=(.068+.060*Math.sin(d*5.13)**2+.050*Math.sin(d*9.63-.22)**2)*ease(8.06,8.77,d)*(1-ease(15.82,17.1,d))*(1-ease(.04,.58,originalDistance));
  const inlet=(.031+.067*(.5+.5*Math.cos(d*6.67+.19))**2+.037*(.5+.5*Math.sin(d*10.27))**2)*ease(4.84,5.42,d)*(1-ease(7.49,8.04,d))*(1-ease(.025,.38,originalDistance));
  const distance=originalDistance-pocket-inlet;
  if(distance<=0)return Math.max(-2.3,distance*.63)-.015;
  const back=ease(7.6,13.4,d), far=ease(25,63,d);
  const plateau=mix(.405,1.44,back)+.36*far;
  const rim=ease(0,back*1.52+.93,distance);
  const undulation=(.044*Math.sin(x*1.18+z*.38)+.035*Math.sin(z*1.92-x*.47)+.017*Math.sin(z*4.55+x*3.1))*(1-.50*back);
  const woodland=ease(6,17,distance)*(.43*Math.sin(x*.27-z*.19)+.77*far+.4);
  const landingRadius=((x+1.65)/3.45)**2+((d-15.1)/4.0)**2;
  const cabinRadius=((x+4.7)/5.1)**2+((d-18.4)/4.7)**2;
  const cabinCut=Math.max(.48*(1-ease(.43,1.60,landingRadius)),.29*(1-ease(.65,1.5,cabinRadius)));
  const stepLanding=.078*Math.exp(-1.34*((x+.933)**2+(d-14.172)**2));
  let h=-.015+(plateau+undulation+woodland-cabinCut+stepLanding)*rim;
  // The exposed earth behind the foreground granite falls away into a shallow notch.
  if(x>.41 && d>1.5 && d<6.08){const dep=d*Math.cos(pitch)-(h-2.05)*Math.sin(pitch);const u=487.5+915*x/dep;
    if(u>613&&u<1080){const upper=atD(u,silhouetteY(nearEarthEdge,u)+1.5,d).y;h=mix(h,Math.min(h,upper),ease(613,665,u));}}
  if(d>32.5&&d<125&&x>2.1){
    const q=d*Math.cos(pitch)-(h-2.05)*Math.sin(pitch),u=487.5+915*x/q;
    if(u>527&&u<770){const cap=atD(u,silhouetteY(spitTop,u)+.75,d).y;
      const amount=ease(32.5,46.,d)*(1-ease(105.,125.,d))*ease(527.,592.,u)*(1-ease(738.,770.,u));h=mix(h,Math.min(h,cap),amount);}
  }
  h+=moraineHeight(x,d)+entranceRelief(x,d)*ease(-.001,.18,distance);
  if(d>2.7&&d<8.29&&x<.48){
    const q=d*Math.cos(pitch)-(h-2.05)*Math.sin(pitch),u=487.5+915*x/q;
    if(u>118&&u<563){const limit=atD(u,silhouetteY(entranceEarthEdge,u)+.8,d).y;
      const weight=ease(118.,159.,u)*(1-ease(526.,563.,u))*ease(2.7,3.5,d)*(1-ease(7.75,8.29,d));h=mix(h,Math.min(h,limit),weight);}
  }
  // Beyond the cottage the rear bank drops into the channel, before rising again on the distant spit.
  if(d>14.3&&d<47.5&&x>-.39){const q=d*Math.cos(pitch)-(h-2.05)*Math.sin(pitch),u=487.5+915*x/q;
    if(u>486&&u<669){const maxY=atD(u,silhouetteY(peninsulaBack,u)+.58,d).y;
      const amount=ease(14.3,16.15,d)*(1-ease(41.5,47.5,d))*ease(486.,527.,u)*(1-ease(650.,669.,u));h=mix(h,Math.min(h,maxY),amount);}}
  // The wooded swale is below the observer; a broad plateau at camera height would wrongly cross the trunks.
  if(x<-7.41&&d>13.5&&d<83.){const q=d*Math.cos(pitch)-(h-2.05)*Math.sin(pitch),u=487.5+915*x/q;
    const w=(1-ease(-10.0,-7.41,x))*ease(13.5,17.60,d)*(1-ease(62.,83.,d))*(1-ease(60.,113.,u));
    const woodlandFloor=1.00+.13*Math.sin(x*.73+d*.25)+.13*Math.cos(d*.49-x*.16)+.07*ease(19.,40.,d);
    h=mix(h,Math.min(woodlandFloor,h),w);
  }
  return h;
}
function groundHit(u,v){
  // Solve along the principal ray, including a ray that first crosses the open inlet.
  let lo=.24,hi=lo, last;
  for(let d=.28;d<126;d+=d*.016+.028){
    const p=atD(u,v,d), gap=p.y-groundY(p.x,p.z);
    if(gap<=0 && last>0){hi=d;break;}
    lo=d;last=gap;
  }
  if(hi<=lo){const p=atY(u,v,.25);p.y=groundY(p.x,p.z);return p;}
  for(let i=0;i<17;i++){const m=(lo+hi)*.5,p=atD(u,v,m);if(p.y>groundY(p.x,p.z))lo=m;else hi=m;}
  const p=atD(u,v,(hi+lo)*.5);p.y=groundY(p.x,p.z);return p;
}
function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function addGeometry(positions,indices,attributes={}){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);
  for(const [name,[values,dim]] of Object.entries(attributes))g.setAttribute(name,new THREE.Float32BufferAttribute(values,dim));
  g.computeVertexNormals();return g;
}
function terrainMesh(){
  const positions=[],index=[],coarse=[-7,-3,-1.8,-1,-.55,-.24,-.11,-.045,0,.05,.13,.25,.41,.60,.81,1.05,1.35,1.7,2.1,2.6,3.2,3.9,4.8,5.9,7.2,8.9,11,14,18,24,32,46,65,89,125];
  const fine=[...coarse.filter(v=>v<-.3)];for(let x=-.3;x<8;x+=.061)fine.push(x);fine.push(...coarse.filter(v=>v>=8));
  for(const [first,last,step,cols] of [[-32,2.45,.20,coarse],[2.45,7.9,.044,fine],[7.9,25,.063,fine],[25,81,.31,coarse],[81,190,1.17,coarse]]){
    const rows=new Set([first,last]);for(const [d] of shoreNodes)if(d>first&&d<last)rows.add(d);
    for(let d=first;d<last;d+=step)rows.add(Math.round(d*10000)/10000);
    const sorted=[...rows].sort((a,b)=>a-b),offset=positions.length/3;
    for(const d of sorted){const e=edgeAt(d);for(const c of cols){const x=e-c;positions.push(x,groundY(x,-d),-d);}}
    for(let r=0;r<sorted.length-1;r++)for(let c=0;c<cols.length-1;c++){
      const a=offset+r*cols.length+c,b=a+1,e=a+cols.length,f=e+1;index.push(a,e,b,b,e,f);
    }
  }
  return addGeometry(positions,index);
}
// A second, surveyed camera supplies material detail at the boat. Both projections live in world space.
const secondCapture=`uniform mat4 approachVP;uniform vec3 approachEye;uniform sampler2D approachPhoto;uniform mat4 returnVP;uniform vec3 returnEye,observer;uniform sampler2D returnPhoto;
vec4 approachSample(vec3 world){vec4 clip=approachVP*vec4(world,1.);vec2 uv=.5+.5*clip.xy/clip.w;vec2 inside=smoothstep(vec2(-.001),vec2(.006),uv)*smoothstep(vec2(-.001),vec2(.006),1.-uv);vec3 src=approachEye-world,curr=observer-world;
 float angle=1.-dot(normalize(src),normalize(curr));float proximity=1.-smoothstep(.08,3.79,distance(observer,approachEye));
 float support=(1.-smoothstep(.009,.22,angle))*(1.-smoothstep(1.18,2.40,length(src)/max(.012,length(curr))));vec4 image=texture2D(approachPhoto,clamp(uv,0.,1.));image.a*=inside.x*inside.y*step(.03,clip.w)*proximity*support;return image;}
vec4 returnSample(vec3 world){vec4 clip=returnVP*vec4(world,1.);vec2 uv=.5+.5*clip.xy/clip.w;
 vec2 inbounds=smoothstep(vec2(-.001),vec2(.005),uv)*smoothstep(vec2(-.001),vec2(.005),1.-uv);
 vec3 initial=vec3(0.,2.05,0.),rr=returnEye-world,vr=observer-world;
 float srcRange=length(rr),curRange=length(vr),angle=1.-dot(rr/max(.001,srcRange),vr/max(.001,curRange));
 float support=(1.-smoothstep(.010,.229,angle))*(1.-smoothstep(1.31,2.54,srcRange/max(.01,curRange)));
 float first=distance(observer,initial),last=distance(observer,returnEye),along=first/max(.0001,first+last);
 vec4 photo=texture2D(returnPhoto,clamp(uv,0.,1.));photo.a*=inbounds.x*inbounds.y*step(.01,clip.w)*support*smoothstep(.006,.845,along);return photo;}`;
const commonVertex=`varying vec3 wp;varying vec3 wn;void main(){wp=(modelMatrix*vec4(position,1.)).xyz;wn=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);}`;
const shared=`varying vec3 wp;varying vec3 wn;uniform sampler2D original;uniform sampler2D heath;uniform sampler2D soil;uniform sampler2D stone;uniform sampler2D turf;uniform sampler2D shingle;uniform sampler2D occlusion;uniform sampler2D boulderMap;uniform sampler2D geology;uniform sampler2D needles;uniform sampler2D measuredStone;uniform sampler2D firstColor;uniform sampler2D ledgeMap;uniform sampler2D entryBed;
  vec3 refCoords(vec3 p){vec3 d=p-vec3(0.,2.05,0.);float dep=-${Math.cos(pitch)}*d.z-${Math.sin(pitch)}*d.y;vec2 uv=vec2(.5+915.*d.x/(975.*dep),.5+915.*(${Math.cos(pitch)}*d.y-${Math.sin(pitch)}*d.z)/(984.*dep));float frame=smoothstep(-.004,.0001,uv.x)*smoothstep(-.004,.0001,1.-uv.x)*smoothstep(-.004,.0001,uv.y)*smoothstep(-.004,.0001,1.-uv.y)*step(.18,dep);return vec3(clamp(uv,.0001,.9999),frame);}
  float noiseSmall(vec2 p){return .50+.19*sin(p.x*.89+p.y*.34)+.13*sin(p.y*1.74-p.x*.44)+.11*sin(p.x*2.51+p.y*1.77)+.07*sin(p.y*4.08-p.x*3.83);}
  float imageResolution(vec3 n){vec3 src=vec3(0.,2.05,0.)-wp,dst=cameraPosition-wp;float depthRatio=length(dst)/max(.01,length(src));float front=abs(dot(n,normalize(src)));float now=abs(dot(n,normalize(dst)));return smoothstep(.47,.965,depthRatio*min(1.0,front/max(.035,now)));}
  vec3 diffuseSun(vec3 n){float sun=clamp(dot(normalize(n),${sunVectorGLSL}),-.3,1.);return vec3(.50,.54,.57)+vec3(.60,.51,.39)*max(.0,sun);}
`;
const terrainFragment=shared+secondCapture+`void main(){vec3 n=normalize(wn);vec2 pt=wp.xz;float noise=noiseSmall(pt);float trailX=-.15+.08*sin(pt.y);float path=(1.-smoothstep(.25,.86,abs(pt.x-trailX)))*(1.-smoothstep(3.8,7.8,-pt.y));
  vec3 a=texture2D(heath,pt*.196+vec2(.03,.26)).rgb;
  vec3 b=texture2D(soil,mat2(.90,.44,-.44,.90)*pt*.42+vec2(.14,.41)).rgb;
  vec3 c=texture2D(turf,mat2(.73,-.68,.68,.73)*pt*.47).rgb;
  vec3 textureBase=mix(a,c,.39+.30*noise);textureBase=mix(textureBase,b,clamp(path*.79+smoothstep(.54,.94,noise)*.43,0.,1.));
  vec2 litUV=mat2(.94,-.34,.34,.94)*pt*.294+vec2(.18,.61);vec3 litter=texture2D(needles,litUV).rgb;
  float turfMix=smoothstep(.21,.78,noise)*smoothstep(.16,.76,wp.y)*(1.-path*.84);
  textureBase=mix(textureBase,litter,.28+.46*turfMix);
  vec2 bedUV=vec2((pt.x+11.)/16.,1.-(-pt.y-5.)/20.);vec4 surfaces=texture2D(geology,clamp(bedUV,0.,1.));
  float bedWeight=step(.0,bedUV.x)*step(.0,bedUV.y)*step(bedUV.x,1.)*step(bedUV.y,1.);
  textureBase=mix(textureBase,surfaces.rgb,.96*surfaces.a*bedWeight);
  vec2 entryUV=vec2((pt.x+3.6)/4.4,1.-(-pt.y-2.5)/5.4);vec4 closeBed=texture2D(entryBed,clamp(entryUV,0.,1.));float entryRect=step(0.,entryUV.x)*step(0.,entryUV.y)*step(entryUV.x,1.)*step(entryUV.y,1.);
  textureBase=mix(textureBase,closeBed.rgb,closeBed.a*entryRect*.95);
  float waterEdge=1.-smoothstep(.08,.35,wp.y+.045*(noise-.5));
  vec3 gravel=texture2D(shingle,mat2(.96,-.28,.28,.96)*pt*.85).rgb;textureBase=mix(textureBase,gravel*.82,waterEdge*(.71-.52*surfaces.a*bedWeight));
  vec2 microUv=mat2(.55,-.835,.835,.55)*pt*1.91;vec3 micro=texture2D(soil,microUv).rgb,microMean=textureLod(soil,microUv,4.2).rgb;float detail=clamp((.014+dot(micro,vec3(.26,.63,.11)))/(.014+dot(microMean,vec3(.26,.63,.11))),.42,1.68);textureBase*=mix(1.,detail,.56);
  float shade=clamp(.72+.31*noise-.16*smoothstep(1.4,2.5,wp.y),.48,1.);vec2 shadowUV=vec2((wp.x+22.)/32.,(wp.z+40.)/46.);float shadow=texture2D(occlusion,clamp(shadowUV,0.,1.)).r;
  vec2 dockAxis=normalize(vec2(3.45,-7.22)),bridgeStart=vec2(-.1206,-4.459),towardSun=${sunVectorGLSL}.xz/${sunVectorGLSL}.y;
  vec2 deckHit=wp.xz+towardSun*max(0.,.307-wp.y)-bridgeStart;float along=dot(deckHit,dockAxis),side=abs(dot(deckHit,vec2(-dockAxis.y,dockAxis.x)));
  float overhead=smoothstep(-.035,.041,along)*(1.-smoothstep(7.8,7.97,along))*(1.-smoothstep(.411,.493,side))*(1.-smoothstep(.271,.333,wp.y));
  vec3 color=textureBase*diffuseSun(n)*shade*mix(vec3(.96,.97,1.03),vec3(1.0),shadow)*shadow*mix(vec3(1.),vec3(.29,.34,.38),overhead);
  float woodland=(1.-smoothstep(-10.0,-7.41,wp.x))*smoothstep(13.5,17.6,-wp.z)*(1.-smoothstep(62.,83.,-wp.z));color*=mix(vec3(1.),vec3(.32,.37,.34),woodland*(.73+.18*noise));
  vec3 pr=refCoords(wp);vec4 source=texture2D(original,pr.xy);float facing=dot(normalize(vec3(0.,2.05,0.)-wp),n);float resolution=imageResolution(n),valid=pr.z*source.a*smoothstep(-.012,.055,facing);
  vec2 chart=vec2(pr.x*975.,(1.-pr.y)*984.);float opening=smoothstep(410.,414.,chart.x)*(1.-smoothstep(446.,450.,chart.x))*smoothstep(412.,417.,chart.y)*(1.-smoothstep(462.,466.,chart.y))*smoothstep(16.5,18.,-wp.z);valid=max(valid,opening*(1.-smoothstep(.05,1.35,distance(observer,vec3(0.,2.05,0.)))));
  vec3 broad=textureLod(original,pr.xy,3.6).rgb;float broadL=dot(broad,vec3(.25,.64,.11));
  vec3 tint=clamp(broad/max(.035,broadL),vec3(.65),vec3(1.55));
  color=mix(color,color*tint*clamp(.53+3.6*broadL,.61,1.22),.70*valid);
  float contactBand=smoothstep(7.8,8.5,-wp.z)*(1.-smoothstep(16.0,18.,-wp.z))*(1.-smoothstep(.045,.15,wp.y))*smoothstep(-.11,-.025,wp.y);
  valid=max(valid,contactBand*pr.z*(1.-smoothstep(.04,1.80,distance(observer,vec3(0.,2.05,0.)))));
  float sill=784.+.123*(chart.x-377.);float underPlanks=smoothstep(370.,382.,chart.x)*(1.-smoothstep(551.,563.,chart.x))*smoothstep(sill+.5,sill+2.2,chart.y)*(1.-smoothstep(sill+15.,sill+20.,chart.y));
  valid=max(valid,underPlanks*smoothstep(3.7,4.15,-wp.z)*(1.-smoothstep(5.4,5.78,-wp.z))*(1.-smoothstep(.05,1.69,distance(observer,vec3(0.,2.05,0.)))));
  float photo=valid*resolution;
  vec3 departure=observer-wp,sourceDirection=vec3(0.,2.05,0.)-wp;float originalAngle=1.-dot(normalize(departure),normalize(sourceDirection));
  float savedPigment=entryRect*valid*(1.-smoothstep(.035,.30,originalAngle))*smoothstep(.085,.47,facing);
  photo=max(photo,.67*savedPigment);vec3 initial=mix(source.rgb,texture2D(firstColor,pr.xy).rgb,1.-smoothstep(.08,2.35,distance(observer,vec3(0.,2.05,0.))));initial*=mix(vec3(1.),vec3(clamp(.71+.30*detail,.80,1.20)),entryRect*(1.-resolution)*.89);color=mix(color,initial,photo);
  vec4 returnClip=returnVP*vec4(wp,1.);
  vec2 returnUV=.5+.5*returnClip.xy/returnClip.w;
  float missingRock=0.;
  if(returnClip.w>.05 && min(returnUV.x,returnUV.y)>0. && max(returnUV.x,returnUV.y)<1.)
    missingRock=1.-smoothstep(.85,1.28,length((returnUV-vec2(.20175,.58308))/vec2(.0865,.0455)));
  float reservedGrass=1.-smoothstep(.83,1.37,length((wp.xz-vec2(-2.302794,-11.578924))/vec2(.75,.65)));
  float sourceBed=max(missingRock,reservedGrass)*(1.-smoothstep(2.1,3.3,distance(wp.xz,vec2(-2.302794,-11.578924))));
  vec4 returned=returnSample(wp);color=mix(color,returned.rgb,returned.a*(1.-sourceBed));
  vec4 approach=approachSample(wp);color=mix(color,approach.rgb,approach.a*(1.-sourceBed));
  // The first view fixes the meadow's broad colour. Fine soil and grass grain
  // comes from a neighbouring, visibly unobstructed turf patch in the survey.
  // Its metric coordinates stay on this piece of the terrain mesh.
  vec2 groundLocal=wp.xz-vec2(-2.302794,-11.578924);
  vec2 grassSource=vec2(427.,567.)+mat2(54.,18.,-32.,48.)*groundLocal;
  vec2 grassUV=vec2(grassSource.x,1254.-grassSource.y)/1254.;
  vec3 actualGrass=texture2D(returnPhoto,grassUV).rgb;
  vec3 grassMean=textureLod(returnPhoto,grassUV,3.5).rgb;
  vec3 grassDetail=clamp((actualGrass+.006)/(grassMean+.006),vec3(.40),vec3(1.92));
  vec3 broadMeadow=textureLod(firstColor,pr.xy,4.8).rgb;
  color=mix(color,mix(broadMeadow,grassMean,.38)*grassDetail,sourceBed*pr.z);
  gl_FragColor=vec4(color,1.);
  #include <colorspace_fragment>
}`;
const rockVertex=`attribute vec3 pigment;varying vec3 pigmentV;varying vec2 rockUV;`+commonVertex.replace('wp=(modelMatrix','rockUV=uv;pigmentV=pigment;wp=(modelMatrix');
const rockFragment=shared+secondCapture+`varying vec3 pigmentV;varying vec2 rockUV;void main(){vec3 n=normalize(wn);vec3 q=wp*1.12+vec3(pigmentV.z*11.,0.,pigmentV.z*4.);vec3 blend=pow(abs(n),vec3(4.));blend/=max(.001,blend.x+blend.y+blend.z);vec3 a=texture2D(stone,q.zy).rgb*blend.x+texture2D(stone,q.xz).rgb*blend.y+texture2D(stone,q.xy).rgb*blend.z;
  float l=dot(a,vec3(.27,.62,.11));a=mix(vec3(l*.99,l*.94,l*.91),a,.43);if(rockUV.x>=0.)a=pigmentV.z<-.5?texture2D(ledgeMap,rockUV).rgb:texture2D(boulderMap,rockUV).rgb;float wet=.57+.43*smoothstep(-.05,.26,wp.y);float key=max(0.,dot(n,${sunVectorGLSL}));vec3 col=a*(vec3(.37,.40,.44)+vec3(.78,.63,.45)*key)*pigmentV.y*wet;
  // Each visible mineral patch is bound once to its surveyed world surface.
  // The reverse side retains the scanned stone and the common directional light.
  vec3 pr=refCoords(wp),binding=texture2D(measuredStone,pr.xy).rgb;
  vec3 bytes=floor(binding*255.+.5);
  float firstDepth=(bytes.r*256.+bytes.g)*.001;
  float sourceDepth=-wp.z,delta=abs(firstDepth-sourceDepth);
  float geomTolerance=.022+.0022*sourceDepth;
  float seen=pr.z*mod(bytes.b,16.)/15.*(1.-smoothstep(geomTolerance,geomTolerance*2.8,delta));
  vec3 measured=texture2D(original,pr.xy).rgb;
  col=mix(col,measured,seen);
  float damp=1.-smoothstep(.033,.13,wp.y+.019*(noiseSmall(wp.xz*4.)-.5));
  vec3 V=normalize(observer-wp),L=${sunVectorGLSL};
  float glint=pow(max(0.,dot(n,normalize(V+L))),32.)+.14*pow(1.-max(0.,dot(V,n)),3.);
  col=mix(col,col*vec3(.80,.83,.86)+glint*vec3(.056,.049,.041),damp*(1.-seen));
  gl_FragColor=vec4(col,1.);
  #include <colorspace_fragment>
}`;
function photoMat(vs,fs,tex,photo){return new THREE.ShaderMaterial({uniforms:{measuredStone:{value:tex.measuredStone},original:{value:photo},...tex.second,firstColor:{value:tex.first},ledgeMap:{value:tex.ledge},entryBed:{value:tex['entry-bed']},geology:{value:tex.moraine},needles:{value:tex.needles},heath:{value:tex.heath},soil:{value:tex.soil},stone:{value:tex.granite},boulderMap:{value:tex.boulder},turf:{value:tex.turf},shingle:{value:tex.shingle},occlusion:{value:null}}, vertexShader:vs,fragmentShader:fs,toneMapped:false,side:THREE.DoubleSide});}
function stoneGeometry(){
  const random=rng(103319), pos=[], ix=[],colors=[],uv=[],casters=[];
  const profiles=boulders.map(r=>r.map(v=>new Uint16Array(Uint8Array.from(atob(v),c=>c.charCodeAt(0)).buffer)));
  const ledgeProfiles=ledges.map(r=>r.map(v=>new Uint16Array(Uint8Array.from(atob(v),c=>c.charCodeAt(0)).buffer)));
  let profileSerial=0;
  function stone(x,y,z,rx,ht,rz,rot,photographed,tone=1,granite=false){
    const start=pos.length/3;
    if (rx>.034)casters.push([x,z,rx,rz,ht,rot]);
    if(photographed || granite || (rx>.061&&random()<.091)){
      const library=granite?ledgeProfiles:profiles;const [points,tex,triangles]=library[(profileSerial++)%library.length];
      for(let i=0;i<points.length/3;i++){
        const u=(points[3*i]/65535*2-1)*rx,v=(points[3*i+2]/65535*2-1)*rz,h=points[3*i+1]/65535;
        const wx=x+u*Math.cos(rot)-v*Math.sin(rot),wz=z+u*Math.sin(rot)+v*Math.cos(rot);
        let wy=y+ht*((h-.33)/.67);if(h<.27)wy=Math.min(wy,groundY(wx,wz)-.016);
        pos.push(wx,wy,wz);colors.push(photographed?1:0,tone,granite?-1.81:1.61);uv.push(tex[2*i]/65535,tex[2*i+1]/65535);
      }
      for(const index of triangles)ix.push(start+index);return;
    }
    const sides=photographed?19:8+Math.floor(random()*3), layers=photographed?8:4;const seed=random()*19;
    let line=[];for(let k=0;k<sides;k++)line.push(.88+.26*random());
    for(let j=0;j<=layers;j++){
      const t=j/layers, elevation=(-1.5707+3.137*t),level=Math.max(.009,Math.cos(elevation)),h=Math.sin(elevation), cx=.09*Math.cos(seed)*t,cz=.075*Math.sin(seed)*t;
      for(let k=0;k<sides;k++){
        const angle=(k+j*.09)*2*Math.PI/sides,rad=(.8+.2*line[k])*(1+.052*Math.sin(k*2.11+j*1.4+seed));const u=(level*rad*Math.cos(angle)+cx)*rx,v=(level*rad*Math.sin(angle)+cz)*rz;
        const wx=x+u*Math.cos(rot)-v*Math.sin(rot),wz=z+u*Math.sin(rot)+v*Math.cos(rot);
        let yp=y+ht*(h+.085*level*Math.sin(k*2.6+seed+j*.57));
        if(t<.49){const burial=groundY(wx,wz)-.03-.4*ht;yp=mix(Math.min(yp,burial),yp,ease(.05,.49,t));}
        pos.push(wx,yp,wz);colors.push(photographed?1:0,tone,seed);uv.push(-1,-1);
      }
    }
    for(let j=0;j<layers;j++)for(let k=0;k<sides;k++){
      const a=start+j*sides+k,b=start+j*sides+(k+1)%sides,c=a+sides,d=b+sides;ix.push(a,c,b,b,c,d);
    }
  }
  // The far headland is a short, low gravel ridge; shallow holes expose water between its cobbles.
  const spitData=[[-.13,1.06],[-.035,.98],[.09,.81],[.32,.54],[.55,.23],[.79,0.],[1.08,.22],[1.46,.62],[1.73,.98]];
  const spitStart=pos.length/3,spitColumns=[];
  for(let u=583;u<=711;u+=2){spitColumns.push(u);const last=silhouetteY(farFoot,u),top=silhouetteY(farSpine,u),frac=ease(583,608,u)*(1-ease(702,711,u));
    for(const [behind,level] of spitData){const rough=(.23*Math.sin(u*1.89+3*level)+.16*Math.sin(u*.72-2*level))*frac;
      const p=farShorePoint(u,mix(top,last,level)+rough,behind*(.32+.68*frac));pos.push(p.x,p.y,p.z);uv.push(-1,-1);colors.push(2,.89+.09*Math.sin(u*.8),2.3);
    }
  }
  for(let i=0;i<spitColumns.length-1;i++)for(let j=0;j<spitData.length-1;j++){const a=spitStart+i*spitData.length+j,b=a+1,c=a+spitData.length;ix.push(a,c,b,b,c,c+1);}
  for(let i=0;i<58;i++){const u=590+i*2+random()*1.1,contact=silhouetteY(farFoot,u)+.39*Math.sin(i*2.46),p=farShorePoint(u,contact,random()*.18),rx=.078+random()**1.28*.226;
    stone(p.x,p.y-.026,p.z,rx,.045+rx*(.34+.52*random()),rx*(.52+random()*.54),random()*6.28,true,.91+random()*.15,true);}
  function landingGranite(cx,cy,silhouette,depth,thickness,salient,shade){
    const outline=new THREE.CatmullRomCurve3(silhouette.map(([u,v])=>new THREE.Vector3(u,v,0)),true,'centripetal');
    const angular=68,sections=18,begin=pos.length/3,center=atD(cx,cy,depth);
    const contour=Array.from({length:angular},(_,i)=>outline.getPointAt(i/angular));
    for(let row=0;row<=sections;row++){
      const theta=Math.PI*row/sections,t=Math.max(.00055,Math.sin(theta)),face=Math.cos(theta);
      for(let i=0;i<angular;i++){
        const edge=contour[i],u=mix(cx,edge.x,t),v=mix(cy,edge.y,t);
        const ySlope=.00115*(cy-v),xSlope=.00052*(u-cx);
        const ledge=Math.exp(-Math.pow((u-(696.8+.69*(v-848.)))/5.8,2))*.024*salient;
        const broken=.0085*Math.sin(u*.19+v*.31)+.0047*Math.sin(u*.59-v*.20);
        const realDepth=depth+ySlope+xSlope-face*thickness-(ledge+broken)*Math.max(0,face);
        const q=atD(u,v,realDepth);pos.push(q.x,q.y,q.z);uv.push(-1,-1);colors.push(3,shade,3.14);
      }
    }
    const oriented=(a,b,c)=>{const pa=new THREE.Vector3().fromArray(pos,3*a),pb=new THREE.Vector3().fromArray(pos,3*b),pc=new THREE.Vector3().fromArray(pos,3*c);const normal=pb.clone().sub(pa).cross(pc.clone().sub(pa));if(normal.dot(pa.clone().sub(center))>0)ix.push(a,b,c);else ix.push(a,c,b);};
    for(let j=0;j<sections;j++)for(let i=0;i<angular;i++){const a=begin+j*angular+i,b=begin+j*angular+(i+1)%angular,c=a+angular,d=b+angular;oriented(a,b,d);oriented(a,d,c);}
    const firstCenter=pos.length/3;for(const j of [0,sections]){const q=atD(cx,cy,depth-Math.cos(j*Math.PI/sections)*thickness);pos.push(q.x,q.y,q.z);uv.push(-1,-1);colors.push(3,shade,3.14);for(let i=0;i<angular;i++)oriented(firstCenter+(j?1:0),begin+j*angular+i,begin+j*angular+(i+1)%angular);}
    casters.push([center.x,center.z,.33*salient+.079,thickness,.21*salient+.055,.31]);
  }
  // A low glacial gravel tongue occupies the pinched elbow of the inlet. Its wet toe follows
  // the measured U-shaped boundary, with separate broken cobbles protruding from the shallows.
  const toe=[[655,291],[660,272],[665,252],[669,237],[673,220],[677,207],[680,194],[683,185],[685,185],[688,189],[690,199],[694,204],[698,213],[702,222],[707,238],[712,252],[719,266]];
  const elbowStart=pos.length/3,profile=[[-3.0,-.088],[0,.048],[2.7,.073],[7.1,.091],[13.6,.128],[22.8,.171],[34.3,.202],[48.9,.239],[66.7,.29]];
  let count=0;
  for(let v=655;v<=719;v+=1.45){const outer=silhouetteY(toe,v)+.74*Math.sin(v*1.47)+.48*Math.cos(v*.73);
    for(const [inland,level] of profile){const u=outer-inland,small=(Math.sin(v*.67+inland*.86)+.67*Math.cos(v*.361-inland*1.26))*(.003+.007*ease(0,7,inland));
      const q=atY(u,v,level+small);if(inland>60){const burial=Math.min(q.y,groundY(q.x,q.z)+.018);q.copy(atY(u,v,burial));}pos.push(q.x,q.y,q.z);colors.push(2,.96,3.74);uv.push(-1,-1);}
    count++;
  }
  for(let i=0;i<count-1;i++)for(let j=0;j<profile.length-1;j++){const a=elbowStart+i*profile.length+j,b=a+1,c=a+profile.length;ix.push(a,b,c,b,c+1,c);}
  const fanRandom=rng(278441),runnel=[[187.5,682.65],[192.,683.15],[198.,684.10],[204.,684.52],[211.,685.12],[219.,685.48],[226.,685.83]];
  for(let i=0;i<33;i++){
    const v=661+fanRandom()*49,u=silhouetteY(toe,v)-(4.+10.*fanRandom()),y=.044+fanRandom()*.056,p=atY(u,v,y),r=.032+fanRandom()*.061,first=pos.length,firstTriangle=ix.length;
    stone(p.x,p.y-.028,p.z,r,r*(.51+.41*fanRandom()),r*(.53+.62*fanRandom()),fanRandom()*6.28,true,.91+.13*fanRandom(),true);
    if(u<181.3||u>220.0||v<668.5||v>699.)continue;
    // Place the exposed pebble toes on either side of the narrow surveyed water seam.
    // Translation is measured along the bank in metres. Shape, elevation and upper edge remain intact.
    const sign=v<silhouetteY(runnel,u)?1:-1,vec=new THREE.Vector3();let distance=0;
    function admit(x,y,z){vec.set(x,y,z);const q=pix(vec);if(q.x<187.68||q.x>224.5)return;
      const margin=.76+1.24*ease(187.68,193.5,q.x)+.34*ease(198.,215.,q.x),excess=margin+sign*(q.y-silhouetteY(runnel,q.x));
      if(excess>0)distance=Math.max(distance,excess*(-vec.z)/Math.max(115.,q.y-451.));}
    const submerged=-.041;
    for(let j=first;j<pos.length;j+=3)if(pos[j+1]>=submerged)admit(pos[j],pos[j+1],pos[j+2]);
    for(let j=firstTriangle;j<ix.length;j+=3)for(let e=0;e<3;e++){
      const a=ix[j+e]*3,b=ix[j+(e+1)%3]*3,y0=pos[a+1],y1=pos[b+1];
      if((y0<submerged)===(y1<submerged))continue;
      const t=(submerged-y0)/(y1-y0);admit(mix(pos[a],pos[b],t),submerged,mix(pos[a+2],pos[b+2],t));}
    const delta=Math.min(.37,distance*1.045)*sign;
    if(delta>.000001||delta<-.000001){const lateral=p.x/(-p.z)*delta;for(let j=first;j<pos.length;j+=3){pos[j]+=lateral;pos[j+2]-=delta;}
      if(r>.034){const caster=casters[casters.length-1];caster[0]+=lateral;caster[1]-=delta;}}
  }
  const landmarkRocks=[],entryMarkers=[];
  // Pixel measurements are the base centre, top and diameter of isolated recognizable rocks.
  const traced=[[153,937,810,211],[91,782,703,144],[690,903,845,104],[895,964,918,130],[244,735,699.5,52],[160,586,553,69],[487,605,579,51],[61,545,522,74],[193,663,626,50],[419,617,602,44],[393,624,605,30],[365,634,616,32],[336,638,627,34],[531,597,582,40],[550,587,569,35],[580,578,564,30],[608,567,553,28],[636,560,550,23],[502,606,598,25],[263,660,647,27],[301,651,638,21],[281,771,744,53],[202,740,713.5,54],[168,787,759,32],[227,751,738,24],[297,778,763,24],[308,784,773,17],[175,738,728,24],[213,781,772,17],[313,755,746,18],[346,789,779,19],[263,819,808,23]];
  for(const [u,bottom,top,w] of traced){
    const foot=groundHit(u,bottom),rx=w*(-foot.z)/1830,rz=rx*(.60+.17*random()),z=foot.z-rz*.56;
    const by=groundY(foot.x,z)-.018,cap=atD(u,top,-z),first=pos.length;
    const rotation=random()*.46-.23;
    if(u===690&&bottom===903){
      // The large contiguous rock by the landing has a pale raised seam on its lake-facing shoulder.
      // Its two hemispheres share the measured image silhouette; the lower rings pass below the bank.
      profileSerial++;
      landingGranite(690,879,[[637,870],[644,863],[653,856],[666,850],[674,847],[686,844.9],[693.3,843.4],[698.2,844],[704,847.1],[710.6,851.1],[718.2,854.7],[724,859.4],[729,864.3],[732.2,869.6],[736.3,871.8],[739.7,874],[745,876.6],[749.3,879.1],[753.4,881.6],[753.8,884.7],[750,886.8],[745.7,888.3],[741.7,891.2],[740,895.1],[733.7,899.4],[725,902.2],[715.7,904.2],[705,907],[694,912],[684,912.5],[674,909.7],[663,903.8],[654,897.1],[647,889.8],[640,882.9]],3.52,.238,1.,1.02);
      landingGranite(649,853,[[627,851],[633.5,847.8],[639.8,846.5],[644.3,843.6],[649,844.4],[652.6,846.2],[656.1,844.3],[660,846.2],[665.9,848.1],[669.2,851.2],[666.5,855.9],[660.9,859.2],[653,861.5],[644,860],[638,858],[631,855.7]],4.075,.118,.39,.94);
    }else stone(foot.x,by,z,rx,Math.max(.025,cap.y-by),rz,rotation,true,1.,-z<7.65);
    landmarkRocks.push([foot.x,z,rx]);
    if([244,281,202].includes(u)){
      let topIndex=first;for(let k=first;k<pos.length;k+=3)if(pos[k+1]>pos[topIndex+1])topIndex=k;
      entryMarkers.push({referenceBase:[u,bottom],apex:new THREE.Vector3(...pos.slice(topIndex,topIndex+3)),foot:foot.clone(),width:2*rx,aboveGround:pos[topIndex+1]-groundY(pos[topIndex],pos[topIndex+2])});
    }
  }
  // Extend the foreground granite shoulder to its surveyed silhouette at the lower right edge.
  // Cross-sections have a buried base and an exposed back, side and fore slope.
  const shoulder=[[873,916,3.34],[892,912.5,3.36],[904,915.5,3.35],[916,920,3.34],[927,926.5,3.32],[938,936,3.29],[949,945.5,3.27],[959,954,3.25],[969,964.5,3.23],[979,978,3.22],[994,990,3.21],[1012,998,3.20]];
  const firstVertex=pos.length/3,levels=[[-.21,63],[-.14,30],[-.072,12],[0,0],[.052,4],[.11,14],[.16,34]];
  for(const [u,v,d] of shoulder)for(const [offset,drop] of levels){const p=atD(u,v+drop,d+offset);if(drop===63||drop===34)p.y=Math.min(p.y,groundY(p.x,p.z)-.045);pos.push(p.x,p.y,p.z);colors.push(1,1.03,.714);uv.push(-1,-1);}
  for(let range=0;range<shoulder.length-1;range++)for(let row=0;row<levels.length-1;row++){const a=firstVertex+range*levels.length+row,b=a+1,c=a+levels.length;ix.push(a,b,c,b,c+1,c);}
  const across=Math.atan2(-.42331157,.90593833);
  for(const [x,z,rx,rz,h] of returnSurvey.rocks){
    const overlap=landmarkRocks.some(([cx,cz,r])=>Math.hypot(cx-x,cz-z)<.55*(rx+r));
    if(overlap&&rx<.30)continue;
    const g=groundY(x,z);if(g<-.12)continue;
    const firstIndex=ix.length,firstCaster=casters.length;
    stone(x,g-.018,z,rx,h,rz,across+(.5-random())*.41,true,.94+.14*random());
    // The auxiliary view introduced a boulder on exposed low grass at source
    // pixel (312,548). Consume its survey slot to keep all other rocks and
    // vegetation deterministic. Keep this reserved patch free of new instances.
    if(Math.abs(x+2.302794)<.001 && Math.abs(z+11.578924)<.001){
      ix.length=firstIndex;casters.length=firstCaster;
    }
    landmarkRocks.push([x,z,rx]);
  }
  // Loose shore stones sit in shallow pockets. Their lower rings are buried or darkened by water independently.
  // These bases are measured on the water plane rather than on the smooth bank data.
  const shoreSurvey=[[209,676,12,8],[226,674,19,6],[251,664,14,7],[283,658,17,8],[313,650,17,6],[328,646,14,8],[352,639,22,6],[376,635,15,7],[391,633,19,6],[411,622,14,9],[431,622,16,7],[447,617,14,8],[459,613,14,7],[472,613,13,6],[497,608,13,6],[515,602,15,5],[540,592,18,8],[552,590,13,7],[581,580,14,5]];
  for(const [u,v,w,h] of shoreSurvey){const p=atY(u,v,0),radius=(-p.z)*w/1830;const height=(-p.z)*h/915;
    stone(p.x,-.028-random()*.025,p.z,radius,height*1.03,radius*(.45+.49*random()),random()*6.28,true,.82+.20*random(),true);
  }
  for(const [u,v,span] of [[246,709,.102],[273,722,.079],[291,735,.113],[312,743,.105],[334,752,.128],[348,761,.077],[363,771,.122]]){
    const p=atY(u,v,0);stone(p.x,-.036-random()*.018,p.z,span,.071+random()*.051,span*(.47+.31*random()),random()*6.28,true,.87+.12*random(),true);
    for(let j=0;j<2;j++){const rr=span*(.27+.19*random());stone(p.x+(random()-.5)*span*2.4,-.021-random()*.013,p.z+(random()-.5)*span*1.6,rr,.034+random()*.029,rr*.79,random()*6.28,true,.81+random()*.24,true);}
  }
  const avoidRock=(x,z,r)=>landmarkRocks.some(([cx,cz,cr])=>Math.hypot(x-cx,z-cz)<cr+r);
  for(let i=0;i<2180;i++){
    const d=mix(-2,65,random()**1.45),edge=edgeAt(d),front=random();const offset=front<.74?(random()**1.55)*1.0-.18:(random()**1.5)*13+.48;
    const x=edge-offset,z=-d;
    if(Math.abs(x-.05)<.40 && d<5 && random()<.85)continue;
    let scale=(front<.74 ? .027+random()**3*.21 : .035+random()**3*.41)*(d>35?1.4:1.);
    const p=pix(new THREE.Vector3(x,groundY(x,z),z));
    if(d>0&&p.x>-165&&p.x<1150&&p.y>459&&p.y<1460&&scale>.070)scale=.031+.039*random();
    if(Math.hypot(x-.38,(z+15)*.81)<.83 && scale>.072)continue;
    if (avoidRock(x,z,scale*.69))continue;
    const underCabin=d>11&&d<21&&x<-.6&&x>-8.5;
    if(underCabin&&random()<.8)continue;
    const ground=groundY(x,z);if(ground<-.26)continue;
    stone(x,ground-.010,z,scale,.28*scale+random()*.59*scale,scale*(.5+.86*random()),6.28*random(),false,(.61+.66*random())*.95);
  }
  for(let i=0;i<154;i++){
    const d=6.6+random()*14.1,edge=edgeAt(d),x=edge-(random()**1.35*.85-.16),r=.023+random()**2*.105,y=groundY(x,-d);
    if(y<-.18||avoidRock(x,-d,r*.39))continue;
    stone(x,y-.012,-d,r,r*(.40+.31*random()),r*(.51+random()*.7),random()*6.28,false,.69+.53*random());
  }
  return {geo:addGeometry(pos,ix,{pigment:[colors,3],uv:[uv,2]}),landmarkRocks,entryMarkers,casters};
}
const WX=2/Math.sqrt(5),WZ=-1/Math.sqrt(5);
const A={x:.12,z:-15}, spacing=.84;
// The two sample tufts lie along the contour. Their separation projected on the flow is 0.84 m.
const parallelOffset=.896;
const B={x:A.x+spacing*WX+parallelOffset*WZ,z:A.z+spacing*WZ-parallelOffset*WX};
const windConfig={direction:[WX,WZ],phaseSpeed:1.12,period:5.4,duration:1.05,lag:.14,reboundRatio:.23,damping:3.1,reboundFrequency:8.8,arrivalAtA:1.55,spacing};
function waveAt(t,x,z){
  const phase=t-windConfig.arrivalAtA-((x-A.x)*WX+(z-A.z)*WZ)/windConfig.phaseSpeed;
  const cyc=phase-windConfig.period*Math.floor(phase/windConfig.period);
  const p=cyc-windConfig.lag;
  const gust=cyc<=windConfig.duration?Math.sin(Math.PI*cyc/windConfig.duration)**2:0;
  let motion=0;
  if(p>=0&&p<=windConfig.duration) motion=Math.sin(Math.PI*p/windConfig.duration)**2;
  else if(p>windConfig.duration){const u=p-windConfig.duration; motion=-windConfig.reboundRatio*Math.exp(-windConfig.damping*u)*Math.sin(windConfig.reboundFrequency*u)*(1-Math.exp(-15*u));}
  const ambient=.029*Math.sin(t*2.4+x*.91-z*.72);
  return {gust,response:motion,amplitude:.26*motion+ambient,phase:cyc};
}
const windGL=`const vec2 flow=vec2(${WX},${WZ});uniform float clock;
float bendAt(vec2 pt,float time){float q=mod(time-1.55-dot(pt-vec2(.12,-15.),flow)/1.12,5.4)-.14;
 float s=0.;if(q>=0.&&q<=1.05){float v=sin(3.14159265*q/1.05);s=v*v;}else if(q>1.05){float u=q-1.05;s=-.23*exp(-3.1*u)*sin(8.8*u)*(1.-exp(-15.*u));}return .26*s+.029*sin(time*2.4+pt.x*.91-pt.y*.72);} float bend(vec2 pt){return bendAt(pt,clock);}`;
// A blade or needle may cover just one MSAA sample. Keep pigment, UVs and
// material positions inside its silhouette when evaluating that sample.
const leavesVert=`attribute vec3 groupBase;attribute vec3 sizeHue;centroid varying vec2 vUv;centroid varying vec3 leafColor;centroid varying vec3 restPlant,initialPlant;${windGL}
void main(){vec3 local=(instanceMatrix*vec4(position,1.)).xyz;float fraction=clamp((local.y-groupBase.y)/sizeHue.x,0.,1.);float elastic=sizeHue.x*fraction*fraction*sizeHue.z;restPlant=local;initialPlant=local;initialPlant.xz+=flow*bendAt(groupBase.xz,0.)*elastic;local.xz+=flow*bend(groupBase.xz)*elastic;vec3 n=normalize(mat3(instanceMatrix)*normal);float sun=.63+.36*abs(dot(n,${sunVectorGLSL}));float ao=mix(.52,1.03,smoothstep(.015,.74,fraction));leafColor=vec3(1.03,1.0,.94)*sun*ao*sizeHue.y;vUv=uv;gl_Position=projectionMatrix*viewMatrix*vec4(local,1.);}`;
const botanicalColour=secondCapture+`uniform sampler2D frontImg,frontMask;centroid varying vec3 restPlant,initialPlant;
vec3 botanicalLight(vec3 color){vec3 d=initialPlant-vec3(0.,2.05,0.);float dep=-.998997*d.z-.044764*d.y;vec2 uv=vec2(.5+915.*d.x/(975.*dep),.5+915.*(.998997*d.y-.044764*d.z)/(984.*dep));
 float coverage=texture2D(frontMask,clamp(uv,0.,1.)).a*step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.)*step(.03,dep);
 float headland=smoothstep(46.,52.,-restPlant.z)*(1.-smoothstep(70.,82.,-restPlant.z))*smoothstep(.626,.65,uv.x)*(1.-smoothstep(.714,.739,uv.x));
 float nearShoots=smoothstep(.266,.294,uv.x)*(1.-smoothstep(.397,.436,uv.x))*smoothstep(.176,.198,uv.y)*(1.-smoothstep(.277,.299,uv.y))*smoothstep(3.03,3.6,-restPlant.z)*(1.-smoothstep(7.02,7.78,-restPlant.z));
 float lowForest=(1.-smoothstep(.070,.126,uv.x))*smoothstep(.478,.496,uv.y)*(1.-smoothstep(.551,.572,uv.y))*smoothstep(15.4,18.1,-restPlant.z)*(1.-smoothstep(29.,36.,-restPlant.z));
 float shoreStems=smoothstep(.52,.55,uv.x)*(1.-smoothstep(.645,.668,uv.x))*smoothstep(.432,.445,uv.y)*(1.-smoothstep(.503,.515,uv.y))*smoothstep(14.9,16.2,-restPlant.z)*(1.-smoothstep(35.,44.,-restPlant.z));
 coverage=max(coverage,max(max(headland,nearShoots),max(lowForest,shoreStems)));float first=distance(observer,vec3(0.,2.05,0.)),last=distance(observer,returnEye),ratio=first/max(.001,first+last);
 vec3 captured=texture2D(frontImg,clamp(uv,0.,1.)).rgb;float resolution=length(observer-restPlant)/max(.02,length(d));
 color=mix(color,captured,coverage*(1.-smoothstep(.005,.71,ratio))*smoothstep(.54,.91,resolution));vec4 second=returnSample(restPlant);
 color=mix(color,second.rgb,.955*second.a);vec4 middle=approachSample(restPlant);return mix(color,middle.rgb,.956*middle.a);}`;
const leavesFrag=botanicalColour+`uniform sampler2D plantMap;uniform sampler2D plantAlpha;uniform vec3 alphaChannel;centroid varying vec2 vUv;centroid varying vec3 leafColor;void main(){vec4 col=texture2D(plantMap,vUv);float a=dot(texture2D(plantAlpha,vUv).rgb,alphaChannel);if(a<.40)discard;gl_FragColor=vec4(botanicalLight(col.rgb*leafColor),1.);
  #include <colorspace_fragment>
}`;
function decode(scan){
  const herb=botanics[scan];const [p,n,uv,ix]=(herb??scans[scan]).map(v=>Uint8Array.from(atob(v),c=>c.charCodeAt(0)).buffer);
  const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(Float32Array.from(new Int16Array(p),x=>x/(herb?2048:9000)),3));geom.setAttribute('normal',new THREE.Float32BufferAttribute(Float32Array.from(new Int8Array(n),x=>x/127),3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(Float32Array.from(new Uint16Array(uv),x=>x/65535),2));geom.setIndex(new THREE.BufferAttribute(new Uint16Array(ix),1));return geom;
}
function tuftGeometry(){
  const pos=[],norm=[],uv=[],ix=[];let n=0;
  // Three real grass silhouettes embedded in the source atlas. Each blade moves with its height.
  const patches=[[207,785,492,908],[610,779,818,873],[12,911,167,998]];
  for(let card=0;card<3;card++){
    const theta=card*Math.PI/3, U=Math.cos(theta),V=Math.sin(theta),rect=patches[card];
    for(let j=0;j<=4;j++){const h=j*.25, curve=.11*h*h;for(const side of [-1,1]){
      const width=side*.85;pos.push(width*U+curve*V,h,width*V-curve*U);norm.push(V,.35,-U);uv.push((side<0?rect[0]:rect[2])/1024,1-mix(rect[3],rect[1],h)/1024);
    }if(j<4){const z=n+2*j;ix.push(z,z+2,z+1,z+1,z+2,z+3);}}
    n+=10;
  }
  const geo=addGeometry(pos,ix,{uv:[uv,2]});geo.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));return geo;
}
const bladeVert=leavesVert.replace('attribute vec3 groupBase;','attribute vec3 bladePigment;centroid varying vec3 pigmentV;attribute vec3 groupBase;').replace('vUv=uv;','pigmentV=bladePigment;vUv=uv;');
const bladeFrag=botanicalColour+`centroid varying vec3 pigmentV;centroid varying vec3 leafColor;void main(){gl_FragColor=vec4(botanicalLight(pigmentV*leafColor),1.);
#include <colorspace_fragment>
}`;
function fineBlades(rooted=false){
  const random=rng(8147),pos=[],uv=[],norm=[],colors=[],ix=[];
  for(let j=0;j<73;j++){
    const angle=random()*6.283,rad=.14*Math.sqrt(random()),x=Math.cos(angle)*rad,z=Math.sin(angle)*rad;
    const a=angle+(random()-.5)*1.9,dx=Math.cos(a),dz=Math.sin(a),reach=.13+random()**1.3*.61;
    const high=.39+random()**.75*.63,wide=rooted?.016+random()*.022:.0048+random()*.008,age=random(),twist=(random()-.5)*1.83;
    const start=pos.length/3;
    for(let step=0;step<7;step++){
      const t=step/6,spread=reach*(t*t*.85+t*.15),height=high*(t*(1.08+.37*reach)-t*t*(.08+.7*reach));
      const width=wide*(.13+.87*Math.sin((.14+t*.85)*Math.PI))*(1-ease(.68,1.,t));const sideA=a+twist*t;
      for(let edge=-1;edge<=1;edge++){
        const side=width*edge;pos.push(x+dx*spread-side*Math.sin(sideA),height+(1-Math.abs(edge))*.0025,z+dz*spread+side*Math.cos(sideA));uv.push((edge+1)*.5,t);
        norm.push(-dx*.52-.18*edge*dz,.60, -dz*.52+.18*edge*dx);
        const light=(.66+.32*t)*(edge===0?1.21:edge>0?1.04:.84),dry=.32*age+.34*t;
        const col=new THREE.Color().setRGB(mix(.037,.225,dry)*light,mix(.051,.188,dry)*light,mix(.016,.077,dry)*light);colors.push(col.r,col.g,col.b);
      }
      if(step<6){let n=start+3*step;ix.push(n,n+3,n+1,n+1,n+3,n+4,n+1,n+4,n+2,n+2,n+4,n+5);}
    }
  }
  let highest=0;for(let i=1;i<pos.length;i+=3)highest=Math.max(highest,pos[i]);
  for(let i=1;i<pos.length;i+=3)pos[i]/=highest;
  const g=addGeometry(pos,ix,{uv:[uv,2],bladePigment:[colors,3]});g.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));return g;
}
// The near bank contains three observed bands of narrow sedges. Their pigment
// is bound to the initial, rooted leaf, so the same stem keeps its colour as
// the visitor moves from the path to the pier.
const rootedBladeFrag=`uniform sampler2D frontImg;
centroid varying vec3 pigmentV,leafColor,initialPlant;
void main(){
  vec3 d=initialPlant-vec3(0.,2.05,0.);
  float depth=-.998997*d.z-.044764*d.y;
  vec2 uv=vec2(.5+915.*d.x/(975.*depth),.5+915.*(.998997*d.y-.044764*d.z)/(984.*depth));
  vec3 photo=texture2D(frontImg,uv).rgb, ambient=textureLod(frontImg,uv,2.5).rgb;
  vec3 mid=vec3(.125,.132,.043);
  vec3 slender=pigmentV*leafColor;
  float lamina=clamp(dot(slender,vec3(.27,.63,.10))/.083,.42,1.63);
  vec3 local=mix(mid,ambient,.53)*lamina;
  vec3 color=mix(local,photo,.76)*vec3(.97,1.055,.87)*mix(.82,1.32,smoothstep(.46,1.39,lamina));
  gl_FragColor=vec4(color,1.);
  #include <colorspace_fragment>
}`;
function foliage(ctx,group,tex,rocks,clock){
  const types=Object.fromEntries([...Object.keys(botanics),'sedge','sedge2','grass','shrub','tuft','fine','rootedSedge'].map(k=>[k,[]])), random=rng(904703),cast=[];
  function attach(kind,x,z,h,spread,yaw,hue,surveyed=false,surveyHeight){const y=(surveyHeight??groundY(x,z))-.005;
    const root=pix(new THREE.Vector3(x,y,z));
    if(-z>3.48&&-z<6.4&&root.x>511&&root.x<647&&root.y<860){
      if(kind==='tuft'||kind==='shrub')return;h*=.67;
    }
    if(!surveyed&&-z>1.5&&-z<7.3&&root.x>345&&root.x<1080){const cap=atD(root.x,silhouetteY(nearPlantEdge,root.x),-z).y-y;h=Math.min(h,cap*.94);if(h<.044)return;}
    if(-z>4.03&&-z<8.10&&root.x>147&&root.x<274){const maxEye=atD(root.x,silhouetteY(inletShootLimit,root.x),-z).y-y;h=Math.min(h,maxEye);if(h<.033)return;}
    if(-z>15.2&&-z<42.&&root.x>518&&root.x<659){const tip=silhouetteY(peninsulaBack,root.x)-3.1-.75*Math.sin(root.x*.51);const ceiling=atD(root.x,tip,-z).y-y;
      h=Math.min(h,Math.max(.025,ceiling));if(h<.040)return;}
    const countAsGrass=kind==='straw'||kind==='fern'||kind==='tuft'||kind==='fine'||kind==='sedge'||kind==='sedge2'||kind==='grass';
    const glade=((x+1.90)/.91)**2+((z+10.33)/1.04)**2;
    const nearInlet=((x+1.56)/.78)**2+((z+6.10)/.85)**2;
    const farInlet=((x+.13)/.81)**2+((z+13.45)/1.03)**2;
    if(countAsGrass&&Math.min(glade,nearInlet,farInlet)<1.){
      if(kind==='straw'||kind==='fern'){h*=.74;spread=Math.min(spread,1.29);}
      else if(kind==='tuft'){h*=.89;spread=Math.min(spread,1.36);}
      kind='rootedSedge';
    }
    const item={x,z,y,h,spread,yaw,hue};types[kind].push(item);cast.push([x,z,h*spread*.38,h*.28,h,yaw]);}
  attach('sedge',A.x,A.z,.38,1.35,.33,1.35);attach('sedge',B.x,B.z,.38,1.35,.33,1.35);
  for(const p of [A,B]){attach('fine',p.x,p.z,.38,1.12,.75,1.23);attach('grass',p.x-.044,p.z+.021,.17,.78,.56,1.25);}
  const headlandGrowth=[[638,462.7,1.1,'heather2'],[644,463.5,.38,'shrub'],[648,464.8,.46,'heather2'],[652,468.5,.52,'sedge2'],[661,469.8,.72,'heather2'],[666,465.2,.64,'heather2'],[668,459.9,.20,'heather2'],[670,463.8,.34,'shrub'],[674,470.0,.64,'heather2'],[679,470.4,.91,'shrub'],[682,469.5,.91,'shrub'],[686,471.0,.78,'heather2'],[693,476.9,.84,'sedge2']];
  for(const [u,top,spread,kind] of headlandGrowth){const base=silhouetteY(farSpine,u)+.55,g=farShorePoint(u,base,.69),cap=farShorePoint(u,top,.69),height=Math.max(.10,cap.y-g.y);
    attach(kind,g.x,g.z,height,spread,1.2+u*.237,1.08,true,g.y);
  }
  // Visible tall patches on the reference supplement the physically distributed seed banks.
  for(const [u,v,h] of [[563,913,.31],[610,863,.26],[500,848,.24],[690,953,.25],[533,962,.37],[761,962,.34],[831,965,.24],[296,881,.23],[271,831,.19],[173,789,.22],[337,784,.17],[300,745,.17],[216,735,.21],[101,789,.24],[64,700,.27],[156,663,.28],[276,644,.18],[373,626,.19],[441,598,.18],[541,567,.17],[586,554,.17],[316,560,.16],[68,578,.21],[161,606,.14],[258,595,.18],[284,577,.17]]){
    const p=groundHit(u,v);if(p.y<=-.03)continue;for(let j=0;j<3;j++){attach(j===0?'grass':'sedge2',p.x+(.5-random())*.12,p.z+(.5-random())*.12,h*(.79+.36*random()),1.32+random()*.5,random()*6.28,1.01+random()*.39);}
  }
  function allowed(x,d,h){if(groundY(x,-d)<.07)return false;
    const photo=pix(new THREE.Vector3(x,groundY(x,-d),-d));
    if(d<5.6 && d>-2 && Math.abs(x-(-.05-.02*d))<.33)return false;
    if(d>10.3&&d<20.8&&photo.x>92&&photo.x<464&&photo.y<526)return false;
    return !rocks.some(([rx,rz,r])=>Math.hypot(x-rx,-d-rz)<r*.77+h*.13);
  }
  for(let cluster=0;cluster<414;cluster++){
    const d=-3+Math.pow(random(),1.36)*46;const center=edgeAt(d)-(.26+random()**1.27*16.0);const geography=.58+.32*Math.sin(center*1.53+d*.63)+.15*Math.sin(center*.84-d*.9);
    if(geography<.32||!allowed(center,d,.23))continue;
    const amount=3+Math.floor(random()*6), H=.09+random()**1.2*.22;
    for(let j=0;j<amount;j++){
      const x=center+(random()-.5)*.91,dd=d+(random()-.5)*.90,h=H*(.70+random()*.72);if(!allowed(x,dd,h))continue;
      const observed=pix(new THREE.Vector3(x,groundY(x,-dd),-dd));const visible=observed.x>14&&observed.x<962&&observed.y>400&&observed.y<985;
      if(visible&&random()<.34)continue;
      const p=random(),kind=p<.07?'fine':p<.80?'tuft':p<.90?'sedge':'sedge2';attach(kind,x,-dd,h,1.+random()*.70,random()*6.28,1.02+random()*.55);
    }
    if(random()<.105&&d<39){const h=.25+random()**1.34*.39;if(allowed(center,d,h))attach('shrub',center,-d,h,1.+random()*.42,random()*6.28,.92+random()*.35);}
  }
  for(const [u,v,h] of [[24,964,.5],[36,866,.42],[171,752,.27],[344,770,.27],[285,619,.22],[82,656,.33],[303,536,.24],[513,548,.23],[454,575,.24]]){const p=groundHit(u,v);if(p.y>0)attach('shrub',p.x,p.z,h,1.27,2+random()*1.5,1.28);}
  // Short rhizomes, seedling leaves and mature bunches share an irregular footprint.
  // This leaves a narrow worn route in front of the steps and cobbles between root mounds.
  const biomeRandom=rng(3276851);
  const pathStrip=(x,d)=>{const u=Math.max(0,Math.min(1,(d-11.25)/3.04));const trailX=mix(-.36,-.93,u)+.16*Math.sin(u*Math.PI*2);return d>10.85&&d<14.96?Math.abs(x-trailX):4.;};
  const safe=(x,d,h)=>{
    if(groundY(x,-d)<.034)return false;
    const test=pix(new THREE.Vector3(x,groundY(x,-d),-d));if(d>12.9&&d<22&&test.x>65&&test.x<448&&test.y<510)return false;
    return pathStrip(x,d)>.16+.20*h && !rocks.some(([px,pz,r])=>Math.hypot(x-px,-d-pz)<r*.64);
  };
  for(const [cx,cz,rx,rz,H] of returnSurvey.mounds){
    const high=Math.max(.11,Math.min(.47,H));const count=8+Math.floor((rx+rz)*14);
    for(let j=0;j<count;j++){
      const angle=biomeRandom()*Math.PI*2,dist=Math.sqrt(biomeRandom()),x=cx+rx*dist*Math.cos(angle),z=cz+rz*dist*Math.sin(angle);
      if(!safe(x,-z,high))continue;
      const choice=biomeRandom(),kind=choice<.14?'heather2':choice<.22?'woodleaf':choice<.29?'fine':choice<.65?'sprig':choice<.9?'carpet':'straw';
      const ht=high*(.24+.56*(1-dist*.49))*(.68+.65*biomeRandom());attach(kind,x,z,ht,.87+biomeRandom()*.72,biomeRandom()*6.283,.84+biomeRandom()*.47);
    }
  }
  for(let i=0;i<526;i++){
    const d=7.5+biomeRandom()**1.04*17.6,x=edgeAt(d)-(.22+biomeRandom()**1.65*6.8),g=groundY(x,-d);
    if(!safe(x,d,.11))continue;
    const growth=.56+.19*Math.sin(x*2.24+d*.57)+.21*Math.sin(d*1.53-x*.92)+.12*Math.cos(x*4.61+d*2.79);
    if(growth<.31)continue;
    const count=3+Math.floor(8*growth),habitat=biomeRandom(),radius=.11+biomeRandom()*.50;
    for(let j=0;j<count;j++){
      const a=biomeRandom()*6.283,rr=radius*Math.sqrt(biomeRandom()),u=x+rr*Math.cos(a),v=d+rr*Math.sin(a);
      if(!safe(u,v,.09))continue;const pick=biomeRandom();let kind,ht;
      if(habitat<.29){kind=pick<.73?'moss':'moss2';ht=.019+biomeRandom()*.058;}
      else if(habitat<.79){kind=pick<.53?'carpet':pick<.8?'straw':'sprig';ht=kind==='straw'?.025+biomeRandom()*.042:.065+biomeRandom()*.128;}
      else{kind=pick<.081?'heather2':pick<.15?'woodleaf':pick<.26?'fern':pick<.65?'sprig':'carpet';ht=.075+biomeRandom()**1.5*(kind==='fern'?.23:.19);}
      attach(kind,u,-v,ht,.84+biomeRandom()*.99,biomeRandom()*6.283,.88+biomeRandom()*.41);
    }
    if(g>.10 && biomeRandom()<.11){const kind=biomeRandom()<.66?'branch':'branch2';attach(kind,x,-d,.037+biomeRandom()**1.5*.15,1.,biomeRandom()*6.283,.88+biomeRandom()*.20);}
  }
  // The entrance succeeds the foreground bush before the camera first sees the dock.
  // These are individually rooted stems measured against its opening silhouette.
  const pioneer=rng(563289),entranceClumps=[[341,794,725,84,'willow'],[302,779,744,55,'sedge'],[242,837,782,84,'sedge'],[193,791,751,57,'sedge'],[204,739,715,44,'herb'],[260,774,745,40,'herb'],[307,815,776,45,'sedge'],[174,754,727,39,'herb'],[326,790,748,47,'willow'],[372,795,755,38,'willow'],[140,808,768,49,'sedge'],[271,810,766,43,'sedge']];
  for(const [u,base,top,width,guild] of entranceClumps){const c=groundHit(u,base);if(c.y<.025)continue;
    const h=Math.min(.47,Math.max(.105,atD(u,top,-c.z).y-c.y)),rad=width*(-c.z)/1830;
    for(let i=0;i<16;i++){
      const a=pioneer()*6.283,l=Math.sqrt(pioneer()),x=c.x+rad*l*Math.cos(a),z=c.z+rad*l*Math.sin(a)*.72;if(groundY(x,z)<.015)continue;
      const p=pioneer(),kind=guild==='willow'?(p<.22?'shrub':p<.51?'heather2':p<.71?'sprig':p<.85?'sedge2':'fine'):guild==='sedge'?(p<.32?'fine':p<.70?'sedge2':p<.82?'straw':'sprig'):(p<.20?'shrub':p<.50?'sprig':p<.71?'moss2':p<.86?'fine':'carpet');
      attach(kind,x,z,h*(.55+.45*(1-l))*(.73+.37*pioneer()),.93+.54*pioneer(),pioneer()*6.283,.90+.43*pioneer(),true);
    }
  }
  // Grounded understorey lies behind the foreground pine and avoids the cabin footprint.
  // The two depth bands transmit different gaps between the pine trunks in the opening view.
  const timberline=rng(13150973);
  for(let row=0;row<2;row++)for(let j=0;j<19;j++){
    const u=-26+j*7.4+(timberline()-.5)*5.4,d=(row===0?18.1:23.25)+timberline()*2.85;
    const p=atD(u,468,d),yy=groundY(p.x,p.z),cut=450.+4.*Math.sin(u*.117+.8*row)+2.7*Math.sin(u*.307)+timberline()*4.;
    const h=Math.min(1.26,Math.max(.43,atD(u,cut,d).y-yy));
    attach(j%4===0?'shrub':'heather2',p.x,p.z,h,1.17+timberline()*.61,timberline()*6.283,.59+timberline()*.33,true);
    for(let a=0;a<3;a++){const xx=p.x+(timberline()-.5)*.64,zz=p.z+(timberline()-.5)*.84;
      attach(a===0?'fern':a===1?'woodleaf':'sedge2',xx,zz,h*(.19+.38*timberline()),1.15+timberline()*.65,timberline()*6.283,.65+.23*timberline(),true);}
  }
  // Locate adjoining culms within the photographed moss pockets, between the
  // granite shoulders. The low ones keep the small rock ledges visible.
  const sedgeBeds=[
    [-2.19,-10.36,.17],[-2.10,-10.31,.20],[-2.01,-10.29,.16],[-1.94,-10.35,.17],
    [-1.85,-10.29,.15],[-1.77,-10.23,.17],[-2.27,-10.48,.14],[-2.30,-10.58,.16],
    [-2.17,-10.57,.16],[-2.12,-10.52,.13],[-2.12,-10.16,.14],[-2.04,-10.10,.15],
    [-1.74,-10.09,.13],[-1.68,-10.14,.13],[-1.99,-10.42,.15],[-1.94,-10.46,.14],
    [-1.82,-6.22,.13],[-1.68,-6.21,.12],[-1.62,-6.39,.15],[-1.75,-6.46,.15],
    [-.30,-13.38,.12],[-.43,-13.45,.13],[-.37,-13.54,.15],[-.15,-13.47,.12]
  ];
  sedgeBeds.forEach(([x,z,h],i)=>{
    if(allowed(x,-z,h))attach('rootedSedge',x,z,h,1.04+.18*Math.sin(i*1.8),i*2.39996,.91+.13*Math.sin(i*.91),true);
  });
  const anchors={};const dummy=new THREE.Object3D();
  for(const [kind,items] of Object.entries(types)){
    if(!items.length)continue;const rooted=kind==='rootedSedge',blade=kind==='fine'||rooted;const geo=kind==='tuft'?tuftGeometry():blade?fineBlades(rooted):decode(kind);const herb=Boolean(botanics[kind]);const map=herb?tex.botanics:tex[kind==='tuft'||kind==='sedge2'?'sedge':kind];
    const mat=new THREE.ShaderMaterial({vertexShader:blade?bladeVert:leavesVert,fragmentShader:rooted?rootedBladeFrag:blade?bladeFrag:leavesFrag,uniforms:{clock,...tex.second,frontImg:{value:tex.first},frontMask:{value:tex.surface},plantMap:{value:map},plantAlpha:{value:herb?tex.herbAlpha:tex.alpha},alphaChannel:{value:herb?new THREE.Vector3(1,0,0):(kind==='shrub'?new THREE.Vector3(0,0,1):kind==='grass'?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0))}},side:THREE.DoubleSide,toneMapped:false});
    if(rooted)mat.userData.fixedSurfacePigment=true;
    const mesh=new THREE.InstancedMesh(geo,mat,items.length);const base=[],size=[];const xyz=geo.getAttribute('position');let highest=0;for(let i=1;i<xyz.count;i++)if(xyz.getY(i)>xyz.getY(highest))highest=i;
    for(let i=0;i<items.length;i++){
      const p=items[i];dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(0,p.yaw,0);if(['branch','branch2','straw','moss','moss2'].includes(kind)){
        const e=.047;const n=new THREE.Vector3((groundY(p.x-e,p.z)-groundY(p.x+e,p.z))/(2*e),1,(groundY(p.x,p.z-e)-groundY(p.x,p.z+e))/(2*e)).normalize();
        dummy.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),n));
      }dummy.scale.set(p.h*p.spread,p.h,p.h*p.spread);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);base.push(p.x,p.y,p.z);size.push(p.h,p.hue,kind.startsWith('branch')?0:kind.startsWith('moss')?.21:kind==='shrub'||kind.startsWith('heather')?.44:1.);
      if(kind==='fine'&&i<2){const tip=new THREE.Vector3().fromBufferAttribute(xyz,highest).applyMatrix4(dummy.matrix);anchors[i===0?'A':'B']={point:new THREE.Vector3(p.x,p.y,p.z),tip,height:p.h};}
    }
    geo.setAttribute('groupBase',new THREE.InstancedBufferAttribute(new Float32Array(base),3));geo.setAttribute('sizeHue',new THREE.InstancedBufferAttribute(new Float32Array(size),3));mesh.computeBoundingSphere();mesh.name='bank vegetation · '+kind;group.add(mesh);
  }
  const grassEvidence=t=>Object.fromEntries(Object.entries(anchors).map(([key,a])=>{const w=waveAt(t,a.point.x,a.point.z);const shift=a.height*w.amplitude;const tip=a.tip.clone().add(new THREE.Vector3(WX*shift,0,WZ*shift));return [key,{root:a.point.clone(),tip,restTip:a.tip.clone(),height:a.height,wind: w.gust,response:w.response,tipShift:shift,phase:w.phase}];}));
  return {grassEvidence,anchors,cast,counts:Object.fromEntries(Object.entries(types).map(([k,a])=>[k,a.length]))};
}
function headlandScrub(group,tex,clock){
  const pos=[],tint=[],ix=[];const random=rng(216043);
  function append(p,rgb,c=1){pos.push(p.x,p.y,p.z);const col=new THREE.Color().setRGB(rgb[0],rgb[1],rgb[2],THREE.SRGBColorSpace);tint.push(col.r*c,col.g*c,col.b*c);}
  // The little broken silhouettes at the far gravel spit subtend only a few source pixels.
  // Each leaf-bearing shoot occupies three dimensions and can reveal an independently shaded back.
  for(const [u,v,r,depth,cr,cg,cb] of shoots){
    const center=farShorePoint(u,v,depth),rad=r*(-center.z)/915,base=pos.length/3,seed=random()*6.28,chrom=[cr,cg,cb];
    append(center.clone().add(new THREE.Vector3(0,-rad*.73,0)),chrom,.63);
    for(let i=0;i<5;i++){const angle=seed+1.2566371*i,rr=rad*(.78+.37*random());append(center.clone().add(new THREE.Vector3(rr*Math.cos(angle),(.08+.20*random())*rad,rr*Math.sin(angle))),chrom,.79+.23*random());}
    append(center.clone().add(new THREE.Vector3(rad*.11,rad*(.63+.37*random()),-.09*rad)),chrom,1.09);
    for(let j=0;j<5;j++){const a=base+1+j,b=base+1+(j+1)%5;ix.push(base,a,b,base+6,b,a);}
  }
  const stem=(u,v,tx,tv,r)=>{const a=farShorePoint(u,v,.77),b=farShorePoint(tx,tv,.79),n=pos.length/3;for(const [p,rr] of [[a,r],[b,r*.55]])for(let j=0;j<5;j++){const t=j*1.2566371;append(p.clone().add(new THREE.Vector3(Math.cos(t)*rr,0,Math.sin(t)*rr)),[.32,.29,.19],.79+.12*Math.cos(t));}for(let j=0;j<5;j++){const x=n+j,y=n+(j+1)%5;ix.push(x,y,x+5,y,y+5,x+5);}};
  stem(668.1,474.3,668.0,460.2,.027);stem(668.0,468.2,665.6,464.3,.015);stem(668.0,466.2,670.45,462.65,.014);
  const geom=addGeometry(pos,ix,{tint:[tint,3]});const mat=new THREE.ShaderMaterial({uniforms:{...tex.second,frontImg:{value:tex.first},frontMask:{value:tex.surface},clock},side:THREE.DoubleSide,toneMapped:false,
    vertexShader:`attribute vec3 tint;centroid varying vec3 lc,restPlant,initialPlant;void main(){restPlant=(modelMatrix*vec4(position,1.)).xyz;initialPlant=restPlant;lc=tint;gl_Position=projectionMatrix*viewMatrix*vec4(restPlant,1.);}`,
    fragmentShader:botanicalColour+`centroid varying vec3 lc;void main(){gl_FragColor=vec4(botanicalLight(lc),1.);
    #include <colorspace_fragment>
    }`});const mound=new THREE.Mesh(geom,mat);mound.name='Depth-resolved scrub and one sapling on the gravel spit';group.add(mound);
}
function woodlandLitter(group,tex){
  const random=rng(19130071),pos=[],uv=[],color=[],ix=[];let leaves=0,pairs=0;
  const grit=(x,z)=>groundY(x,z);
  // One dry shoot sheds paired needles around a common base. Raise their arch only millimetres above the litter.
  function needle(x,z,angle,length,width){
    const dx=Math.cos(angle),dz=Math.sin(angle),k=pos.length/3,age=random(),bow=(random()-.5)*.008;
    for(let j=0;j<4;j++){
      const h=j/3,wx=x+dx*length*h-dz*bow*Math.sin(Math.PI*h),wz=z+dz*length*h+dx*bow*Math.sin(Math.PI*h);
      const y=grit(wx,wz)+.004+.005*Math.sin(Math.PI*h),w=width*(1.-h*.76),variety=.62+.45*age+.12*h;
      for(const side of [-1,1]){pos.push(wx-dz*w*side,y+.0008*(side+1),wz+dx*w*side);uv.push(-1,-1);color.push(.16*variety,.094*variety,.034*variety);}
      if(j<3){const n=k+j*2;ix.push(n,n+1,n+2,n+2,n+1,n+3);}
    }
  }
  function leaf(x,z,ang,len,wid){
    const dx=Math.cos(ang),dz=Math.sin(ang),k=pos.length/3,tile=Math.floor(random()*4),bend=(.05+.28*random())*len,twist=(random()-.5)*.26,shade=.67+.52*random();
    for(let j=0;j<4;j++)for(let i=0;i<3;i++){
      const t=j/3-.5,u=i/2-.5,spine=.31+Math.sin((t+.5)*Math.PI)*.69;
      const xx=x+dx*t*len-dz*u*wid,zz=z+dz*t*len+dx*u*wid;
      const y=grit(xx,zz)+.005+bend*((u*u*3.4)*spine+.52*(t+.18)**2)+twist*len*u*t;
      pos.push(xx,y,zz);uv.push((tile%2+(i/2)*.96+.02)/2,1-(Math.floor(tile/2)+(j/3)*.96+.02)/2);color.push(shade,shade,shade);
      if(i<2&&j<3){const n=k+j*3+i;ix.push(n,n+1,n+3,n+3,n+1,n+4);}
    }
  }
  for(let c=0;c<377;c++){
    const d=6.9+random()**1.07*21.8,edge=edgeAt(d),x=edge-(.06+random()**1.07*7.3),z=-d;
    if(grit(x,z)<.018)continue;const shade=.49+.24*Math.sin(x*1.52+d*.73)+.22*Math.cos(d*2.3-x*.81);
    if(shade<.22)continue;const r=.11+random()*.52,orient=random()*6.28,hab=random();
    const count=7+Math.floor((hab<.17?17:34)*random());
    for(let j=0;j<count;j++){
      const a=random()*6.283,dist=r*Math.sqrt(random()),px=x+dist*Math.cos(a),pz=z+dist*Math.sin(a);
      if(grit(px,pz)<.014)continue;
      if(hab<.18||random()<.091){const len=.034+random()**1.5*.088;leaf(px,pz,random()*6.283,len,len*(.36+.33*random()));leaves++;}
      else{const direction=orient+(random()-.5)*3.85,len=.031+.081*random();needle(px,pz,direction,len,.00065+.00059*random());needle(px,pz,direction+.13+random()*.53,len*(.66+random()*.42),.00074);pairs++;}
    }
  }
  const geo=addGeometry(pos,ix,{uv:[uv,2],tint:[color,3]});
  const mat=new THREE.ShaderMaterial({side:THREE.DoubleSide,toneMapped:false,uniforms:{...tex.second,frontImg:{value:tex.first},frontMask:{value:tex.surface},leaves:{value:tex['dry-leaves']},leavesMask:{value:tex.litterAlpha}},vertexShader:`attribute vec3 tint;centroid varying vec2 lu;centroid varying vec3 lc,restPlant,initialPlant;
  void main(){restPlant=(modelMatrix*vec4(position,1.)).xyz;initialPlant=restPlant;lc=tint;lu=uv;gl_Position=projectionMatrix*viewMatrix*vec4(restPlant,1.);}`,
  fragmentShader:botanicalColour+`uniform sampler2D leaves,leavesMask;centroid varying vec2 lu;centroid varying vec3 lc;void main(){vec3 c=lc;if(lu.x>=0.){float a=texture2D(leavesMask,lu).r;if(a<.41)discard;c*=texture2D(leaves,lu).rgb;}gl_FragColor=vec4(botanicalLight(c),1.);
  #include <colorspace_fragment>
  }`});
  const carpet=new THREE.Mesh(geo,mat);carpet.name='fallen needles and cupped leaves';group.add(carpet);return {leafCount:leaves,pairedNeedles:pairs};
}
function shadows(stones,plants){
  const cv=document.createElement('canvas');cv.width=1536;cv.height=2208;const g=cv.getContext('2d');g.fillStyle='white';g.fillRect(0,0,cv.width,cv.height);
  // Directional contact shading on the continuous terrain, baked in world space.
  const sx=x=>(x+22)*48, sy=z=>(6-z)*48;
  function shade(x,z,rx,rz,yaw,a){const X=sx(x),Y=sy(z);if(X<-80||Y<-80||X>cv.width+80||Y>cv.height+80)return;g.save();g.translate(X,Y);g.rotate(-yaw);g.scale(Math.max(.5,rx*48),Math.max(.5,rz*48));const grad=g.createRadialGradient(0,0,0,0,0,1);grad.addColorStop(0,`rgba(0,0,0,${a})`);grad.addColorStop(.48,`rgba(0,0,0,${a*.76})`);grad.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=grad;g.fillRect(-1,-1,2,2);g.restore();}
  for(const [x,z,rx,rz,h,rot] of stones){shade(x-.24*h*sunDirection.x/sunDirection.y,z-.24*h*sunDirection.z/sunDirection.y,rx*1.55,rz*1.47,rot,.74);}
  for(const [x,z,rx,rz,h,rot] of plants){shade(x-.16*h*sunDirection.x/sunDirection.y,z-.16*h*sunDirection.z/sunDirection.y,rx*1.48,rz*1.48,rot,.47);}
  shade(-2.92,-15.18,2.50,1.19,.89,.72);shade(-1.57,-15.08,1.91,.87,.99,.52);shade(-5.16,-17.25,3.45,2.13,.70,.61);
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.NoColorSpace;t.anisotropy=8;return t;
}
export function buildBank(ctx){
  const loader=new THREE.TextureLoader(), tex={};
  for(const type of ['surface','soil','heath','granite','sedge','grass','shrub','turf','shingle','boulder-scan','plant-alpha','return','approach','moraine','needles','entry-bed','ledge','botanics','botanics-alpha','dry-leaves','dry-leaves-alpha']){const t=loader.load(new URL('./art/bank-'+type+'.webp',import.meta.url).href);t.colorSpace=type.endsWith('alpha')?THREE.NoColorSpace:THREE.SRGBColorSpace;t.anisotropy=8;if(['soil','heath','granite','turf','shingle','needles'].includes(type))t.wrapS=t.wrapT=THREE.RepeatWrapping;tex[type==='boulder-scan'?'boulder':type==='plant-alpha'?'alpha':type==='botanics-alpha'?'herbAlpha':type==='dry-leaves-alpha'?'litterAlpha':type]=t;}
  tex.measuredStone=loader.load(new URL('./art/bank-stone-binding.png',import.meta.url).href);
  tex.measuredStone.colorSpace=THREE.NoColorSpace;
  tex.measuredStone.minFilter=tex.measuredStone.magFilter=THREE.NearestFilter;
  tex.measuredStone.generateMipmaps=false;
  tex.first=ctx.refTexture;tex.second={approachPhoto:{value:tex.approach},approachVP:{value:new THREE.Matrix4().fromArray(approachSurvey.vp)},approachEye:{value:new THREE.Vector3(...approachSurvey.eye)},returnVP:{value:new THREE.Matrix4().fromArray(returnSurvey.vp)},returnEye:{value:new THREE.Vector3(...returnSurvey.eye)},observer:{value:ctx.camera.position},returnPhoto:{value:tex.return}};
  const group=new THREE.Group();group.name='rocky bank and vegetation';ctx.scene.add(group);
  const ground=new THREE.Mesh(terrainMesh(),photoMat(commonVertex,terrainFragment,tex,tex.surface));ground.name='continuous moraine shoreline';group.add(ground);
  const rock=stoneGeometry();const stones=new THREE.Mesh(rock.geo,photoMat(rockVertex,rockFragment,tex,ctx.refTexture));stones.material.userData.fixedSurfacePigment=true;stones.name='shore granite and cobbles';group.add(stones);
  const clock={value:0};const vegetation=foliage(ctx,group,tex,rock.landmarkRocks,clock);ground.material.uniforms.occlusion.value=shadows(rock.casters,vegetation.cast);
  headlandScrub(group,tex,clock);const litter=woodlandLitter(group,tex);
  return {group,litter,entryMarkers:rock.entryMarkers,groundY,update(t){clock.value=t;},grassEvidence:vegetation.grassEvidence,grassAnchors:vegetation.anchors,grassCounts:vegetation.counts,windConfig,shoreline:shorelinePixels.map(([u,v])=>atY(u,v,0))};
}
