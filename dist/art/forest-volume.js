import * as THREE from '../three.module.js';
import {forestScans} from './forest-scan-data.js';
import {forestField as field} from './forest-return-field.js';
import {rimField} from './forest-rim-field.js';
import {needleWitness} from './forest-needle-witness.js';
import {startEye,verticalFov,pitch,sunDirection} from '../calibration.js';

const V=(x,y,z)=>new THREE.Vector3(x,y,z),mix=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
const from64=(text,Class)=>{const buff=Uint8Array.from(atob(text),c=>c.charCodeAt(0));return new Class(buff.buffer);};
function sequence(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
const original=new THREE.PerspectiveCamera(verticalFov,975/984,.045,1200);
original.position.copy(startEye);original.rotation.set(-pitch,0,0,'YXZ');original.updateMatrixWorld();
const returned=new THREE.PerspectiveCamera(77,975/984,.045,1200);
returned.position.set(2.367160326,1.462837313,-7.709169244);returned.rotation.set(-.251935381,.439462803,-.009410762,'YXZ');returned.updateMatrixWorld();
const proj=c=>new THREE.Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse);
const firstVp=proj(original),lastVp=proj(returned);
function atReturn(x,y,depth){return V((2*x/1254-1)*depth/1.268776966,(1-2*y/1254)*depth/1.257172299,-depth).applyMatrix4(returned.matrixWorld);}
function shaderData(ctx) {
  const l=new THREE.TextureLoader();
  function tex(name,color=false){const t=l.load('./art/'+name);if(color)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,ctx.renderer.capabilities.getMaxAnisotropy());return t;}
  return {observed:tex('forest-observed.webp'),leaf:tex('forest-return-foliage.webp',true),range:tex('forest-return-ranges.png'),open:tex('forest-return-open.png'),sprays:tex('forest-sprays.webp',true),
    rim:tex('forest-rim-foliage.webp',true),rimRange:tex('forest-rim-ranges.png')};
}
// The two fixed camera calibrations project material evidence on actual world
// surfaces. The first-camera empty-space cone carves contradictory leaves. The
// second capture is accepted only at its measured range, so distant sky cannot
// be painted on an intervening trunk. No camera-facing rotation is performed.
function evidenceMaterial(mat,ctx,maps,kind,lo=0,hi=100) {
  mat.userData.forestMultiView=true;
  const old=mat.onBeforeCompile, oldkey=mat.customProgramCacheKey(),coverage=mat.userData.forestCoverage??'',firstOnly=mat.userData.sourceOnlyNeedles===true,highPineSource=mat.userData.highPineSource===true;
  const go=kind==='deep', rim=kind==='rim', oldLeaf=kind==='observed', scan=kind==='scanned', back=kind==='backfill';
  mat.onBeforeCompile=function(shader,renderer){
    old.call(this,shader,renderer);
    Object.assign(shader.uniforms,{fwFirst:{value:firstVp},fwLast:{value:lastVp},fwRange:{value:maps.range},fwOpen:{value:maps.open},fwLastMap:{value:maps.leaf},fwRimRange:{value:maps.rimRange},
      fwMask:{value:maps.observed},fwRef:{value:ctx.refTexture},fwFirstEye:{value:original.position},fwLastEye:{value:returned.position},fwSlice:{value:new THREE.Vector2(lo,hi)}});
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nuniform mat4 fwFirst,fwLast;varying vec4 fwCoord0,fwCoord1;varying vec3 fwWorld;').replace('#include <project_vertex>',`#include <project_vertex>
      vec4 fwObject=vec4(transformed,1.);
      #ifdef USE_INSTANCING
      fwObject=instanceMatrix*fwObject;
      #endif
      fwWorld=(modelMatrix*fwObject).xyz;fwCoord0=fwFirst*vec4(fwWorld,1.);fwCoord1=fwLast*vec4(fwWorld,1.);`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      uniform sampler2D fwRange,fwOpen,fwLastMap,fwMask,fwRef,fwRimRange;uniform vec3 fwFirstEye,fwLastEye;uniform vec2 fwSlice;
      varying vec4 fwCoord0,fwCoord1;varying vec3 fwWorld;`).replace('#include <opaque_fragment>',`
      vec2 suv=fwCoord0.xy/fwCoord0.w*.5+.5;vec2 tuv=fwCoord1.xy/fwCoord1.w*.5+.5;
      vec2 returnPixel=vec2(tuv.x,1.-tuv.y)*1254.;
      float inside0=step(.0001,min(min(suv.x,suv.y),min(1.-suv.x,1.-suv.y)))*step(.05,fwCoord0.w);
      tuv.y=1.-(64.+(1.-tuv.y)*1254.)/546.;float inside1=step(.0001,min(min(tuv.x,tuv.y),min(1.-tuv.x,1.-tuv.y)))*step(.05,fwCoord1.w);
      vec2 hull=texture2D(fwMask,suv).rg*inside0;float dLast=5.+78.*texture2D(fwRange,tuv).r;
      vec3 viewRay=normalize(cameraPosition-fwWorld);float da=length(viewRay-normalize(fwFirstEye-fwWorld));
      float db=length(viewRay-normalize(fwLastEye-fwWorld));float weight0=smoothstep(.02,.98,db/(da+db+.000002));
      ${go||rim?`// The supplementary photograph cuts through two crowns. Their upper
      // whorls are sampled on the continuation of the same metric stems.
      float crownJoin=step(-100.,returnPixel.x)*(1.-smoothstep(688.,704.,returnPixel.x))
        *step(returnPixel.y,-25.)*smoothstep(.10,.79,1.-weight0);`:''}
      vec4 other=texture2D(fwLastMap,tuv);vec3 raw=texture2D(fwRef,suv).rgb;
      float nearLast=inside1*(1.-smoothstep(2.5,10.,abs(dLast-fwCoord1.w)));
      float sameTree=inside1*(1.-smoothstep(4.5,18.,abs(dLast-fwCoord1.w)));
      float emptyReturn=inside1*texture2D(fwOpen,tuv).r;
      float freeSpace=inside1*other.a*smoothstep(.40,1.35,dLast-fwCoord1.w);
      vec2 primaryPixel=vec2(suv.x*975.,(1.-suv.y)*984.);
      bool twigGap=(primaryPixel.x>150.&&primaryPixel.x<250.&&primaryPixel.y>165.&&primaryPixel.y<249.)||(primaryPixel.x>309.&&primaryPixel.x<428.&&primaryPixel.y>174.&&primaryPixel.y<271.);
      ${go||scan||back?'if(twigGap&&hull.g>.39&&hull.r<.63)discard;':''}
      float margin=min(min(suv.x,1.-suv.x),min(suv.y,1.-suv.y));
      float exterior=smoothstep(.002,.017,margin)*inside0;
      float openRay=smoothstep(.55,.975,hull.g)*(1.-smoothstep(.14,.47,hull.r))*exterior;
      ${rim?'':'if(openRay>.94)discard;'}
      ${go||oldLeaf?'diffuseColor.a*=1.-.98*openRay;':''}
      ${back?`if(hull.g>.55&&hull.r<.40)discard; if(emptyReturn>.92)discard;` : ''}
      float pineArea=smoothstep(240.,244.,primaryPixel.x)*(1.-smoothstep(325.,330.,primaryPixel.x))*smoothstep(82.,86.,primaryPixel.y)*(1.-smoothstep(203.,208.,primaryPixel.y));
      ${highPineSource||firstOnly?'diffuseColor.a*=1.-pineArea*weight0;if(diffuseColor.a<.006)discard;':''}
      ${rim?`if(crownJoin<.003)discard;
      vec2 tipUV=vec2((returnPixel.x+100.)/804.,1.-(returnPixel.y+304.)/288.);
      float tipDepth=5.+78.*texture2D(fwRimRange,tipUV).r;
      if(tipDepth<fwSlice.x||tipDepth>=fwSlice.y)discard;
      diffuseColor.a*=crownJoin;if(diffuseColor.a<.012)discard;`:''}
      ${go?`if(dLast<fwSlice.x||dLast>=fwSlice.y) discard;
      if(crownJoin>0.){diffuseColor.a*=1.-crownJoin;if(diffuseColor.a<.012)discard;}
      // At this surveyed lodgepole the frontal view resolves sky between
      // whorls which overlap from the boat. Do not count the return-view
      // subpixel coverage a second time on the original observation ray.
      diffuseColor.a*=1.-pineArea*weight0;if(diffuseColor.a<.016)discard;
      vec2 originalPixel=vec2(suv.x*975.,(1.-suv.y)*984.);
      // The rightmost observed spruce tapers from its narrow leader to its
      // lower irregular boughs. Carving the entire crown avoids a suspended
      // lower clump or a rectangular tree edge on the return sightline.
      float lastTree=592.+41.*smoothstep(338.,374.,originalPixel.y)+15.*smoothstep(366.,433.,originalPixel.y)+4.*smoothstep(459.,477.,originalPixel.y)+1.8*sin(originalPixel.y*.167)+1.3*cos(originalPixel.y*.31);
      if(fwSlice.x>=38.5&&originalPixel.x<715.&&originalPixel.y>326.&&originalPixel.y<488.){
        float endBranch=smoothstep(lastTree-2.2,lastTree+3.9,originalPixel.x)*smoothstep(326.,350.,originalPixel.y);
        diffuseColor.a*=1.-endBranch;if(diffuseColor.a<.036)discard;
      }
      if(hull.g>.83&&hull.r<.19)discard;
      outgoingLight=mix(outgoingLight,raw,weight0*smoothstep(.15,.66,hull.r)*smoothstep(.72,.975,diffuseColor.a));` : ''}
      ${firstOnly?`diffuseColor.a*=smoothstep(.24,.85,weight0);if(diffuseColor.a<.028)discard;`:''}
      ${oldLeaf?`diffuseColor.a*=1.-(1.-weight0)*smoothstep(.44,.93,emptyReturn);
      if(diffuseColor.a<.035)discard;
      outgoingLight=mix(outgoingLight,other.rgb,sameTree*other.a*(1.-weight0)*.985);` : ''}
      ${scan?`outgoingLight=mix(outgoingLight,raw,weight0*smoothstep(.26,.88,hull.r)*.68);
      outgoingLight=mix(outgoingLight,other.rgb,sameTree*other.a*(1.-weight0)*.96);` : ''}
      ${coverage==='core'?'if(diffuseColor.a<.961)discard;':coverage==='fringe'?'if(diffuseColor.a>=.961)discard;':''}
      #include <opaque_fragment>`);
    // MSAA can cover a subpixel twig while the pixel centre lies outside
    // its slender triangle. Sample colour and registration at covered positions.
    if(scan && !mat.map){
      for(const [stage,code] of [['vertex','vertexShader'],['fragment','fragmentShader']]){
        const chunk='color_pars_'+stage;
        shader[code]=shader[code].replace('#include <'+chunk+'>',THREE.ShaderChunk[chunk].replaceAll('varying ','centroid varying '))
          .replaceAll('varying vec4 fwCoord0','centroid varying vec4 fwCoord0')
          .replaceAll('varying vec3 fwWorld','centroid varying vec3 fwWorld');
      }
    }
  };mat.customProgramCacheKey=()=>oldkey+'-forest-deep-'+kind+coverage+(firstOnly?'orient':'')+(highPineSource?'frontlodge':'')+(go||rim?'-'+lo:'');mat.needsUpdate=true;return mat;
}
// The high lodgepole has a single observed broadside in the source interval.
// Its left needle sprays are fitted to the locally measured transmitted sky.
// Each attachment has its own orientation and thickness in metres. Five
// optical-thickness samples preserve fractional occlusion through overlapping
// sprays as the eye moves, and the photograph remains bound to world points.
function highLodgepoleWhorls(ctx,node){
  const levels=[87,105,126,143,157,174,190,205,219],slopes=[.20,.21,.25,.24,.23,.28,.25,.23,.22];
  const bearings=[-.49,.38,-.66,.54,-.31,.62,-.57,.34,-.47];
  const xyz=[],slots=[],idx=[];const l=239,t=81,r=332,b=210;const sx=[],sy=[];
  for(let x=l;x<r;x+=3)sx.push(x);sx.push(r);for(let y=t;y<b;y+=3)sy.push(y);sy.push(b);
  for(let i=0;i<levels.length;i++)for(let j=4;j>=0;j--){
    const seen=new Map(),thickness=(j-2)*.071;
    function pos(k,h){const id=h*sx.length+k;if(seen.has(id))return seen.get(id);const x=sx[k],y=sy[h],u=(x-214)/176,v=(y-20)/449,reach=Math.abs(x-303.5)/65;
      const trunk=21.8-.68*Math.sin(Math.PI*u)*Math.sin(Math.PI*v)+.19*Math.sin(12*u+19*v);
      const z=trunk+bearings[i]*reach**1.18+thickness*(.71+.72*reach)+.055*reach*Math.sin((x+y)*.16+i);
      const p=ctx.atD(x,y,z),at=xyz.length/3;xyz.push(p.x,p.y,p.z);slots.push(i%3,Math.floor(i/3));seen.set(id,at);return at;}
    for(let h=0;h<sy.length-1;h++)for(let k=0;k<sx.length-1;k++){const x=(sx[k]+sx[k+1])*.5, y=(sy[h]+sy[h+1])*.5,arm=Math.abs(x-303.5);
      const axis=levels[i]-slopes[i]*arm+.9*Math.sin(arm/13+i*.69);if(Math.abs(y-axis)>20)continue;
      const a=pos(k,h),b=pos(k+1,h),c=pos(k+1,h+1),e=pos(k,h+1);idx.push(a,e,b,b,e,c);}
  }
  const map=new THREE.TextureLoader().load('./art/forest-lodgepole-whorls.png');map.colorSpace=THREE.SRGBColorSpace;map.generateMipmaps=false;map.minFilter=map.magFilter=THREE.LinearFilter;
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));g.setAttribute('lodgeTile',new THREE.Float32BufferAttribute(slots,2));g.setIndex(idx);
  const m=new THREE.ShaderMaterial({uniforms:{lodgeMap:{value:map},lodgeVP:{value:firstVp},firstEye:{value:original.position},returnEye:{value:returned.position}},side:THREE.DoubleSide,transparent:true,depthWrite:false,toneMapped:false,
    vertexShader:`attribute vec2 lodgeTile;uniform mat4 lodgeVP;varying vec2 tile;varying vec4 observed;varying vec3 worldPoint;
      void main(){tile=lodgeTile;vec4 p=modelMatrix*vec4(position,1.);worldPoint=p.xyz;observed=lodgeVP*p;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader:`uniform sampler2D lodgeMap;uniform vec3 firstEye,returnEye;varying vec2 tile;varying vec4 observed;varying vec3 worldPoint;
      void main(){vec2 suv=observed.xy/observed.w*.5+.5;vec2 p=vec2(975.*suv.x,984.*(1.-suv.y));if(p.x<240.||p.x>330.||p.y<82.||p.y>208.)discard;
        vec2 tex=(tile*vec2(287.,395.)+4.+(p-vec2(239.,81.))*3.)/vec2(861.,1185.);tex.y=1.-tex.y;vec4 c=texture2D(lodgeMap,tex);
        vec3 dir=normalize(cameraPosition-worldPoint);float da=length(dir-normalize(firstEye-worldPoint)),db=length(dir-normalize(returnEye-worldPoint));float confidence=smoothstep(.02,.98,db/(da+db+.000002));
        float coverage=1.-pow(max(.00001,1.-c.a),confidence);if(coverage<.0015)discard;gl_FragColor=vec4(c.rgb,coverage);
        #include <colorspace_fragment>
      }`});
  m.userData.forestMultiView=true;m.userData.forestCoverage='fringe';const mesh=new THREE.Mesh(g,m);mesh.renderOrder=.75;mesh.name='Measured lodgepole • nine left-side whorls';node.add(mesh);return idx.length/3;
}
function fineNeedles(ctx,node,maps){
  const xs=needleWitness.x,ys=needleWitness.y,[l,t,r,b]=needleWitness.box,nx=xs.length;const loader=new THREE.TextureLoader();let faces=0;
  for(const [layer,record] of needleWitness.layers.entries()){
    const d=from64(record.d,Uint16Array),alpha=from64(record.a,Uint8Array),xyz=[],uv=[],index=[],seen=new Map();
    function vertex(id){if(seen.has(id))return seen.get(id);const x=xs[id%nx],y=ys[Math.floor(id/nx)],p=ctx.atD(x,y,d[id]/256),i=xyz.length/3;xyz.push(p.x,p.y,p.z);uv.push((x-l)/(r-l),1-(y-t)/(b-t));seen.set(id,i);return i;}
    for(let y=0;y<ys.length-1;y++)for(let x=0;x<nx-1;x++){const a=y*nx+x;const corners=[a,a+1,a+nx+1,a+nx];if(!corners.some(i=>alpha[i]>3))continue;const [j,k,m,n]=corners.map(vertex);index.push(j,n,k,k,n,m);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(xyz,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);const map=loader.load('./art/forest-fine-needles-'+layer+'.webp');map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
    const m=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide,transparent:true,depthWrite:false,alphaTest:.014,toneMapped:false});m.userData.sourceOnlyNeedles=true;m.userData.forestCoverage='calibrated';evidenceMaterial(m,ctx,maps,'observed');const mesh=new THREE.Mesh(g,m);mesh.name='Subpixel pine-needle coverage, range '+layer;mesh.renderOrder=.62+(5-layer)*.002;node.add(mesh);faces+=index.length/3;
  }return faces;
}
function complementaryNeedleSurface(ctx,node,maps,sections){
  const positions=[],prior=[],texcoords=[],ranges=[],index=[];
  for(const {lo,hi,positions:xyz,uv,indices} of sections){
    const count=xyz.length/3,original=Array.from({length:count},(_,i)=>V(xyz[i*3],xyz[i*3+1],xyz[i*3+2]));
    const front=original.map(p=>ctx.pix(p));
    const nearBough=p=>(p.x>135&&p.x<265&&p.y>150&&p.y<264)||(p.x>294&&p.x<443&&p.y>159&&p.y<286);
    const visible=[];
    for(let t=0;t<indices.length;t+=3){
      if(nearBough(front[indices[t]])||nearBough(front[indices[t+1]])||nearBough(front[indices[t+2]]))visible.push(indices[t],indices[t+1],indices[t+2]);
    }
    if(!visible.length)continue;
    for(const shift of [-.27,.34,-.62,.72]){
      const emitted=new Map();
      for(const i of visible){
        let n=emitted.get(i);
        if(n===undefined){
          n=positions.length/3;emitted.set(i,n);const p=original[i];
          const distance=-p.clone().applyMatrix4(returned.matrixWorldInverse).z;
          const movement=shift*(.81+.012*distance);
          const actual=p.clone().sub(returned.position).multiplyScalar(1+movement/distance).add(returned.position);
          positions.push(actual.x,actual.y,actual.z);prior.push(p.x,p.y,p.z);texcoords.push(uv[2*i],uv[2*i+1]);ranges.push(lo,hi);
        }
        index.push(n);
      }
    }
  }
  const g=new THREE.BufferGeometry();
  for(const [key,arr,size] of [['position',positions,3],['centerSample',prior,3],['uv',texcoords,2],['sliceDepth',ranges,2]])g.setAttribute(key,new THREE.Float32BufferAttribute(arr,size));
  g.setIndex(index);
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false,
    uniforms:{first:{value:firstVp},base:{value:maps.leaf},rangesMap:{value:maps.range},hull:{value:maps.observed},photo:{value:ctx.refTexture},origin:{value:original.position},reverse:{value:returned.position}},
    vertexShader:`attribute vec3 centerSample;attribute vec2 sliceDepth;uniform mat4 first;
      centroid varying vec4 middle,side;centroid varying vec2 st;varying vec2 bounds;centroid varying vec3 actual;
      void main(){middle=first*vec4(centerSample,1.);side=first*vec4(position,1.);actual=position;st=uv;bounds=sliceDepth;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D base,rangesMap,hull,photo;uniform vec3 origin,reverse;
      centroid varying vec4 middle,side;centroid varying vec2 st;varying vec2 bounds;centroid varying vec3 actual;
      void main(){
        vec2 centerUv=middle.xy/middle.w*.5+.5;vec2 texel=vec2(centerUv.x*975.,(1.-centerUv.y)*984.);
        bool opposed=(texel.x>150.&&texel.x<250.&&texel.y>165.&&texel.y<249.)||(texel.x>309.&&texel.x<428.&&texel.y>174.&&texel.y<271.);
        if(!opposed)discard;
        vec2 central=texture2D(hull,centerUv).rg;
        if(central.r>=.63||central.g<=.39)discard;
        float measured=5.+78.*texture2D(rangesMap,st).r;if(measured<bounds.x||measured>=bounds.y)discard;
        vec4 returnLeaf=texture2D(base,st);if(returnLeaf.a<.53)discard;
        vec2 sourceUv=side.xy/side.w*.5+.5;vec2 source=texture2D(hull,sourceUv).rg;
        float solid=smoothstep(.48,.78,source.r)*(1.-smoothstep(.24,.47,source.g));
        vec3 frontColor=texture2D(photo,sourceUv).rgb;
        solid*=1.-smoothstep(.28,.53,dot(frontColor,vec3(.213,.715,.072)));
        float coverage=.94*solid*returnLeaf.a*smoothstep(.54,.90,returnLeaf.a);
        if(coverage<.015)discard;
        vec3 dir=normalize(cameraPosition-actual);
        float da=length(dir-normalize(origin-actual)),db=length(dir-normalize(reverse-actual));
        float front=smoothstep(.02,.98,db/(da+db+.000002));
        gl_FragColor=vec4(mix(returnLeaf.rgb,frontColor,front),coverage);
        #include <colorspace_fragment>
      }`});
  m.userData.forestMultiView=true;m.userData.forestCoverage='fringe';
  const mesh=new THREE.Mesh(g,m);mesh.name='Measured interior whorls through separated branch depths';mesh.renderOrder=-.28;node.add(mesh);
  return index.length/3;
}

function opticalSurfaces(ctx,node,maps,samples=field) {
  const d=from64(samples.d,Uint16Array),alpha=from64(samples.a,Uint8Array),sx=samples.sx,sy=samples.sy,nx=sx.length,ny=sy.length;
  const rim=samples===rimField,ranges=rim?[7,12.8,15.3,18,21.5,25.7,39]:[7,12.8,15.3,18,21.5,25.7,31,39,50,85];let triangles=0;const interiors=[];
  const left=rim?-100:0,top=rim?-304:-64,width=rim?804:1254,height=rim?288:546;
  for(let j=0;j<ranges.length-1;j++){
    const lo=ranges[j],hi=ranges[j+1],positions=[],uv=[],index=[],seen=new Map();
    function pos(id){let t=seen.get(id);if(t!==undefined)return t;const i=id%nx,k=Math.floor(id/nx),depth=clamp(d[id]/256,lo-.28,hi+.28);const p=atReturn(sx[i],sy[k],depth);t=positions.length/3;positions.push(p.x,p.y,p.z);uv.push((sx[i]-left)/width,1-(sy[k]-top)/height);seen.set(id,t);return t;}
    for(let k=0;k<ny-1;k++)for(let i=0;i<nx-1;i++){
      const id=k*nx+i,ids=[id,id+1,id+nx+1,id+nx];let close=false,amin=100,amax=0;
      for(const v of ids){if(alpha[v]<4)continue;const di=d[v]/256;amin=Math.min(amin,di);amax=Math.max(amax,di);if(di>=lo-.6&&di<hi+.6)close=true;}
      if(!close&&!(amin<lo&&amax>hi))continue;const a=pos(id),b=pos(id+1),c=pos(id+nx+1),e=pos(id+nx);index.push(a,e,b,b,e,c);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);
    for(const core of [true,false]){
      const mat=new THREE.MeshBasicMaterial({map:rim?maps.rim:maps.leaf,toneMapped:false,side:THREE.DoubleSide,transparent:!core,depthWrite:core,alphaTest:.032});mat.userData.forestCoverage=core?'core':'fringe';evidenceMaterial(mat,ctx,maps,rim?'rim':'deep',lo,hi);
      const mesh=new THREE.Mesh(g,mat);mesh.name=(rim?'Upper whorls above the western glade ':'Depth-separated needle clusters ')+lo+'–'+hi+' m '+(core?'cores':'edges');mesh.renderOrder=core?0:-.36+(ranges.length-j)*.003;node.add(mesh);
    }
    if(!rim&&lo<32)interiors.push({lo,hi,positions,uv,indices:index});
    triangles+=index.length/3;
  }if(interiors.length)triangles+=complementaryNeedleSurface(ctx,node,maps,interiors);return triangles;
}
function woodPrototype(scan){
  const g=new THREE.BufferGeometry(),xyz=Float32Array.from(from64(scan.p,Int16Array),z=>z/24576),nn=Float32Array.from(from64(scan.n,Int8Array),z=>z/127);const rgb=from64(scan.c,Uint8Array),colors=[];const c=new THREE.Color();
  for(let i=0;i<xyz.length;i+=3){c.setRGB(rgb[i]/255,rgb[i+1]/255,rgb[i+2]/255,THREE.SRGBColorSpace);const ao=.72+.24*clamp(xyz[i+1],0,1)+.10*Math.max(0,nn[i]*.78+nn[i+1]*.55+nn[i+2]*.20);colors.push(c.r*ao,c.g*ao,c.b*ao);}
  g.setAttribute('position',new THREE.BufferAttribute(xyz,3));g.setAttribute('normal',new THREE.BufferAttribute(nn,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(new THREE.BufferAttribute(from64(scan.i,Uint16Array),1));return g;
}
function needlePrototype(scan,population,stride=1){
  const xyz=from64(scan.foliage.p,Int16Array),size=from64(scan.foliage.r,Uint16Array),rnd=sequence(6472+population*919+stride);const vertices=[],uv=[],colors=[],indices=[];
  for(let i=0;i<size.length;i+=stride){
    const center=V(xyz[i*3]/24576,xyz[i*3+1]/24576,xyz[i*3+2]/24576),extent=size[i]/65535*Math.sqrt(stride)*.98;
    const ang=Math.atan2(center.z,center.x)+(rnd()-.5)*1.03;const ax=V(Math.cos(ang),.16+rnd()*.71,Math.sin(ang)).normalize();const hor=V(-Math.sin(ang),0,Math.cos(ang));
    const length=(2.06+.62*rnd())*extent,width=(.91+.68*rnd())*extent;const ix=Math.floor(rnd()*8),tint=.59+.41*rnd()+.17*Math.min(1,Math.hypot(center.x,center.z)*4.6)+.13*center.y;
    for(let plane=0;plane<2;plane++){
      const rot=.03+plane*1.02+(rnd()-.5)*.45;const side=hor.clone().multiplyScalar(Math.cos(rot)).addScaledVector(V(0,1,0),Math.sin(rot)).normalize();const start=vertices.length/3;
      for(let k=0;k<3;k++)for(let j=0;j<2;j++){
        const f=k*.5,v=j,aa=(f-.48)*length,bb=(v-.5)*width*2*(k===1?1:.72),p=center.clone().addScaledVector(ax,aa).addScaledVector(side,bb);p.y+=.16*extent*Math.sin(f*Math.PI);vertices.push(p.x,p.y,p.z);
        uv.push((ix%4+.016+f*.968)/4,1-(Math.floor(ix/4)+.034+v*.932)/2);const h=tint*(.87+.20*f);colors.push(h*1.03,h,h*.909);
      }indices.push(start,start+2,start+1,start+1,start+2,start+3,start+2,start+4,start+3,start+3,start+4,start+5);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);return g;
}
function shadedFloor(ctx,node,forest) {
  const pos=[],opacity=[],indices=[];const {groundY}=ctx,rnd=sequence(2942);
  function lobe(x,z,rx,rz,tilt,power){
    const start=pos.length/3,n=11,cs=Math.cos(tilt),sn=Math.sin(tilt),skew=rnd()*6.28;
    for(let k=0;k<4;k++)for(let j=0;j<n;j++){
      const angle=j/n*2*Math.PI;const rr=k/3*(1+.14*Math.sin(angle*3+skew)+.05*Math.cos(angle*5-skew));const a=rr*rx*Math.cos(angle),b=rr*rz*Math.sin(angle),wx=x+cs*a-sn*b,wz=z+sn*a+cs*b;
      const y=groundY(wx,wz);pos.push(wx,y+.010,wz);opacity.push(y>.04?power*(1-k/3)**1.32:0);
      if(k<3){const m=start+k*n+j,o=start+k*n+(j+1)%n;indices.push(m,m+n,o,o,m+n,o+n);}
    }
  }
  for(const t of forest){const h=t.h,x=t.base.x,z=t.base.z;lobe(x,z,.32+h*.10,.24+h*.083,t.rot,.26);for(let i=0;i<3;i++){const k=(.22+.24*i)*h;lobe(x-k*sunDirection.x/sunDirection.y,z-k*sunDirection.z/sunDirection.y,h*(.23+.07*rnd()),h*(.14+.055*rnd()),Math.atan2(sunDirection.z,sunDirection.x)+(rnd()-.5)*.32,.105);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('shade',new THREE.Float32BufferAttribute(opacity,1));g.setIndex(indices);
  const m=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
    vertexShader:'attribute float shade;varying float vShade;void main(){vShade=shade;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying float vShade;void main(){gl_FragColor=vec4(.064,.066,.050,vShade);}',toneMapped:false});const mesh=new THREE.Mesh(g,m);mesh.name='Root occlusion and broken westward conifer shadows';mesh.renderOrder=.18;node.add(mesh);
}
export function buildForestVolumes(ctx,node,trees,sourceMats,backgroundMats){
  const rnd=sequence(15917),maps=shaderData(ctx);
  // High-coverage needles write their geometric depth. A second pass draws
  // only fractional edge coverage without hiding the forest visible through
  // them; this matters where several near crowns overlap on the return view.
  const originals=node.children.filter(o=>o.isMesh&&sourceMats.includes(o.material));
  const fringeMaps=new Map();
  for(const material of sourceMats){
    const fringe=material.clone();fringe.transparent=true;fringe.depthWrite=false;fringe.alphaToCoverage=false;fringe.alphaTest=.018;fringe.userData.forestCoverage='fringe';evidenceMaterial(fringe,ctx,maps,'observed');fringeMaps.set(material,fringe);
    material.transparent=false;material.depthWrite=true;material.alphaToCoverage=false;material.alphaTest=.018;material.userData.forestCoverage='core';evidenceMaterial(material,ctx,maps,'observed');
  }
  for(const o of originals){const m=new THREE.Mesh(o.geometry,fringeMaps.get(o.material));m.name=o.name+' • antialiased needle fringe';m.renderOrder=.3;m.position.copy(o.position);m.quaternion.copy(o.quaternion);m.scale.copy(o.scale);node.add(m);}

  backgroundMats.forEach(x=>evidenceMaterial(x,ctx,maps,'backfill'));
  const triangles=opticalSurfaces(ctx,node,maps)+opticalSurfaces(ctx,node,maps,rimField),detailTriangles=fineNeedles(ctx,node,maps)+highLodgepoleWhorls(ctx,node);const physical=[],replaced=new Set();
  // Replace western near-range impostors with scanned tree stems and volumetric
  // twig clusters. The exterior of the glade includes regeneration of several ages.
  for(const t of trees){const dist=Math.hypot(t.base.x-returned.position.x,t.base.z-returned.position.z);if(t.base.z< -7&&dist<29&&t.base.x<-.65&&physical.length<24){physical.push({...t,base:t.base.clone().setY(ctx.groundY(t.base.x,t.base.z)),style:physical.length%3,near:true});replaced.add(t);}}
  const main=[];
  function plant(px,py,range,h,w,style,near=false){const p=atReturn(px,py,range);const gy=ctx.groundY(p.x,p.z);if(gy<.09)return;
    if(p.x> -6.7&&p.x<.25&&p.z> -21.1&&p.z< -12.1)return;
    p.y=gy;const tree={base:p,h,w,rot:rnd()*6.28,shade:.78+rnd()*.23,style,near};physical.push(tree);return tree;}
  for(const a of [[397,420,24.5,12.7,.86,0],[483,423,28.7,14.4,.93,0],[171,426,12.6,11.45,.82,2],[103,410,19.5,10.7,.76,0],[45,405,21.5,9.4,.88,2],[216,413,22.5,7.5,.87,1],[242,412,25.4,6.7,.84,0],[277,417,28,8.7,.80,1],[765,427,19.7,7.6,.77,1],[833,423,22.8,6.8,.83,2],[885,431,24.8,5.7,.85,0],[968,434,34.7,5.7,.88,1],[1112,449,42.4,4.2,.78,0]]){const t=plant(...a,true);if(t)main.push(t);}
  for(let i=0;i<64;i++){
    const west=i%3!==0;const px=west?-90+425*rnd():715+337*rnd();const range=(west?13.0:18)+rnd()*(west?19:21);const h=.62+Math.pow(rnd(),1.55)*4.35;
    plant(px,410+rnd()*19,range,h,.79+rnd()*.40,i%3);
  }
  // Plant complete companion crowns behind the nearest measured foliage.
  // Moving an entire sapling preserves its continuous silhouette when it
  // crosses an observation boundary at the top of a photographic view.
  const fieldRanges=from64(field.d,Uint16Array),fieldCoverage=from64(field.a,Uint8Array);
  for(const t of physical){
    let move=0;
    for(const h of [.22,.44,.61,.77,.9]){
      const p=t.base.clone().add(V(0,h*t.h,0));const q=p.clone().project(returned);
      const px=(q.x*.5+.5)*1254,py=(.5-q.y*.5)*1254;
      if(px<3||px>1250||py<6||py>477)continue;
      const ix=clamp(Math.round(px/4),0,field.sx.length-1),iy=clamp(Math.round((py+64)/4),0,field.sy.length-1),id=iy*field.sx.length+ix;
      if(fieldCoverage[id]<184)continue;
      const current=-p.clone().applyMatrix4(returned.matrixWorldInverse).z;
      move=Math.max(move,fieldRanges[id]/256-current+Math.min(1.5,.11*t.h));
    }
    move=clamp(move,0,9.5);
    if(move>.12){const depth=-t.base.clone().applyMatrix4(returned.matrixWorldInverse).z;t.base.x+=(t.base.x-returned.position.x)*move/depth;t.base.z+=(t.base.z-returned.position.z)*move/depth;t.base.y=ctx.groundY(t.base.x,t.base.z);}
    const u=ctx.pix(t.base).x,d=-t.base.z;
    if(d>14.0&&u> -80&&u<660){
      // These supporting crowns occupy the lower part of the original stand;
      // the individually measured skyline trees carry the higher whorls.
      const row=u<160?161:u<375?200:u<458?235:u<548?334:383;
      const maxHeight=ctx.atD(u,row+(1-t.w)*23,d).y-t.base.y;
      t.h=Math.min(t.h,Math.max(2.3,maxHeight));
    }
  }
  const certMat=evidenceMaterial(new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,side:THREE.DoubleSide}),ctx,maps,'scanned');
  const leafMat=evidenceMaterial(new THREE.MeshBasicMaterial({map:maps.sprays,vertexColors:true,toneMapped:false,side:THREE.DoubleSide,alphaTest:.27,alphaToCoverage:true}),ctx,maps,'scanned');
  const temp=new THREE.Object3D(),color=new THREE.Color(),families=Object.values(forestScans);
  for(let i=0;i<families.length;i++)for(const near of [true,false]){
    const list=physical.filter(t=>t.style===i&&Boolean(t.near)===near);if(!list.length)continue;
    const model=families[i];const stems=new THREE.InstancedMesh(woodPrototype(model),certMat,list.length),needles=new THREE.InstancedMesh(needlePrototype(model,i,near?1:3),leafMat,list.length);
    for(let j=0;j<list.length;j++){const t=list[j];temp.position.copy(t.base);temp.rotation.set((rnd()-.5)*.035,t.rot,(rnd()-.5)*.053);temp.scale.set(t.h*t.w,t.h,t.h*t.w);temp.updateMatrix();stems.setMatrixAt(j,temp.matrix);needles.setMatrixAt(j,temp.matrix);color.setRGB(t.shade*1.04,t.shade,t.shade*.94);stems.setColorAt(j,color);needles.setColorAt(j,color);}
    stems.name='Scan-derived tapered bark and deadwood';needles.name='Independent three-dimensional needle sprays';node.add(stems,needles);
  }
  shadedFloor(ctx,node,physical);
  return {replaced,trees:physical,mainTrees:main,deepTriangles:triangles,detailTriangles};
}
