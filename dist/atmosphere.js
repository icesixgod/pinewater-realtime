import * as THREE from './three.module.js';
import {wind, sunDirection} from './calibration.js';

export const smokeRise = .66, crosswind = .48, windTau = .86;
export const smokeInterval = 1 / 12, smokeLife = 4.5;

// A parcel starts with a vertical draft and approaches the world wind speed.
// The integral, not a per-frame position increment, makes the shot scrubbable.
export function travel(age) {
  return crosswind * (age - windTau * (1 - Math.exp(-age / windTau)));
}

function lateral(age, emitted, strand = 0) {
  const reach = (1 - Math.exp(-age / .38)) * (.012 + .038 * age + .006 * age * age);
  const phase = 2.04 * emitted + .39 * age + strand * .58;
  return reach * (.79 * Math.sin(phase + .32 * Math.sin(.87 * emitted + .4))
    + .28 * Math.sin(1.81 * phase + .71) + .12 * Math.cos(2.73 * phase - .53));
}

// A repeatable three-dimensional noise lattice. Each 2-D tile is one z slice;
// the wrapped one-texel borders make trilinear interpolation continuous.
function noiseLattice() {
  const dim = 32, tile = dim + 2, width = tile * 8, height = tile * 4;
  let seed = 284593;
  const random = new Uint8Array(dim ** 3), data = new Uint8Array(width * height);
  for (let i = 0; i < random.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    random[i] = seed >>> 24;
  }
  for (let z = 0; z < dim; z++) for (let y = -1; y <= dim; y++) for (let x = -1; x <= dim; x++) {
    const col = (z % 8) * tile + x + 1, row = Math.floor(z / 8) * tile + y + 1;
    data[col + row * width] = random[(x + dim) % dim + dim * ((y + dim) % dim + dim * z)];
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function buildSmoke(ctx, capWitness) {
  // The supplied survey point is 3 mm above the peak of the solid rain cap.
  // These are its two leeward lateral vent faces, measured on the cabin mesh.
  // The primary optical axis starts just outside the lip, in the open air.
  const faceA = capWitness.clone().add(new THREE.Vector3(.123, -.15065, -.205));
  const faceB = capWitness.clone().add(new THREE.Vector3(.214, -.15065, .133));
  const normalA = new THREE.Vector2(.514, -.858).normalize();
  const normalB = new THREE.Vector2(.849, .529).normalize();
  const liftOut = (face, normal) => face.clone().add(new THREE.Vector3(normal.x * .047, .014, normal.y * .047));
  const outlet = liftOut(faceA, normalA), secondary = liftOut(faceB, normalB);
  const sections = 15, samples = ctx.high ? 20 : 16;
  const geom = new THREE.InstancedBufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute([-.5,-.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0], 3));
  geom.setIndex([0, 1, 2, 0, 2, 3]);
  const slices = [];
  for (let i=0; i<sections; i++) for (let j=0; j<samples; j++) slices.push(i,(j+.5)/samples);
  geom.setAttribute('sectionSlice', new THREE.InstancedBufferAttribute(new Float32Array(slices),2));
  geom.instanceCount = sections * samples;
  const uniforms = {
    emissionPoint:{value:outlet}, otherPoint:{value:secondary}, worldWind:{value:wind},
    toSun:{value:sunDirection}, faceNormalA:{value:normalA}, faceNormalB:{value:normalB},
    ageClock:{value:0}, lattice:{value:noiseLattice()}
  };
  const common = `
    uniform vec3 emissionPoint,otherPoint;uniform vec2 worldWind;
    const float rise=${smokeRise.toFixed(8)}, sideSpeed=${crosswind.toFixed(8)}, relax=${windTau.toFixed(8)}, lifetime=${smokeLife.toFixed(8)};
    float displacement(float a){return sideSpeed*(a-relax*(1.-exp(-a/relax)));}
    float spread(float a){return .056+.045*a+.0090*a*a;}
  `;
  // Slice the swept plume in world-space height cells. Every fragment has a
  // physical depth. Roof, cap, crevices, trees and their reflected views use
  // the ordinary raster depth test on every optical sample.
  const mat = new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,depthTest:true,toneMapped:false,
    vertexShader:common+`
      attribute vec2 sectionSlice;varying vec3 planePoint,rayStart,boxMid,boxHalf;varying float fraction;
      void main(){
        const float bands=${sections}.0,steps=${samples}.0;
        float yMin=emissionPoint.y-.066,dy=(rise*lifetime+.074)/bands;
        float below=clamp(floor((cameraPosition.y-yMin)/dy),0.,bands);
        float above=bands-below, n=sectionSlice.x;
        float b=n<above?bands-1.-n:n-above;
        float lo=yMin+b*dy,hi=lo+dy,age=clamp((.5*(lo+hi)-emissionPoint.y)/rise,0.,lifetime);
        float aHi=clamp((hi-emissionPoint.y)/rise+.02,0.,lifetime);
        vec2 drift=worldWind*displacement(age);float merge=smoothstep(.11,.83,age);
        vec2 pA=emissionPoint.xz+drift,pB=mix(otherPoint.xz,emissionPoint.xz,merge)+drift;
        float bound=2.85*spread(aHi)+(.020+.05*aHi+.006*aHi*aHi)+.12;
        vec3 mid=vec3(.5*(pA.x+pB.x),.5*(lo+hi),.5*(pA.y+pB.y));
        vec3 halfBox=vec3(.5*abs(pA.x-pB.x)+bound,.5*dy,.5*abs(pA.y-pB.y)+bound);
        mat3 basis=mat3(viewMatrix);vec3 q=(viewMatrix*vec4(mid,1.)).xyz;
        vec3 ex=abs(basis[0])*halfBox.x+abs(basis[1])*halfBox.y+abs(basis[2])*halfBox.z;
        float farPlane=-q.z;
        vec2 extent=isOrthographic?ex.xy:(farPlane*ex.xy+abs(q.xy)*ex.z)/max(.01,farPlane-ex.z);
        vec3 point=q+vec3(position.xy*2.*extent,0.);
        planePoint=cameraPosition+vec3(dot(basis[0],point),dot(basis[1],point),dot(basis[2],point));
        rayStart=isOrthographic?planePoint+vec3(basis[0].z,basis[1].z,basis[2].z)*farPlane:cameraPosition;
        boxMid=mid;boxHalf=halfBox;fraction=sectionSlice.y;gl_Position=projectionMatrix*vec4(point,1.);
      }`,
    fragmentShader:common+`
      uniform sampler2D lattice;uniform vec3 toSun;uniform vec2 faceNormalA,faceNormalB;uniform float ageClock;
      uniform mat4 projectionMatrix;
      varying vec3 planePoint,rayStart,boxMid,boxHalf;varying float fraction;
      float n3(vec3 p){
        vec3 ip=mod(floor(p),32.),u=fract(p);u=u*u*(3.-2.*u);
        float z=ip.z,z2=mod(z+1.,32.);vec2 a=vec2(mod(z,8.),floor(z/8.)),b=vec2(mod(z2,8.),floor(z2/8.));
        vec2 xy=ip.xy+u.xy+1.5;vec2 dims=vec2(272.,136.);
        return mix(texture2D(lattice,(a*34.+xy)/dims).r,texture2D(lattice,(b*34.+xy)/dims).r,u.z);
      }
      float curl(float age,float emitted,float strand){
        float reach=(1.-exp(-age/.38))*(.012+.038*age+.006*age*age);
        float ph=2.04*emitted+.39*age+strand*.58;
        return reach*(.79*sin(ph+.32*sin(.87*emitted+.4))+.28*sin(1.81*ph+.71)+.12*cos(2.73*ph-.53));
      }
      // Extinction is per metre. Coherent temperature eddies are indexed by
      // emission time, so a dense knot travels up the flue and across the lake
      // rather than boiling in place or following the camera.
      vec2 gas(vec3 p,float age,float which){
        float emitted=ageClock-age,join=smoothstep(.11,.83,age);vec2 across=vec2(-worldWind.y,worldWind.x);
        vec2 origin=which>.5?mix(otherPoint.xz,emissionPoint.xz,join):emissionPoint.xz;
        vec2 axis=origin+worldWind*displacement(age)+across*curl(age,emitted,which);
        float pulseAge=3.62*emitted+.67*sin(emitted*1.66+.41)+which*.42;
        float breath=.5+.5*sin(pulseAge),beat=.79+.44*breath+.07*sin(emitted*5.27+.68);
        float r=spread(age)*beat*(which>.5?.77:1.);vec2 offset=p.xz-axis;
        vec2 q=vec2(dot(offset,worldWind)/(.87*r),dot(offset,across)/r);float raw=dot(q,q);if(raw>9.7)return vec2(0.);
        float phase=emitted*2.92+.83*age+.44*sin(emitted*1.37+.49);float rolled=smoothstep(.19,1.34,age);
        vec3 a=vec3(q*.87,emitted*.91+age*.29)+vec3(7.21+which*4.5,12.7,17.58);
        vec2 warp=vec2(n3(a*.79)-.5,n3(a*.91+vec3(8.3,1.7,10.8))-.5);
        vec2 w=q+(1.08+rolled*1.22)*warp;
        float fiber=n3(vec3(w*1.73,emitted*2.31+age*.55)+vec3(13.1,3.4,8.6));
        float detail=n3(vec3(w*3.61,emitted*4.9+age*.82)+vec3(2.5,17.2,10.1));
        vec2 edge=w-rolled*vec2(1.47*sin(phase+.41),.80*cos(.87*phase));
        vec2 loose=w+rolled*vec2(.97*sin(phase+.41),.73*cos(.87*phase));
        float core=exp(-.91*dot(edge,edge));float veil=exp(-1.29*dot(loose,loose));
        float fold=exp(-pow((length(loose)-1.02)/.46,2.))*smoothstep(-.76,.62,loose.x*.64+loose.y*.36)*rolled;
        float breakup=mix(.81+.38*fiber,.19+1.17*smoothstep(.24,.73,fiber+.24*(detail-.5)),rolled);
        float density=(.84*core+.32*veil+.51*fold)*breakup*(1.-smoothstep(5.1,9.7,raw));
        float pulse=.77+.52*breath+.11*sin(2.14*emitted+.43*sin(emitted*1.04));
        float death=(1.-smoothstep(2.48,lifetime,age))*exp(-.048*age);
        float k=7.72*pow(.056/r,1.18)*density*death*pulse*(which>.5?.38*(1.-.85*join):1.);
        float facing=dot(normalize(offset+vec2(.000001)),normalize(toSun.xz));
        float highlight=clamp(.32+.28*facing+.22*(fiber-.5)+.085*rolled+.13*(1.-core),0.,1.);
        return vec2(k,k*highlight);
      }
      vec2 vent(vec3 p,vec3 mouth,vec2 normal,float strength){
        vec2 r=p.xz-mouth.xz;float n=dot(r,normal),side=dot(r,vec2(-normal.y,normal.x));
        float inward=clamp(-n/.11,0.,1.);float cy=mouth.y-.015-.024*inward;
        float e=exp(-.5*pow(side/.047,2.)-.5*pow((p.y-cy)/.021,2.));
        float k=strength*e*smoothstep(-.135,-.094,n)*(1.-smoothstep(-.008,.056,n));return vec2(k,k*.48);
      }
      void main(){
        vec3 ray=normalize(planePoint-rayStart);
        vec3 inverseRay=mix(vec3(-1.),vec3(1.),step(vec3(0.),ray))/max(abs(ray),vec3(.000001));
        vec3 t0=(boxMid-boxHalf-rayStart)*inverseRay,t1=(boxMid+boxHalf-rayStart)*inverseRay;
        vec3 enter=min(t0,t1),leave=max(t0,t1);
        float nearT=max(0.,max(enter.x,max(enter.y,enter.z))),farT=min(leave.x,min(leave.y,leave.z));
        if(farT<=nearT)discard;
        vec3 fieldPoint=rayStart+ray*mix(farT,nearT,fraction);
        float slabStep=(farT-nearT)/${samples}.;
        float age=(fieldPoint.y-emissionPoint.y)/rise;vec2 total=vec2(0.);
        if(age>=0.&&age<lifetime){total=gas(fieldPoint,age,0.);if(age<2.0)total+=gas(fieldPoint,age,1.);}
        if(age<.14){total+=vent(fieldPoint,emissionPoint,faceNormalA,5.2);total+=vent(fieldPoint,otherPoint,faceNormalB,2.7);}
        float opacity=1.-exp(-total.x*slabStep);if(opacity<.00055)discard;
        vec4 clip=projectionMatrix*viewMatrix*vec4(fieldPoint,1.);
        gl_FragDepth=.5+.5*clip.z/clip.w;
        float illumination=total.y/max(.0001,total.x);
        vec3 incoming=normalize(cameraPosition-fieldPoint);float phase=.975+.065*pow(max(0.,dot(incoming,-toSun)),2.);
        vec3 shaded=vec3(.145,.155,.164),warm=vec3(.575,.526,.454);
        gl_FragColor=vec4(mix(shaded,warm,illumination)*phase,opacity);
        #include <colorspace_fragment>
      }`});
  const mesh = new THREE.Mesh(geom,mat);
  mesh.name='Woodsmoke • wind-advected participating medium';mesh.frustumCulled=false;mesh.renderOrder=3;
  ctx.scene.add(mesh);
  let clock=0;
  function center(age) {
    const d=travel(age);
    return new THREE.Vector3(outlet.x+d*wind.x,outlet.y+age*smokeRise,outlet.z+d*wind.y);
  }
  function update(t) {clock=t;uniforms.ageClock.value=t;}
  function particle(id) {
    const emitted=id*smokeInterval,age=clock-emitted;
    if(age<-.000001||age>smokeLife)return undefined;
    const p=center(Math.max(0,age)),c=lateral(Math.max(0,age),emitted);
    p.x-=wind.y*c;p.z+=wind.x*c;return p;
  }
  return {update,center,flue:outlet,particle,mesh,outlets:[outlet,secondary],ventFaces:[faceA,faceB]};
}
