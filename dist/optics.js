import * as THREE from './three.module.js';
import {smoother} from './calibration.js';

// Resolve a short, centred camera exposure. Positions come from the live depth
// buffer and the actual tracked poses at either end of the shutter interval.
export function createOptics(renderer,world,camera,rig,dyn,high) {
  const depth=new THREE.DepthTexture(8,8,THREE.UnsignedIntType);
  const target=new THREE.WebGLRenderTarget(8,8,{type:THREE.HalfFloatType,format:THREE.RGBAFormat,
    samples:Math.min(4,renderer.capabilities.maxSamples),depthBuffer:true,depthTexture:depth});
  const firstSample=new THREE.WebGLRenderTarget(8,8,{type:THREE.HalfFloatType,depthBuffer:false});
  const inverseVP=new THREE.Matrix4(),before=new THREE.Matrix4(),after=new THREE.Matrix4();
  const tracker=camera.clone(),pixel=new THREE.Vector2(),scene=new THREE.Scene();
  const uniforms={
    frameColor:{value:target.texture},frameDepth:{value:depth},inverseVP:{value:inverseVP},
    before:{value:before},after:{value:after},pixel:{value:pixel},focalPixels:{value:915},
    focus:{value:8},aperture:{value:.0027},shutter:{value:1},
    firstColor:{value:null},firstWeight:{value:0}
  };
  const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:false,
    vertexShader:`varying vec2 uv0;void main(){uv0=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      uniform sampler2D frameColor,frameDepth,firstColor;
      uniform mat4 inverseVP,before,after;
      uniform vec2 pixel;uniform float focalPixels,focus,aperture,shutter,firstWeight;
      varying vec2 uv0;
      float zAt(vec2 p){float d=texture2D(frameDepth,clamp(p,0.,1.)).r;return .045*1200./(.045+(1.-d)*(1200.-.045));}
      void main(){
        float z=texture2D(frameDepth,uv0).r,d=zAt(uv0);
        vec4 h=inverseVP*vec4(uv0*2.-1.,z*2.-1.,1.),p=vec4(h.xyz/h.w,1.);
        vec4 a=before*p,b=after*p;
        vec2 motion=(b.xy/b.w-a.xy/a.w)*.5/pixel*shutter;
        float m=length(motion);motion*=min(1.,12./max(.01,m));
        float coc=min(1.75,.5*aperture*focalPixels*abs(1./max(.1,d)-1./focus))*shutter;
        vec3 center=texture2D(frameColor,uv0).rgb;
        vec3 sum=center;float weight=1.;
        for(int i=0;i<8;i++){
          float fi=float(i),u=(fi+.5)/8.-.5;
          float angle=fi*2.3999632+.78;
          vec2 lens=coc*sqrt((fi+.55)/8.)*vec2(cos(angle),sin(angle));
          vec2 uv=clamp(uv0+pixel*(motion*u+lens),pixel*.5,1.-pixel*.5);
          float rd=zAt(uv);
          float admission=1.-smoothstep(.018,.16,abs(rd-d)/max(.4,min(rd,d)));
          float w=admission*(1.-.36*abs(2.*u));
          sum+=texture2D(frameColor,uv).rgb*w;weight+=w;
        }
        vec3 radiance=sum/weight;
        if(firstWeight>0.)radiance=mix(radiance,texture2D(firstColor,uv0).rgb,firstWeight);
        gl_FragColor=vec4(radiance,1.);
        #include <colorspace_fragment>
      }`});
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
  const screen=new THREE.Mesh(geo,material);screen.frustumCulled=false;scene.add(screen);
  const dummy=new THREE.Camera();let stats={};
  function endpoint(time,out){
    const st=dyn.apply(Math.max(0,Math.min(12,time)));
    tracker.aspect=camera.aspect;rig.pose(tracker,Math.max(0,Math.min(12,time)),st);
    out.multiplyMatrices(tracker.projectionMatrix,tracker.matrixWorldInverse);
  }
  function prepare(t,exposure=1/77){
    endpoint(t-exposure*.5,before);endpoint(t+exposure*.5,after);
  }
  function draw(t,stage='single'){
    inverseVP.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).invert();
    const dims=renderer.getDrawingBufferSize(new THREE.Vector2());
    if(target.width!==dims.x||target.height!==dims.y)target.setSize(dims.x,dims.y);
    if(stage==='first'&&(firstSample.width!==dims.x||firstSample.height!==dims.y))firstSample.setSize(dims.x,dims.y);
    pixel.set(1/dims.x,1/dims.y);
    uniforms.focalPixels.value=dims.y/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5));
    const walkFocus=8.5-4.3*smoother(.5,4.7,t)-2.46*smoother(4.5,7.4,t);
    uniforms.focus.value=THREE.MathUtils.lerp(walkFocus,8.9,smoother(8.9,10.5,t));
    uniforms.shutter.value=smoother(0,.16,t);
    uniforms.firstColor.value=stage==='last'?firstSample.texture:null;
    uniforms.firstWeight.value=stage==='last'?.5:0.;
    renderer.setRenderTarget(target);renderer.render(world,camera);
    stats={...renderer.info.render};
    renderer.setRenderTarget(stage==='first'?firstSample:null);renderer.render(scene,dummy);
    renderer.setRenderTarget(null);
  }
  return {prepare,draw,get stats(){return stats;}};
}
