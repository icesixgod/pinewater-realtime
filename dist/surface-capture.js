import * as THREE from './three.module.js';
import {W,H,startEye} from './calibration.js';
import {walkerShadowPars} from './walker-light.js';

const shaderPrefix=`
uniform mat4 pwSourceVP,pwToRest;
varying vec4 pwClip;
varying vec3 pwSurface;
varying vec3 pwCurrent;
`;

// The reference pixels measure a band-limited surface image. Cubic reconstruction
// retains timber and rock grain when that image covers more display samples than
// source pixels. Oblique or minified surfaces keep the mipmapped texture filter.
const reconstruction=`
  vec3 pwPhoto(vec2 uv){
    vec2 size=vec2(975.,984.);
    float footprint=max(length(dFdx(uv)*size),length(dFdy(uv)*size));
    if(footprint>=1.18)return texture2D(pwImage,uv).rgb;
    vec2 p=uv*size,base=floor(p-.5)+.5,f=p-base,f2=f*f,f3=f2*f;
    vec2 a=-.5*f+f2-.5*f3,b=1.-2.5*f2+1.5*f3,c=.5*f+2.*f2-1.5*f3,d=-.5*f2+.5*f3;
    vec2 mid=b+c,u0=(base-1.)/size,u1=(base+c/mid)/size,u2=(base+2.)/size;
    vec3 sum=textureLod(pwImage,vec2(u0.x,u0.y),0.).rgb*a.x*a.y+
      textureLod(pwImage,vec2(u1.x,u0.y),0.).rgb*mid.x*a.y+textureLod(pwImage,vec2(u2.x,u0.y),0.).rgb*d.x*a.y+
      textureLod(pwImage,vec2(u0.x,u1.y),0.).rgb*a.x*mid.y+textureLod(pwImage,u1,0.).rgb*mid.x*mid.y+
      textureLod(pwImage,vec2(u2.x,u1.y),0.).rgb*d.x*mid.y+textureLod(pwImage,vec2(u0.x,u2.y),0.).rgb*a.x*d.y+
      textureLod(pwImage,vec2(u1.x,u2.y),0.).rgb*mid.x*d.y+textureLod(pwImage,u2,0.).rgb*d.x*d.y;
    return mix(max(vec3(0.),sum),texture2D(pwImage,uv).rgb,smoothstep(.94,1.18,footprint));
  }`;

// The observation is a texture of each exposed surface. Hidden wood, roots and
// rock faces use their own material. The boat carries its observation in boat space.
export async function captureSurfaces(ctx,{cabin,bank,forest,asset,water,rig,dyn}){
  const {renderer,scene,camera,refTexture}=ctx;
  const loader=new THREE.TextureLoader();
  const [classes,farTrust,measuredGrain]=await Promise.all([
    loader.loadAsync('./art/capture-membership.png'),loader.loadAsync('./art/forest-far-trust.png'),loader.loadAsync('./art/deck-measured-grain.png')
  ]);
  measuredGrain.colorSpace=THREE.SRGBColorSpace;
  measuredGrain.anisotropy=8;
  classes.minFilter=classes.magFilter=THREE.NearestFilter;classes.generateMipmaps=false;
  farTrust.minFilter=farTrust.magFilter=THREE.LinearFilter;farTrust.generateMipmaps=false;
  const pose=dyn.apply(0);bank.update(0);forest.update?.(0);rig.pose(camera,0,pose);
  const depth=new THREE.DepthTexture(W,H,THREE.UnsignedIntType);
  const target=new THREE.WebGLRenderTarget(W,H,{depthTexture:depth,depthBuffer:true});
  const sourceVP=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  const restBoat=asset.boat.matrixWorld.clone(),toRest=new THREE.Matrix4(),identity=new THREE.Matrix4();
  const aperture=asset.boat.getObjectByName('Water excluded by gunwales');
  if(aperture)aperture.visible=false;
  water.water.visible=false;
  renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(null);
  water.water.visible=true;if(aperture)aperture.visible=true;

  const choices=[
    [cabin.group,'Cabin','labels.r',1.00,.21],
    [asset.dock,'Dock','labels.b',1.00,.22],
    [asset.boat,'Hull','labels.g',1.00,.22],
    [bank.group,'Bank','terrain.r',.995,.095],
    [forest.group,'Forest','terrain.g',.995,.095]
  ];
  const seen=new Set();
  for(const [group,kind,label,amount,angleLimit] of choices)group.traverse(object=>{
    if(!object.isMesh)return;
    const layers=Array.isArray(object.material)?object.material:[object.material];
    const far=kind==='Forest'&&/Distant shore|Zenith|basin panorama|distant massif/i.test(object.name);
    const measuredCrown=kind==='Forest'&&/Needles through|Shade behind|Lodgepole beyond|Second pine behind|Point grove|Foreground pine •/.test(object.name);
    const sky='max((1.-max(max(max(labels.r,labels.g),labels.b),max(terrain.r,terrain.g)))*smoothstep(.665,.705,uv.x),texture2D(pwDistant,uv).r)';
    const mask=far?sky:measuredCrown?'1.':kind==='Forest'?'max(terrain.g,terrain.b*step(.51,uv.y))':label;
    for(const mat of layers) {
      if(seen.has(mat)||!mat.colorWrite||mat.transparent&&mat.opacity<.25)continue;
      seen.add(mat);
      const plank=kind==='Dock'&&(mat.userData.bridgeSurface==='planks'||object.name.startsWith('58 separate worn planks'));
      const support=mat.userData.fixedSurfacePigment?'0.':kind==='Bank'?'1.-smoothstep(.35,3.55,length(pwEye-pwOrigin))':
        mat.userData.forestMultiView?'1.-smoothstep(.10,6.20,length(pwEye-pwOrigin))':'1.';
      const fringe=mat.userData.forestCoverage==='fringe'?'smoothstep(.72,.99,gl_FragColor.a)':'1.';
      const receive=Boolean(ctx.walkerLight)&&['Bank','Hull','Dock'].includes(kind);
      const originalCompile=mat.onBeforeCompile,originalKey=mat.customProgramCacheKey();
      mat.onBeforeCompile=function(sh,r){
        originalCompile.call(this,sh,r);
        Object.assign(sh.uniforms,{
          pwSourceVP:{value:sourceVP},pwToRest:{value:kind==='Hull'?toRest:identity},
          pwDepth:{value:depth},pwImage:{value:refTexture},pwLabels:{value:classes},
          pwOrigin:{value:startEye},pwEye:{value:camera.position}
        });
        if(plank)sh.uniforms.pwMeasuredGrain={value:measuredGrain};
        if(far)sh.uniforms.pwDistant={value:farTrust};
        if(receive)Object.assign(sh.uniforms,ctx.walkerLight.uniforms);
        sh.vertexShader=shaderPrefix+sh.vertexShader.replace(/void\s+main\s*\(\s*(?:void\s*)?\)\s*\{/,m=>m+`
          vec4 pwBind=vec4(position,1.);
          #ifdef USE_INSTANCING
            pwBind=instanceMatrix*pwBind;
          #endif
          pwCurrent=(modelMatrix*pwBind).xyz;
          pwSurface=(pwToRest*vec4(pwCurrent,1.)).xyz;
          pwClip=pwSourceVP*vec4(pwSurface,1.);
        `);
        sh.fragmentShader=`uniform sampler2D pwImage,pwDepth,pwLabels;${plank?'uniform sampler2D pwMeasuredGrain;':''}${far?'uniform sampler2D pwDistant;':''}
          uniform vec3 pwOrigin,pwEye;varying vec4 pwClip;varying vec3 pwSurface;varying vec3 pwCurrent;
          ${receive?walkerShadowPars:''}
          ${reconstruction}
          float pwDepthInMeters(float v){return .045*1200./(.045+(1.-v)*(1200.-.045));}
        `+sh.fragmentShader.replace('#include <colorspace_fragment>',`
          if(pwClip.w>.045){
            vec3 cap=pwClip.xyz/pwClip.w*.5+.5;
            vec2 uv=cap.xy;
            vec3 bits=floor(texture2D(pwLabels,uv).rgb*255.+.5);
            vec3 low=mod(bits,16.)/15.,high=floor(bits/16.)/15.;
            vec3 labels=vec3(low.r,high.r,low.g);vec3 terrain=vec3(high.g,low.b,high.b);
            float fit=clamp(${plank?'labels.b*terrain.b':mask},0.,1.);
            float border=min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y));
            vec2 px=vec2(1./975.,1./984.);
            float zBuffer=texture2D(pwDepth,uv).r;
            float neighbor=max(max(texture2D(pwDepth,uv+vec2(px.x,0.)).r,texture2D(pwDepth,uv-vec2(px.x,0.)).r),
              max(texture2D(pwDepth,uv+vec2(0.,px.y)).r,texture2D(pwDepth,uv-vec2(0.,px.y)).r));
            float dep=pwDepthInMeters(${plank?'zBuffer':'max(zBuffer,neighbor)'});
            float tol=.004+.0012*pwClip.w+min(.045,.9*fwidth(pwClip.w));
            // A surface in front of a deeper depth sample is visible at the
            // source. This matters at the silhouette of fine needles and blades.
            float occ=1.-smoothstep(tol,tol*2.8,max(0.,pwClip.w-dep));
            vec3 v0=pwOrigin-pwSurface,v1=pwEye-pwSurface;
            float ca=dot(normalize(v0),normalize(v1));
            float sameAngle=1.-smoothstep(.0018,${angleLimit.toFixed(3)},1.-ca);
            float magnification=length(v0)/max(.12,length(v1));
            float resolution=1.-smoothstep(1.05,1.78,magnification);
            float wt=${amount.toFixed(3)}*fit*occ*sameAngle*resolution*smoothstep(-.0003,.0012,border)*(${support})*(${fringe});
            if(wt>.0001)gl_FragColor.rgb=mix(gl_FragColor.rgb,pwPhoto(uv),wt);
            ${plank?`
              vec2 sourcePixel=vec2(uv.x*975.,(1.-uv.y)*984.);
              vec2 tile=(sourcePixel-vec2(362.,536.))/vec2(445.,293.);
              if(min(tile.x,tile.y)>0. && max(tile.x,tile.y)<1.){
                vec4 observedBoard=texture2D(pwMeasuredGrain,vec2(tile.x,1.-tile.y));
                float sourceDetail=observedBoard.a*occ*sameAngle*resolution*(1.-wt)*topFace;
                vec3 litBoard=observedBoard.rgb*(.58+.42*sunLit);
                gl_FragColor.rgb=mix(gl_FragColor.rgb,litBoard,sourceDetail);
              }`:''}
          }
          ${receive?`float pwV=pwVisibility(pwCurrent),pwAmbient=pwContact(pwCurrent);
            gl_FragColor.rgb*=pwAmbient*mix(.55+.45*pwV,.29+.71*pwV,smoothstep(.035,.24,dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722))));`:''}
          #include <colorspace_fragment>
        `);
      };
      mat.customProgramCacheKey=()=>originalKey+'-pw-registered-'+kind+(far?'-distance':measuredCrown?'-measured':'')+support+fringe+receive+(plank?'-planks':'');
      mat.needsUpdate=true;
    }
  });
  const inv=new THREE.Matrix4();
  return {depth:target,update(){toRest.multiplyMatrices(restBoat,inv.copy(asset.boat.matrixWorld).invert());}};
}
