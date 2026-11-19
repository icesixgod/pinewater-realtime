import * as THREE from './three.module.js';
import {sunDirection} from './calibration.js';

export function createWalkerLight(ctx,footwork,walker,asset) {
  const depth=new THREE.DepthTexture(640,640,THREE.UnsignedIntType);
  depth.minFilter=depth.magFilter=THREE.NearestFilter;
  const target=new THREE.WebGLRenderTarget(640,640,{depthTexture:depth,depthBuffer:true});
  const bodyDepth=new THREE.DepthTexture(768,768,THREE.UnsignedIntType);
  bodyDepth.minFilter=bodyDepth.magFilter=THREE.NearestFilter;
  const bodyTarget=new THREE.WebGLRenderTarget(768,768,{depthTexture:bodyDepth,depthBuffer:true});
  const cam=new THREE.OrthographicCamera(-2.35,2.35,2.35,-2.35,.1,10);cam.layers.set(5);
  const vp=new THREE.Matrix4(),center=new THREE.Vector3(),depthMat=new THREE.MeshDepthMaterial();
  const uniforms={pwPersonDepth:{value:depth},pwSunVP:{value:vp},pwFeet:{value:footwork.shadowFeet},pwAxes:{value:footwork.shadowAxis}};
  // The optical centre lies inside the head. A separate caster supplies the
  // upper-body silhouette to the sun without putting the camera inside a mesh.
  const upper=new THREE.InstancedMesh(new THREE.SphereGeometry(1,20,14),depthMat,8);
  upper.name='Hiker upper-body sun occluders';upper.layers.set(5);upper.layers.enable(6);upper.frustumCulled=false;ctx.scene.add(upper);
  for(const assembly of [asset.dock,asset.boat])assembly.traverse(obj=>{
    if(obj.isMesh&&obj.material.colorWrite!==false)obj.layers.enable(6);
  });
  const examined=new Set();
  walker.group.traverse(obj=>{
    if(!obj.isMesh)return;
    // First-person camera and its mirror see the environment. The actor still
    // bears weight on the boards and participates in both light-depth passes.
    obj.layers.set(5);obj.layers.enable(6);
    for(const material of Array.isArray(obj.material)?obj.material:[obj.material]){
      if(examined.has(material))continue;examined.add(material);
      const old=material.onBeforeCompile,key=material.customProgramCacheKey();
      material.onBeforeCompile=function(shader,engine){
        old.call(this,shader,engine);
        shader.uniforms.hikerTimberDepth={value:bodyDepth};shader.uniforms.hikerLightVP={value:vp};
        shader.vertexShader='uniform mat4 hikerLightVP;varying vec4 hikerQ;\n'+shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
          hikerQ=hikerLightVP*modelMatrix*vec4(transformed,1.);`);
        shader.fragmentShader='uniform sampler2D hikerTimberDepth;varying vec4 hikerQ;\n'+shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          vec3 hs=hikerQ.xyz/hikerQ.w*.5+.5;
          if(min(min(hs.x,1.-hs.x),min(hs.y,1.-hs.y))>.002){
            float visible=0.;
            for(int j=0;j<12;j++){
              float k=float(j)+.5,a=k*2.39996323;
              vec2 du=sqrt(k/12.)*vec2(cos(a),sin(a))*(2.5/768.);
              float z=texture2D(hikerTimberDepth,hs.xy+du).r;
              visible+=1.-smoothstep(.00055,.00145,hs.z-z);
            }
            float sunTransmission=mix(.08,1.,visible/12.);
            reflectedLight.directDiffuse*=sunTransmission;reflectedLight.directSpecular*=sunTransmission;
          }`);
      };
      material.customProgramCacheKey=()=>key+'-dynamic-timber-shadow';material.needsUpdate=true;
    }
  });
  const tmp=new THREE.Object3D(),origin=new THREE.Vector3(),across=new THREE.Vector3(),bodyFront=new THREE.Vector3();
  const vertical=new THREE.Vector3(0,1,0),eye=new THREE.Vector3(),chest=new THREE.Vector3(),neck=new THREE.Vector3();
  const armTop=new THREE.Vector3(),armElbow=new THREE.Vector3(),hand=new THREE.Vector3(),axis=new THREE.Vector3();
  function limb(id,a,b,x,z){
    axis.copy(b).sub(a);const length=axis.length();if(length<1e-5)return;
    tmp.position.copy(a).lerp(b,.5);tmp.quaternion.setFromUnitVectors(vertical,axis.multiplyScalar(1/length));
    tmp.scale.set(x,length*.58,z);tmp.updateMatrix();upper.setMatrixAt(id,tmp.matrix);
  }
  function updateUpper(pose,view){
    origin.copy(pose.left.hip).lerp(pose.right.hip,.5);
    across.copy(pose.right.hip).sub(pose.left.hip).normalize();bodyFront.set(across.z,0,-across.x);
    eye.fromArray(view.eye);neck.copy(eye).addScaledVector(bodyFront,-.09).addScaledVector(vertical,-.16);
    chest.copy(origin).lerp(neck,.85);const sway=Math.sin(view.stepPhase*.5)*.086*(1-view.couple);
    limb(0,origin,chest,.205,.129);
    tmp.position.copy(eye).addScaledVector(bodyFront,-.076);tmp.position.y-=.011;
    tmp.quaternion.identity();tmp.scale.set(.083,.118,.101);tmp.updateMatrix();upper.setMatrixAt(1,tmp.matrix);
    for(let i=0;i<2;i++){
      const side=i?1:-1,slot=2+i*3;
      armTop.copy(chest).addScaledVector(across,side*.176);
      armElbow.copy(armTop).addScaledVector(across,side*.041).addScaledVector(bodyFront,-.061+side*sway);armElbow.y-=.248;
      hand.copy(armElbow).addScaledVector(bodyFront,.138+side*sway).addScaledVector(across,side*.019);hand.y-=.231;
      limb(slot,armTop,armElbow,.057,.065);limb(slot+1,armElbow,hand,.045,.044);
      tmp.position.copy(hand);tmp.position.y-=.042;tmp.scale.set(.037,.082,.027);tmp.updateMatrix();upper.setMatrixAt(slot+2,tmp.matrix);
    }
    upper.instanceMatrix.needsUpdate=true;
  }
  function prepare(renderer,scene,pose,view){
    updateUpper(pose,view);
    center.copy(pose.left.sole).lerp(pose.right.sole,.5);center.y+=.44;
    cam.position.copy(center).addScaledVector(sunDirection,4.8);cam.lookAt(center);cam.updateMatrixWorld();
    vp.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);
    const previous=scene.overrideMaterial;scene.overrideMaterial=depthMat;
    cam.layers.set(5);renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,cam);
    cam.layers.set(6);renderer.setRenderTarget(bodyTarget);renderer.clear();renderer.render(scene,cam);
    renderer.setRenderTarget(null);scene.overrideMaterial=previous;
  }
  return {uniforms,prepare,depth};
}

export const walkerShadowPars=`
uniform sampler2D pwPersonDepth;uniform mat4 pwSunVP;
uniform vec4 pwFeet[2];uniform vec2 pwAxes[2];
float pwVisibility(vec3 world){
  vec4 clip=pwSunVP*vec4(world,1.);
  vec3 sc=clip.xyz/clip.w*.5+.5;
  float edge=min(min(sc.x,1.-sc.x),min(sc.y,1.-sc.y));
  if(edge<.001||sc.z<0.||sc.z>1.) return 1.;
  float obscured=0.,blocker=0.,blockers=0.;
  for(int j=0;j<6;j++){
    float k=float(j)+.5,theta=k*2.39996323;
    vec2 disk=sqrt(k/6.)*vec2(cos(theta),sin(theta))*(7./640.);
    float gap=9.9*(sc.z-texture2D(pwPersonDepth,sc.xy+disk).r);
    if(gap>.002){blocker+=gap;blockers+=1.;}
  }
  float softness=.90+clamp(blocker/max(1.,blockers),0.,2.)*8.5;
  for(int j=0;j<12;j++){
    float k=float(j)+.5,theta=k*2.39996323;
    vec2 disk=sqrt(k/12.)*vec2(cos(theta),sin(theta))*(softness/640.);
    float d=texture2D(pwPersonDepth,sc.xy+disk).r;
    obscured+=smoothstep(.00025,.00086,sc.z-d);
  }
  return 1.-obscured*(1./12.)*smoothstep(.001,.028,edge);
}
float pwContact(vec3 w){
  float shadow=0.;
  for(int i=0;i<2;i++){
    vec3 shoe=pwFeet[i].xyz;float height=shoe.y-w.y;
    vec2 d=w.xz-shoe.xz;float u=dot(pwAxes[i],d),v=dot(vec2(-pwAxes[i].y,pwAxes[i].x),d);
    float soft=.007+max(0.,height)*.32;
    float h=abs(u)/(.119+soft),k=abs(v)/(.049+soft);
    float occlusion=exp(-1.15*(h*h*h*h+k*k*k*k))*exp(-max(0.,height)*19.)*smoothstep(-.025,-.002,height);
    shadow=max(shadow,occlusion);
  }
  return 1.-.68*shadow;
}`;
