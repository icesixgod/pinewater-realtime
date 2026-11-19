import * as THREE from './three.module.js';
import {alpineSurvey} from './art/mountain-survey.js';

const turn=2*Math.PI,eyeHeight=2.05,topSlope=.79,bottomSlope=-.036,angleSpan=topSlope-bottomSlope;
const mix=THREE.MathUtils.lerp;
const smooth=(a,b,x)=>THREE.MathUtils.smoothstep(x,a,b);
const clamp=THREE.MathUtils.clamp;
function bytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0));}
function words(s){
  const a=bytes(s),view=new DataView(a.buffer,a.byteOffset,a.byteLength),out=new Uint16Array(a.length/2);
  for(let i=0;i<out.length;i++)out[i]=view.getUint16(i*2,true);
  return out;
}
const crest=words(alpineSurvey.crest),shore=words(alpineSurvey.shore),foothill=words(alpineSurvey.foothill);
const relief=new Int8Array(bytes(alpineSurvey.relief).buffer),trees=words(alpineSurvey.trees);
const height=alpineSurvey.height,width=alpineSurvey.width;
const slope=row=>topSlope-(row+.5)/height*angleSpan;
const rowAtSlope=x=>(topSlope-x)*height/angleSpan-.5;
function cyclic(arr,index,n=arr.length,offset=0){
  const x=((index%n)+n)%n,i=Math.floor(x);return mix(arr[offset+i],arr[offset+(i+1)%n],x-i);
}
function radialRelief(u,t){
  const n=alpineSurvey.segments,h=alpineSurvey.reliefRows,y=clamp(t,0,1)*(h-1),j=Math.floor(y);
  return .2*mix(cyclic(relief,u*n,n,j*n),cyclic(relief,u*n,n,Math.min(h-1,j+1)*n),y-j);
}
// A one-pixel bank-height change may imply several metres of range at the horizon.
// Fit distances at basin scale. Keep all fine angular observations for the silhouette.
function rangeProfile(samples,span){
  const count=768,res=new Float32Array(count);
  for(let k=0;k<count;k++){
    const center=(k/count)*samples.length-(samples===foothill?0:.5);
    let total=0,weights=0;
    for(let j=-18;j<=18;j++){
      const weight=Math.exp(-.5*(j/6)**2);
      total+=cyclic(samples,center+j*span/6)*weight;weights+=weight;
    }
    res[k]=total/(weights*8);
  }
  return res;
}
const rangeCrest=rangeProfile(crest,66),rangeFoot=rangeProfile(foothill,10),rangeBank=rangeProfile(shore,35);
function hash(x,z,seed){
  let h=Math.imul(x,374761393)+Math.imul(z,668265263)+Math.imul(seed,73129);
  h=Math.imul(h^(h>>>13),1274126177);
  return ((h^(h>>>16))>>>0)/2147483648-1;
}
function terrainNoise(x,z,spacing,seed){
  const a=x/spacing,b=z/spacing,i=Math.floor(a),j=Math.floor(b),f=a-i,g=b-j;
  const fx=f*f*(3-2*f),gz=g*g*(3-2*g);
  return mix(mix(hash(i,j,seed),hash(i+1,j,seed),fx),mix(hash(i,j+1,seed),hash(i+1,j+1,seed),fx),gz);
}
function profile(u){
  const az=(u-.5)*turn,ix=u*crest.length-.5,cs=Math.cos(az),sn=Math.sin(az);
  const top=cyclic(crest,ix)/8,middle=cyclic(foothill,u*foothill.length)/8,water=cyclic(shore,ix)/8;
  const sPeak=slope(top),sFoot=slope(middle),sWater=slope(water);
  const peakMean=slope(cyclic(rangeCrest,u*rangeCrest.length)),footMean=slope(cyclic(rangeFoot,u*rangeFoot.length));
  const waterMean=slope(cyclic(rangeBank,u*rangeBank.length)),shoreR=-eyeHeight/waterMean;
  const backSeam=smooth(2.48,Math.PI,Math.abs(az));
  const priorShore=mix(85.3+7*Math.sin(az*1.5+.35)+2.4*Math.sin(az*4-.2),86,backSeam);
  const oldRange=s=>priorShore+52*smooth(-.019,.058,s)+106*smooth(.044,.19,s)+72*smooth(.265,.51,s);
  const foothillR=Math.max(shoreR+27,oldRange(footMean)+8*Math.sin(az*3+.28)-3*Math.cos(az*6)+5*terrainNoise(sn,cs,.34,42));
  const foothillY=eyeHeight+sFoot*foothillR;
  const valleyR=foothillR+21+5.3*Math.sin(az*3+.4)+2.5*Math.cos(az*7-.1);
  const valleyY=Math.max(1.05,foothillY*(.52+.085*Math.sin(az*4-.38))-.8);
  const massifBase=valleyR+11.5+.43*Math.max(0,foothillY-valleyY);
  const toeY=valleyY+1.3+.16*(foothillY-valleyY);
  const summitR=Math.max(massifBase+43,oldRange(peakMean)+18*Math.sin(az*3+.26)+11*Math.sin(az*5-.47)+10*terrainNoise(sn,cs,.46,3));
  const summitY=eyeHeight+sPeak*summitR;
  const outerR=summitR+Math.max(59,(summitY+2.1)*(1.39+.26*Math.sin(az*3-.3)+.22*Math.cos(az*6+.2))+18*terrainNoise(sn,cs,.53,21));
  return {u,az,sn,cs,top,middle,water,sPeak,sFoot,sWater,peakMean,footMean,shoreR,foothillR,foothillY,valleyR,valleyY,massifBase,toeY,summitR,summitY,outerR};
}
function hillRadius(p,t){
  return mix(p.shoreR,p.foothillR,t);
}
function woodedSlope(p,t,r=hillRadius(p,t)){
  if(t<=0)return 0;if(t>=1)return p.foothillY;
  const x=r*p.sn,z=-r*p.cs,w=Math.sin(Math.PI*t);
  const broad=eyeHeight+p.footMean*p.foothillR;
  const hill=broad*Math.pow(t,.96)+(p.foothillY-broad)*t*t;
  const relief=4.6*terrainNoise(x,z,23,11)+2.1*terrainNoise(x,z,10,5)+.76*terrainNoise(x,z,4.7,8);
  const y=hill+w*relief*Math.min(1,.16+p.foothillY*.062);
  return clamp(y,.028*t,eyeHeight+r*(p.sFoot-.005*(1-t)));
}
// Lighting gradients in the real rock photograph provide tangent-slope cues. A
// meandering flow path advects them laterally; nearer grades also have their
// own spatially anchored ribs and gullies, independent of a summit pixel.
function graniteFront(p,t,r){
  if(t>=1)return p.summitY;
  const x=p.sn*r,z=-p.cs*r,window=Math.sin(Math.PI*t),wide=eyeHeight+p.peakMean*p.summitR;
  const bend=(1-t)*(.013*Math.sin(5*p.az+1.1+2.6*t)+.008*Math.sin(9*p.az-1.7*t-.3));
  const surveyed=radialRelief(p.u+bend,t);
  const xx=x+5.8*terrainNoise(x,z,51,23),zz=z+6.9*terrainNoise(x,z,46,37);
  const ridge=1-2*Math.abs(terrainNoise(xx,zz,24,17));
  const gullies=1-2*Math.abs(terrainNoise(xx,zz,12.5,51));
  const elevation=wide-p.toeY,capacity=Math.min(1,Math.max(0,elevation)/38);
  const rocky=7.8*terrainNoise(xx,zz,41,31)+4.2*terrainNoise(xx,zz,19,59)
    +5.1*(ridge-.40)-2.05*(gullies-.35)+1.25*terrainNoise(xx,zz,5.5,72);
  const base=mix(p.toeY,wide,Math.pow(t,1.18));
  const fineCrest=(p.summitY-wide)*smooth(.40,1,t);
  const out=base+fineCrest+capacity*(1.18*surveyed+window*rocky);
  return clamp(out,p.toeY*.64,eyeHeight+r*(p.sPeak-.006*(1-t)));
}
function angularKnots(){
  const n=crest.length,knots=[];
  // The angular edge is sampled adaptively in the native photograph. The land remains
  // one welded circuit, even where a narrow rock notch needs its own vertex.
  function segment(i,j){
    const a=crest[i%n],b=crest[j%n],wa=shore[i%n],wb=shore[j%n];
    let error=0,farthest=0;
    for(let k=i+1;k<j;k++){
      const u=(k-i)/(j-i);
      const e=Math.max(Math.abs(crest[k%n]-mix(a,b,u))*.125,Math.abs(shore[k%n]-mix(wa,wb,u))*.071);
      if(e>error){error=e;farthest=k;}
    }
    if(error>.64&&j-i>1){segment(i,farthest);segment(farthest,j);}
    else knots.push((i+.5)/n);
  }
  for(let i=0;i<n;){
    const a=((i+.5)/n-.5)*turn,step=a>-1.15&&a<1.92?8:16,j=Math.min(n,i+step);
    segment(i,j);i=j;
  }
  return knots;
}
function fromPolar(az,r,y){return [Math.sin(az)*r,y,-Math.cos(az)*r];}
function terrainGeometry(){
  const angles=angularKnots(),n=angles.length,columns=[],position=[],uv=[],alternate=[],indices=[];
  let rmin=Infinity,rmax=0,hmin=Infinity,hmax=-Infinity,maxFrontCorrection=0;
  for(const u of angles){
    const p=profile(u),section=[];
    function add(r,y,sampleRow,back=0){
      rmin=Math.min(rmin,r);rmax=Math.max(rmax,r);hmin=Math.min(hmin,y);hmax=Math.max(hmax,y);
      section.push({point:fromPolar(p.az,r,y),v:1-(sampleRow+.5)/height,back});
    }
    const underwater=p.shoreR-8.7;
    add(underwater,-2.45,p.water+1,1);
    for(let j=0;j<=18;j++){
      const t=j/18,r=hillRadius(p,t),y=woodedSlope(p,t,r);
      add(r,y,rowAtSlope((y-eyeHeight)/r));
    }
    for(let j=1;j<=6;j++){
      const t=j/6,r=mix(p.foothillR,p.valleyR,t),drop=(1-Math.cos(Math.PI*t))*.5;
      const y=mix(p.foothillY,p.valleyY,drop)+Math.sin(Math.PI*t)*1.4*terrainNoise(r*p.sn,-r*p.cs,18,16);
      add(r,y,rowAtSlope((y-eyeHeight)/r));
    }
    for(let j=1;j<=4;j++){
      const t=j/4,r=mix(p.valleyR,p.massifBase,t),y=mix(p.valleyY,p.toeY,t);
      add(r,y,rowAtSlope((y-eyeHeight)/r));
    }
    for(let j=1;j<=37;j++){
      const t=j/37,r=mix(p.massifBase,p.summitR,t),y=graniteFront(p,t,r);
      add(r,y,rowAtSlope((y-eyeHeight)/r));
    }
    for(let j=1;j<=17;j++){
      const t=j/17,w=Math.sin(Math.PI*t),r=mix(p.summitR,p.outerR,t),x=r*p.sn,z=-r*p.cs;
      const wide=eyeHeight+p.peakMean*p.summitR;
      const macro=8*terrainNoise(x,z,41,6)+4.5*terrainNoise(x,z,18,13)+1.2*terrainNoise(x,z,7,22);
      const y=mix(wide,-1.8,t*(1.10-.10*t))+(p.summitY-wide)*(1-smooth(0,.59,t))+w*macro;
      const tex=mix(p.top+2,p.middle+(.67*(p.water-p.middle)),t);
      add(r,y,tex,Math.min(1,t*5));
    }
    add(p.outerR,-5.4,p.water-3,1);
    add(underwater,-5.4,p.water-3,1);
    columns.push(section);
  }
  const rows=columns[0].length;
  for(let j=0;j<rows;j++)for(let i=0;i<n;i++){
    const q=columns[i][j];position.push(...q.point);uv.push(angles[i],q.v);alternate.push(q.back);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<n;i++){
    const k=(i+1)%n,l=(j+1)%rows,a=j*n+i,b=j*n+k,c=l*n+i,d=l*n+k;
    if((i+j)%2===0)indices.push(a,b,c,b,d,c);
    else indices.push(a,b,d,a,d,c);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(position,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('basinBack',new THREE.Float32BufferAttribute(alternate,1));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();
  g.userData={angularColumns:n,profileRings:rows,nearRadius:rmin,farRadius:rmax,minimumHeight:hmin,maximumHeight:hmax,maxMonotonicCorrection:maxFrontCorrection,closed:true};
  return g;
}
function crownGeometry(){
  const pos=[],uv=[],back=[],idx=[];
  for(let k=0;k<trees.length;k+=4){
    const x=trees[k],tip=trees[k+1],heightPx=trees[k+2]/4,halfPx=trees[k+3]/4;
    const u=(x+.5)/width,p=profile(u),foot=Math.min(p.water-2,tip+heightPx);
    // Solve where this photographed root ray intersects the sculpted near hillside.
    const target=slope(foot);let lo=0,hi=1;
    for(let j=0;j<14;j++){
      const t=(lo+hi)*.5,r=hillRadius(p,t);
      if((woodedSlope(p,t,r)-eyeHeight)/r<target)lo=t;else hi=t;
    }
    const t=(lo+hi)*.5;if(t<.01||t>.995)continue;
    const r=hillRadius(p,t),base=woodedSlope(p,t,r)-.105,apex=eyeHeight+slope(tip)*r;
    const spread=r*turn*halfPx/width,ht=apex-base;if(ht<.65||spread<.13)continue;
    const cx=r*Math.sin(p.az),cz=-r*Math.cos(p.az),phase=(x*.367)%turn;
    const seed=pos.length/3,sides=7;
    const point=(x,y,z)=>{pos.push(x,y,z);uv.push(u,1-(tip+.5)/height);back.push(0);};
    point(cx,base,cz);
    for(const [z,s] of [[.04,.56],[.18,.96],[.27,.53],[.40,.79],[.50,.38],[.61,.55],[.70,.25],[.79,.32]]){
      for(let j=0;j<sides;j++){
        const a=turn*j/sides+phase,radius=spread*s*(.93+.13*Math.sin(x+j*4.37));
        point(cx+radius*Math.cos(a),base+ht*z+ht*.013*Math.sin(j*9.7+phase),cz+radius*Math.sin(a));
      }
    }
    const top=pos.length/3;point(cx+.026*spread*Math.sin(phase),apex,cz+.033*spread*Math.cos(phase));
    for(let j=0;j<sides;j++){
      const d=(j+1)%sides;idx.push(seed,seed+1+j,seed+1+d);
      for(let z=0;z<7;z++){const a=seed+1+z*sides+j,b=seed+1+z*sides+d;idx.push(a,a+sides,b,b,a+sides,b+sides);}
      const a=seed+1+7*sides+j,b=seed+1+7*sides+d;idx.push(a,top,b);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('basinBack',new THREE.Float32BufferAttribute(back,1));g.setIndex(idx);g.computeVertexNormals();g.computeBoundingSphere();g.userData.treeCount=pos.length/(3*58);return g;
}
function silhouetteTexture(){
  const data=new Uint8Array(crest.length*4);
  for(let i=0;i<crest.length;i++){
    const k=crest[i];data[i*4]=k>>8;data[i*4+1]=k&255;data[i*4+3]=255;
  }
  const t=new THREE.DataTexture(data,crest.length,1,THREE.RGBAFormat,THREE.UnsignedByteType);
  t.minFilter=t.magFilter=THREE.NearestFilter;t.wrapS=THREE.RepeatWrapping;t.generateMipmaps=false;t.needsUpdate=true;return t;
}
const imageSampling=`
  uniform sampler2D alpineSeam,alpineCrest,alpineObservation;
  varying vec3 vAlpineRay;varying float vAlpineV,vAlpineBack;
  float alpineRow(float u){
    vec2 rg=texture2D(alpineCrest,vec2(u,.5)).rg;
    return dot(rg,vec2(65280.,255.))*.125;
  }
  vec4 basinSample(vec2 sourceUV){
    vec2 dx=dFdx(sourceUV),dy=dFdy(sourceUV);
    dx.x-=floor(dx.x+.5);dy.x-=floor(dy.x+.5);
    vec4 sampleColor=textureGrad(map,sourceUV,dx,dy);
    vec2 observedPixel=vec2(sourceUV.x*8192.,(1.-sourceUV.y)*1176.);
    vec2 patchCoord=(observedPixel-vec2(${alpineSurvey.observation[0]}.0,${alpineSurvey.observation[1]}.0))/vec2(${alpineSurvey.observation[2]}.0,${alpineSurvey.observation[3]}.0);
    if(all(greaterThan(patchCoord,vec2(0.)))&&all(lessThan(patchCoord,vec2(1.)))){
      vec2 scale=vec2(8192./${alpineSurvey.observation[2]}.0,1176./${alpineSurvey.observation[3]}.0);
      sampleColor=textureGrad(alpineObservation,vec2(patchCoord.x,1.-patchCoord.y),dx*scale,dy*scale);
    }
    float signedU=fract(sourceUV.x+.5)-.5;
    float halfBand=${(alpineSurvey.seamHalfWidth/alpineSurvey.width).toFixed(10)};
    if(abs(signedU)<halfBand){
      vec2 alt=vec2(.5+signedU/(2.*halfBand),sourceUV.y);
      vec4 repaired=textureGrad(alpineSeam,alt,vec2(dx.x/(2.*halfBand),dx.y),vec2(dy.x/(2.*halfBand),dy.y));
      float weight=1.-smoothstep(halfBand-.00040,halfBand,abs(signedU));
      sampleColor=mix(sampleColor,repaired,weight);
    }
    return sampleColor;
  }
`;
function projectedMaterial(image,wrap,edge,observation,sky=false){
  const mat=new THREE.MeshBasicMaterial({map:image,side:sky?THREE.BackSide:THREE.FrontSide,toneMapped:false,depthWrite:!sky});
  mat.name=sky?'Surveyed alpine sky':'Surveyed alpine rock, taiga and bank';
  mat.onBeforeCompile=shader=>{
    shader.uniforms.alpineSeam={value:wrap};shader.uniforms.alpineCrest={value:edge};shader.uniforms.alpineObservation={value:observation};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float basinBack;varying vec3 vAlpineRay;varying float vAlpineV,vAlpineBack;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vAlpineRay=(modelMatrix*vec4(transformed,1.)).xyz-vec3(0.,2.05,0.);
      vAlpineV=uv.y;vAlpineBack=basinBack;`);
    if(sky)shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
      'vec4 mvPosition=vec4(mat3(viewMatrix)*transformed,1.);gl_Position=projectionMatrix*mvPosition;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','#include <map_pars_fragment>\n'+imageSampling);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      float alpineU=atan(vAlpineRay.x,-vAlpineRay.z)/6.28318530718+.5;
      float altitude=vAlpineRay.y/max(.00001,length(vAlpineRay.xz));
      float alpineV=(altitude+.036)/.826;
      ${sky?`float ridgeV=1.-(alpineRow(alpineU)+.5)/1176.;
      if(alpineV<ridgeV)alpineV=ridgeV+2.3/1176.;
      vec4 basinColour=basinSample(vec2(alpineU,clamp(alpineV,0.,1.)));
      vec3 zenith=vec3(.381326,.450786,.520996);
      diffuseColor.rgb*=mix(basinColour.rgb,zenith,smoothstep(.785,1.13,altitude));`:
      `vec4 basinColour=basinSample(vec2(alpineU,clamp(mix(alpineV,vAlpineV,vAlpineBack),.0002,.9998)));
      diffuseColor*=basinColour;`}
    `);
  };
  mat.customProgramCacheKey=()=>sky?'pinewater-separated-sky-v1':'pinewater-solid-massif-v1';return mat;
}
export function buildMountainBasin(ctx,parent,existingTexture){
  const wrap=new THREE.TextureLoader().load('./art/mountain-wrap.webp');wrap.colorSpace=THREE.SRGBColorSpace;wrap.anisotropy=4;
  const observation=new THREE.TextureLoader().load('./art/mountain-observation.webp');
  observation.colorSpace=THREE.SRGBColorSpace;observation.anisotropy=4;
  const edge=silhouetteTexture();
  // Keep the image resource managed by the original loader; it may still be in flight during assembly.
  existingTexture.wrapS=THREE.RepeatWrapping;
  const landMaterial=projectedMaterial(existingTexture,wrap,edge,observation);
  const land=new THREE.Mesh(terrainGeometry(),landMaterial);
  land.name='Distant shore • continuous granite massif, wooded foothills and lake edge';
  land.userData.basinRole='solidTerrain';land.userData.clayRole='terrain';parent.add(land);
  const conifers=new THREE.Mesh(crownGeometry(),landMaterial);
  conifers.name='Distant shore • measured conifer crowns';conifers.userData.basinRole='solidCrowns';conifers.userData.clayRole='vegetation';parent.add(conifers);
  const skyGeo=new THREE.SphereGeometry(755,128,42);skyGeo.setAttribute('basinBack',new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count),1));
  const sky=new THREE.Mesh(skyGeo,projectedMaterial(existingTexture,wrap,edge,observation,true));
  sky.name='Zenith • photographic sky at infinity';sky.position.y=eyeHeight;sky.frustumCulled=false;sky.renderOrder=-50;
  sky.userData.basinRole='sky';sky.userData.clayRole='sky';sky.userData.clayHidden=true;parent.add(sky);
  return {land,conifers,sky,profile};
}
