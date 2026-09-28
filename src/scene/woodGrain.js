// Współrzędne tekstury (UV) z KIERUNKIEM WŁÓKIEN dla elementów drewnianych + wspólna tekstura dębu.
// Czysto prezentacyjne: nie zmienia pozycji żadnego wierzchołka ani żadnej liczby w modelu — dokłada tylko
// atrybut `uv` do gotowej geometrii (renderery i solvery o tym nie wiedzą, patrz buildStaircase.js).
//
// Kierunek włókien = najdłuższa oś elementu (główna składowa PCA jego wierzchołków): stopień i podstopień —
// wzdłuż szerokości biegu, wanga — wzdłuż pochylenia deski, słup i tralka — pionowo, poręcz — wzdłuż kawałka.
// Każda ściana dostaje rzut płaski: u = wzdłuż włókien (rzut osi na płaszczyznę ściany), v = w poprzek; ściany
// prostopadłe do włókien (czoła, „drewno czołowe") dostają dowolną parę osi w swojej płaszczyźnie.

import * as THREE from 'three';
import { OAK_TEXTURE_SPAN_MM, OAK_TEXTURE_SIZE, generateOakPixels } from './woodTexture.js';

// UV są w METRACH drewna (u wzdłuż włókien, v w poprzek) — każda tekstura sama mówi, ile drewna pokrywa jedno jej
// powtórzenie (texture.repeat = 1000 / rozpiętość w mm), więc ta sama geometria pasuje do tekstury generowanej
// i do zdjęcia. Na ścianach czołowych (w poprzek włókien) rysunek jest ściśnięty jak na przekroju deski.
const UV_UNIT_MM = 1000;
const END_GRAIN_SQUEEZE = 4;

// Zdjęcie dębu (src/assets/textures/oak-natural.jpg, 2000 × 1157 px, włókna poziomo). Rozpiętość w mm to ZAŁOŻENIE
// (typowy skan dekoru ok. 2,8 × 1,6 m) — dobrane na oko pod szerokość słojów na stopniu, do weryfikacji.
// Średni kolor zmierzony z pliku (średnia RGB wszystkich pikseli: 193, 159, 113) — kolor elementu jest liczony
// względem niego, więc wybranie dokładnie tego koloru pokazuje zdjęcie bez zmian.
export const OAK_PHOTO_SPAN_MM = Object.freeze({ along: 2800, across: 1620 });
export const OAK_PHOTO_MEAN_HEX = '#c19f71';
const OAK_PHOTO_URL = new URL('../assets/textures/oak-natural.jpg', import.meta.url).href;

/** Dominujący kierunek chmury punktów (wektor własny macierzy kowariancji, metoda potęgowa). */
export function principalAxis(positions) {
  const n = positions.length / 3;
  if (n === 0) return new THREE.Vector3(1, 0, 0);
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    mx += positions[3 * i];
    my += positions[3 * i + 1];
    mz += positions[3 * i + 2];
  }
  mx /= n; my /= n; mz /= n;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i] - mx;
    const y = positions[3 * i + 1] - my;
    const z = positions[3 * i + 2] - mz;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  // start z osi o największej wariancji, żeby metoda potęgowa zbiegała szybko i jednoznacznie
  let v = xx >= yy && xx >= zz ? new THREE.Vector3(1, 0, 0) : yy >= zz ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  for (let k = 0; k < 40; k++) {
    const nx = xx * v.x + xy * v.y + xz * v.z;
    const ny = xy * v.x + yy * v.y + yz * v.z;
    const nz = xz * v.x + yz * v.y + zz * v.z;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) break;
    v.set(nx / len, ny / len, nz / len);
  }
  return v;
}

// Deterministyczny „losowy" przesuw tekstury na element (z jego identyfikatora), żeby sąsiednie stopnie
// nie miały identycznego rysunku słojów.
export function textureOffsetFor(id) {
  let h = 2166136261;
  for (const ch of String(id ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const a = (h >>> 0) / 4294967296;
  const b = (Math.imul(h, 2654435761) >>> 0) / 4294967296;
  return { u: a * 7.3, v: b * 5.1 };
}

/**
 * Nowa (nieindeksowana) geometria z tymi samymi trójkątami i atrybutem `uv` w kierunku włókien.
 * @param {THREE.BufferGeometry} geometry
 * @param {{grain?: THREE.Vector3, offset?: {u:number, v:number}}} [opts]  grain — narzucony kierunek (świat)
 */
export function withWoodGrainUVs(geometry, opts = {}) {
  const src = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = src.getAttribute('position');
  const arr = pos.array;
  const grain = (opts.grain ? opts.grain.clone() : principalAxis(arr)).normalize();
  const offset = opts.offset || { u: 0, v: 0 };
  const uv = new Float32Array((arr.length / 3) * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
  const across = new THREE.Vector3(), along = new THREE.Vector3();
  for (let t = 0; t < arr.length / 9; t++) {
    a.fromArray(arr, 9 * t);
    b.fromArray(arr, 9 * t + 3);
    c.fromArray(arr, 9 * t + 6);
    nrm.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    if (nrm.lengthSq() < 1e-18) nrm.set(0, 1, 0);
    nrm.normalize();
    across.crossVectors(nrm, grain);
    let squeeze = 1;
    if (across.lengthSq() < 0.09) {
      // ściana czołowa (prostopadła do włókien): dowolne osie w jej płaszczyźnie, rysunek ściśnięty jak na przekroju
      across.set(Math.abs(nrm.y) < 0.9 ? 0 : 1, Math.abs(nrm.y) < 0.9 ? 1 : 0, 0).cross(nrm);
      squeeze = END_GRAIN_SQUEEZE;
    }
    across.normalize();
    along.crossVectors(across, nrm).normalize();
    for (const [k, p] of [[0, a], [1, b], [2, c]]) {
      uv[(3 * t + k) * 2] = (p.dot(along) * squeeze) / UV_UNIT_MM + offset.u;
      uv[(3 * t + k) * 2 + 1] = p.dot(across) / UV_UNIT_MM + offset.v;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos.clone());
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // gładkie normalne walca (okrągła tralka/poręcz) zostają; bez normalnych — liczone jak dotąd (ściany płaskie)
  if (src.getAttribute('normal')) out.setAttribute('normal', src.getAttribute('normal').clone());
  else out.computeVertexNormals();
  out.userData = { ...geometry.userData, woodGrainUV: true };
  return out;
}

/**
 * Dokłada UV z kierunkiem włókien do każdej siatki w drzewie (pomija te, które już je mają — np. balustrada,
 * której elementy są scalane w jedną siatkę i dostają UV kawałek po kawałku, zanim zostaną scalone) i włącza cienie.
 */
export function applyWoodGrainToTree(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
    if (obj.geometry?.userData?.woodGrainUV) return;
    const old = obj.geometry;
    obj.geometry = withWoodGrainUVs(old, { offset: textureOffsetFor(obj.userData?.geometrySourceId ?? obj.name) });
    old.dispose();
  });
}

// --- wspólna tekstura dębu (jedna na całą aplikację, tworzona przy pierwszym użyciu) -----------------------

let oakTexture = null;
let oakMeanLuminance = 1;

export function getOakTexture() {
  if (!oakTexture) {
    const { data, width, height, meanLinearLuminance } = generateOakPixels(OAK_TEXTURE_SIZE);
    oakTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    oakTexture.colorSpace = THREE.SRGBColorSpace;
    oakTexture.wrapS = THREE.RepeatWrapping;
    oakTexture.wrapT = THREE.RepeatWrapping;
    oakTexture.magFilter = THREE.LinearFilter;
    oakTexture.minFilter = THREE.LinearMipmapLinearFilter;
    oakTexture.generateMipmaps = true;
    oakTexture.anisotropy = 8;
    oakTexture.repeat.set(UV_UNIT_MM / OAK_TEXTURE_SPAN_MM.along, UV_UNIT_MM / OAK_TEXTURE_SPAN_MM.across);
    oakTexture.needsUpdate = true;
    oakMeanLuminance = meanLinearLuminance;
  }
  return oakTexture;
}

let oakPhotoTexture = null;

/** Zdjęcie dębu jako tekstura (ładowane raz, asynchronicznie — do czasu wczytania materiał rysuje się bez niej). */
export function getOakPhotoTexture() {
  if (!oakPhotoTexture) {
    oakPhotoTexture = new THREE.TextureLoader().load(OAK_PHOTO_URL);
    oakPhotoTexture.colorSpace = THREE.SRGBColorSpace;
    oakPhotoTexture.wrapS = THREE.RepeatWrapping;
    oakPhotoTexture.wrapT = THREE.RepeatWrapping;
    oakPhotoTexture.anisotropy = 8;
    oakPhotoTexture.repeat.set(UV_UNIT_MM / OAK_PHOTO_SPAN_MM.along, UV_UNIT_MM / OAK_PHOTO_SPAN_MM.across);
  }
  return oakPhotoTexture;
}

/** Średnia (liniowa) jasność tekstury dębu — kolor materiału jest przez nią dzielony (patrz appearance.js). */
export function getOakMeanLuminance() {
  getOakTexture();
  return oakMeanLuminance;
}
