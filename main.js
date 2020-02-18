import * as THREE from './lib/three.module.js';
import { FlyControls } from './lib/FlyControls.js';


const MAPBOX_API_KEY = window.location.search.substr(1);
const NUM_DIVS = 512;
const textureLoader = new THREE.TextureLoader();

var camera, scene, renderer;
var mesh, material, controls;

init();
animate();

function init() {
  if (!MAPBOX_API_KEY) {
    alert("Pass your mapbox api key in the url like so:  http://localhost/?API_KEY_HERE");
  }

  // Init Three.js
  const threeElement = document.getElementById("three");
  renderer = new THREE.WebGLRenderer({ canvas: threeElement });

  const aspect  = threeElement.width / threeElement.height;
  camera = new THREE.PerspectiveCamera(80, aspect, 0.1, 1000);
  camera.position.z = 143;
  camera.position.y = 16;
  camera.rotation.x = -0.27499997708334295;

  scene = new THREE.Scene();

  // Create a gradient texture to color the mesh based on height.
  const gradientCanvas = document.createElement('canvas');
  const gradientCtx = gradientCanvas.getContext('2d');
  gradientCtx.canvas.width = 64;
  gradientCtx.canvas.height = 1;
  const gradient = gradientCtx.createLinearGradient(0, 0, 64, 0);
  gradient.addColorStop(0.0, 'blue');
  gradient.addColorStop(0.05, 'blue');
  gradient.addColorStop(0.06, 'green');
  gradient.addColorStop(0.8, 'white');
  gradientCtx.fillStyle = gradient;
  gradientCtx.fillRect(0, 0, 64, 1);
  const gradientTexture = new THREE.CanvasTexture(gradientCanvas);

  // This is the mesh material, it uses vertex texture fetch to grab the heightfield value and displace the
  // flat mesh to the correct height.
  material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying float vElevation;
      varying vec3 vPos;

      uniform sampler2D map;
      uniform float texOffset;

      float getElevation(vec2 uv) {
        vec4 elevationRGB = texture2D(map, uv);
        // Height is encoded in RGB
        return dot(elevationRGB, vec4(256.0*256.0, 256.0, 1.0, 0.0));
      }

      void main()	{
        vUv = uv;
        vec3 pos = position;

        // Display in Z by the elevation (plus a fudge factor)
        vElevation = getElevation(vUv);
        pos.z += vElevation * 0.03;
        vPos = pos;

        // Get the gradient from the heightfield and compute a normal for simple shading
        float xDiff = getElevation(vUv + vec2(texOffset, 0.0)) - getElevation(vUv - vec2(texOffset, 0.0));
        float yDiff = getElevation(vUv + vec2(0.0, texOffset)) - getElevation(vUv - vec2(0.0, texOffset));
        vNormal = normalize(vec3(xDiff, yDiff, 4.0));

        vec4 modelViewPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * modelViewPosition;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying float vElevation;

      uniform sampler2D gradient;

      // hash, noise, and fbm functions from https://www.shadertoy.com/view/lsf3WH
      float hash(vec2 p)  // replace this by something better
      {
          p  = 50.0*fract( p*0.3183099 + vec2(0.71,0.113));
          return -1.0+2.0*fract( p.x*p.y*(p.x+p.y) );
      }

      float noise( in vec2 p )
      {
          vec2 i = floor( p );
          vec2 f = fract( p );

        vec2 u = f*f*(3.0-2.0*f);

          return mix( mix( hash( i + vec2(0.0,0.0) ),
                           hash( i + vec2(1.0,0.0) ), u.x),
                      mix( hash( i + vec2(0.0,1.0) ),
                           hash( i + vec2(1.0,1.0) ), u.x), u.y);
      }

      float fbm(vec2 uv) {
        // uv *= 8.0;
        mat2 m = mat2( 1.6,  1.2, -1.2,  1.6 );
        float f = 0.5000*noise( uv ); uv = m*uv;
        f += 0.2500*noise( uv ); uv = m*uv;
        f += 0.1250*noise( uv ); uv = m*uv;
        f += 0.0625*noise( uv ); uv = m*uv;
        return f;
      }

      void main() {
        vec3 norm = normalize(vNormal);

        // Grab a base color value based on height
        float elevation = (vElevation - 375.0) * (1.0 / 300.0);

        // Use triplanar projection to generate some detail texture
        vec3 blendWeights = abs(norm);
        // sum to one, l1norm!
        blendWeights /= (blendWeights.x + blendWeights.y + blendWeights.z);
        float scaleFactorXY = 1.0;
        float scaleFactorZ = 2.0; // z varies less
        vec3 color = vec3(fbm(vPos.yz * vec2(scaleFactorXY, scaleFactorZ)), fbm(vPos.zx * vec2(scaleFactorZ, scaleFactorXY)), fbm(vPos.xy * scaleFactorXY));
        float noiseVal = dot(blendWeights, color) * 0.2 + 0.8;

        // Very simple lighting
        float nDotL = dot(norm, normalize(vec3(0.25, 0.23, 0.73))) + 0.5;

        gl_FragColor = texture2D(gradient, vec2(elevation, 0.0)) * noiseVal * nDotL;
      }
    `,
    uniforms: {
      map: { value: null, type: 't' },
      gradient: { value: gradientTexture, type: 't' },
      texOffset: { value: 1.0 / 512.0 },
    }
  });

  mesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, NUM_DIVS, NUM_DIVS), material);
  mesh.rotation.x = -3.14 / 4.0;
  scene.add(mesh);

  // Simple camera controls
  controls = new FlyControls(camera, renderer.domElement);
  controls.dragToLook = true;
  controls.movementSpeed = 1.0;

  // React to UI
  const submit = document.getElementById('submit');
  submit.addEventListener('click', event => {
    const point = {
      latitude: document.getElementById('latitude').value || 0,
      longitude: document.getElementById('longitude').value || 0,
      zoom: document.getElementById('zoom').value || 0,
    };
    updateTerrain(point);
  });

  // Initial state.
  updateTerrain({
    latitude: 0,
    longitude: 0,
    zoom: 0,
  });
}

function animate() {
  requestAnimationFrame(animate);
  controls.update(1.0);
  render();
}

function render() {
  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  renderer.render(scene, camera);
}

function updateTerrain(point) {
  const tile = pointToTile(point.longitude, point.latitude, point.zoom);
  textureLoader.load(
    `https://api.mapbox.com/v4/mapbox.terrain-rgb/${point.zoom}/${tile[0]}/${tile[1]}@2x.pngraw?access_token=${MAPBOX_API_KEY}`,
    function (texture) {
      material.uniforms.map.value = texture;
      material.uniformsNeedUpdate = true;
      material.needsUpdate = true;
    },
    undefined,
    function (err) {
      console.log('error', err);
    }
  );
}

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const pixelRatio = window.devicePixelRatio;
  const width  = canvas.clientWidth  * pixelRatio | 0;
  const height = canvas.clientHeight * pixelRatio | 0;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}
//
// Grabbed from @mapbox/tilebelt
//

/**
 * Get the tile for a point at a specified zoom level
 *
 * @name pointToTile
 * @param {number} lon
 * @param {number} lat
 * @param {number} z
 * @returns {Array<number>} tile
 * @example
 * var tile = pointToTile(1, 1, 20)
 * //=tile
 */
function pointToTile(lon, lat, z) {
  var tile = pointToTileFraction(lon, lat, z);
  tile[0] = Math.floor(tile[0]);
  tile[1] = Math.floor(tile[1]);
  return tile;
}

/**
 * Get the precise fractional tile location for a point at a zoom level
 *
 * @name pointToTileFraction
 * @param {number} lon
 * @param {number} lat
 * @param {number} z
 * @returns {Array<number>} tile fraction
 * var tile = pointToTileFraction(30.5, 50.5, 15)
 * //=tile
 */
function pointToTileFraction(lon, lat, z) {
  const d2r = Math.PI / 180;
  var sin = Math.sin(lat * d2r),
      z2 = Math.pow(2, z),
      x = z2 * (lon / 360 + 0.5),
      y = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

  // Wrap Tile X
  x = x % z2
  if (x < 0) x = x + z2
  return [x, y, z];
}